/**
 * 自动加好友服务
 *
 * 功能：
 * - 扫描候选好友（最近访客 + 补充 GID 列表），过滤已是好友/黑名单/已申请
 * - 逐个通过 ReportArkClick（scene 1256）发送好友申请
 * - 任务循环：进度 / 成功 / 失败 / 跳过统计，支持开始与停止
 * - 已申请 GID 持久化，避免重复申请
 *
 * 说明：QQ 版游戏没有公开的"全服玩家"接口，候选来源以最近访客为主。
 * 发送申请走游戏内好友申请协议（与微信同玩共用 ReportArkClick 场景），
 * 对方同意后即成为游戏内好友。
 */
const path = require('node:path');

const { ensureDataDir } = require('../config/runtime-paths');
const { getFriendBlacklist, getKnownFriendGids } = require('../models/store');
const { getInteractRecords } = require('./interact');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');
const { isConnected, sendMsgAsync, getUserState } = require('../utils/network');
const { types } = require('../utils/proto');
const { toLong, toNum, log, logWarn } = require('../utils/utils');

const APPLY_SCENE_ID = '1256';
const DEFAULT_INTERVAL_SEC = 5;
const MIN_INTERVAL_SEC = 1;
const MAX_INTERVAL_SEC = 3600;

const STATUS_IDLE = 'idle';
const STATUS_RUNNING = 'running';
const STATUS_COMPLETED = 'completed';
const STATUS_STOPPED = 'stopped';

// ==================== 持久化（已申请 GID） ====================

function getStateFile() {
  const accountId = process.env.FARM_ACCOUNT_ID || 'default';
  return path.join(ensureDataDir(), 'auto-friend', `${accountId}.json`);
}

function loadPersistentState() {
  const data = readJsonFile(getStateFile(), () => ({}));
  const appliedGids = Array.isArray(data.appliedGids)
    ? data.appliedGids.map(Number).filter((gid) => gid > 0)
    : [];
  const appliedAt = data.appliedAt && typeof data.appliedAt === 'object'
    ? data.appliedAt
    : {};
  return { appliedGids, appliedAt };
}

function savePersistentState(state) {
  writeJsonFileAtomic(getStateFile(), {
    appliedGids: state.appliedGids,
    appliedAt: state.appliedAt,
  });
}

function getAppliedGidSet() {
  return new Set(loadPersistentState().appliedGids);
}

function markGidApplied(gid) {
  const state = loadPersistentState();
  if (!state.appliedGids.includes(gid)) {
    state.appliedGids.push(gid);
    state.appliedAt[gid] = Date.now();
    savePersistentState(state);
  }
}

function resetAppliedGids() {
  savePersistentState({ appliedGids: [], appliedAt: {} });
}

// ==================== 任务状态 ====================

function emptyStats() {
  return {
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    skippedApplied: 0,
    skippedFriend: 0,
    skippedBlacklist: 0,
    skippedSelf: 0,
  };
}

let task = {
  running: false,
  status: STATUS_IDLE,
  intervalSec: DEFAULT_INTERVAL_SEC,
  candidates: [],
  index: 0,
  stats: emptyStats(),
  lastError: '',
  startedAt: 0,
  finishedAt: 0,
};
let taskTimer = null;
let scanLock = false;

function getSelfGid() {
  const state = getUserState();
  return toNum(state && state.gid) || 0;
}

function getStatus() {
  const candidateCount = task.candidates.length;
  const progress = candidateCount > 0
    ? Math.min(100, Math.round((task.index / candidateCount) * 100))
    : 0;
  return {
    running: task.running,
    status: task.status,
    intervalSec: task.intervalSec,
    progress,
    index: task.index,
    candidateCount,
    total: task.stats.total,
    processed: task.stats.processed,
    success: task.stats.success,
    failed: task.stats.failed,
    skippedApplied: task.stats.skippedApplied,
    skippedFriend: task.stats.skippedFriend,
    skippedBlacklist: task.stats.skippedBlacklist,
    skippedSelf: task.stats.skippedSelf,
    lastError: task.lastError,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    appliedCount: getAppliedGidSet().size,
  };
}

// ==================== 扫描候选 ====================

/**
 * 扫描候选好友列表（最近访客 + 补充 GID）
 * 过滤：自己 / 黑名单 / 已知好友 / 已申请
 */
async function scanAutoFriendCandidates(opts = {}) {
  if (scanLock) throw new Error('扫描正在进行中，请稍后再试');
  scanLock = true;
  try {
    const accountId = process.env.FARM_ACCOUNT_ID || '';
    const blacklist = new Set(getFriendBlacklist(accountId));
    const knownGids = new Set(getKnownFriendGids(accountId));
    const selfGid = getSelfGid();
    const appliedSet = getAppliedGidSet();

    const byGid = new Map();
    const skipCounts = emptyStats();

    let visitors = [];
    try {
      const records = await getInteractRecords();
      visitors = (records || []).map((r) => ({
        gid: toNum(r && r.visitorGid),
        nick: (r && r.nick) || '',
        level: toNum(r && r.level) || 0,
        source: 'visitor',
      })).filter((c) => c.gid > 0);
    } catch (err) {
      logWarn('自动加好友', `扫描访客失败: ${err.message}`, {
        module: 'friend',
        event: '自动加好友扫描访客',
        result: 'error',
      });
    }

    for (const c of visitors) {
      if (!byGid.has(c.gid)) {
        byGid.set(c.gid, c);
      }
    }

    const extraGids = Array.isArray(opts && opts.gids) ? opts.gids : [];
    for (const raw of extraGids) {
      const gid = toNum(raw);
      if (gid > 0 && !byGid.has(gid)) {
        byGid.set(gid, { gid, nick: '', level: 0, source: 'manual' });
      }
    }

    for (const c of byGid.values()) {
      if (c.gid === selfGid) {
        skipCounts.skippedSelf += 1;
        continue;
      }
      if (blacklist.has(c.gid)) {
        skipCounts.skippedBlacklist += 1;
        continue;
      }
      if (knownGids.has(c.gid)) {
        skipCounts.skippedFriend += 1;
        continue;
      }
      if (appliedSet.has(c.gid)) {
        skipCounts.skippedApplied += 1;
        continue;
      }
    }

    const candidates = Array.from(byGid.values()).filter(
      (c) => c.gid !== selfGid
        && !blacklist.has(c.gid)
        && !knownGids.has(c.gid)
        && !appliedSet.has(c.gid)
    );
    candidates.sort((a, b) => (b.level || 0) - (a.level || 0) || a.gid - b.gid);

    log('自动加好友',
      `扫描完成: 候选 ${candidates.length} 个（访客 ${visitors.length}，补充 ${extraGids.length}），`
      + `跳过 已是好友 ${skipCounts.skippedFriend} / 已申请 ${skipCounts.skippedApplied} `
      + `/ 黑名单 ${skipCounts.skippedBlacklist} / 自己 ${skipCounts.skippedSelf}`,
      {
        module: 'friend',
        event: '自动加好友扫描',
        candidateCount: candidates.length,
        ...skipCounts,
      }
    );

    return {
      candidates,
      stats: {
        total: candidates.length,
        skippedApplied: skipCounts.skippedApplied,
        skippedFriend: skipCounts.skippedFriend,
        skippedBlacklist: skipCounts.skippedBlacklist,
        skippedSelf: skipCounts.skippedSelf,
      },
    };
  } finally {
    scanLock = false;
  }
}

// ==================== 发送好友申请 ====================

/**
 * 向指定 GID 发送好友申请（ReportArkClick，scene 1256）
 * 成功后把该 GID 标记为已申请
 */
async function sendFriendApplication(gid) {
  const numericGid = toNum(gid);
  if (!numericGid) throw new Error('无效的 GID');
  if (!isConnected()) throw new Error('账号未连接游戏服务器');
  if (!types.ReportArkClickRequest || !types.ReportArkClickReply) {
    throw new Error('ReportArkClick 协议未加载');
  }

  const request = types.ReportArkClickRequest.encode(
    types.ReportArkClickRequest.create({
      sharer_id: toLong(numericGid),
      sharer_open_id: '',
      share_cfg_id: toLong(0),
      scene_id: APPLY_SCENE_ID,
    })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.userpb.UserService',
    'ReportArkClick',
    request,
    20000
  );
  types.ReportArkClickReply.decode(body);

  markGidApplied(numericGid);
  log('自动加好友', `已向 GID ${numericGid} 发送好友申请`, {
    module: 'friend',
    event: '自动加好友发送申请',
    result: 'ok',
    friendGid: numericGid,
  });
  return { ok: true, gid: numericGid };
}

// ==================== 任务循环 ====================

function clearTaskTimer() {
  if (taskTimer) {
    clearTimeout(taskTimer);
    taskTimer = null;
  }
}

function finishTask(status, message = '') {
  task.running = false;
  task.status = status;
  task.finishedAt = Date.now();
  if (message) task.lastError = message;
  clearTaskTimer();
  log('自动加好友',
    `任务${status === STATUS_COMPLETED ? '完成' : '停止'}: `
    + `成功 ${task.stats.success}, 失败 ${task.stats.failed}, `
    + `已处理 ${task.stats.processed}/${task.stats.total}`,
    {
      module: 'friend',
      event: status === STATUS_COMPLETED ? '自动加好友完成' : '自动加好友停止',
      ...task.stats,
    }
  );
}

async function applyNextCandidate() {
  if (!task.running) return;

  if (task.index >= task.candidates.length) {
    finishTask(STATUS_COMPLETED);
    return;
  }

  const candidate = task.candidates[task.index];
  task.index += 1;
  task.stats.processed += 1;

  try {
    await sendFriendApplication(candidate.gid);
    task.stats.success += 1;
  } catch (err) {
    task.stats.failed += 1;
    task.lastError = err && err.message ? err.message : String(err || 'unknown');
    logWarn('自动加好友', `GID ${candidate.gid} 申请失败: ${task.lastError}`, {
      module: 'friend',
      event: '自动加好友发送申请',
      result: 'error',
      friendGid: candidate.gid,
    });
  }

  if (!task.running) return;
  if (task.index >= task.candidates.length) {
    finishTask(STATUS_COMPLETED);
    return;
  }
  taskTimer = setTimeout(applyNextCandidate, task.intervalSec * 1000);
}

/**
 * 启动自动加好友任务
 * @param {object} opts { intervalSec, gids }
 */
async function startAutoFriendTask(opts = {}) {
  if (task.running) throw new Error('任务正在运行中，请先停止再启动');
  if (!isConnected()) throw new Error('账号未连接游戏服务器，无法启动任务');

  const intervalSec = Math.max(
    MIN_INTERVAL_SEC,
    Math.min(MAX_INTERVAL_SEC, toNum(opts && opts.intervalSec) || DEFAULT_INTERVAL_SEC)
  );

  const scanResult = await scanAutoFriendCandidates(opts);
  const candidates = scanResult.candidates || [];
  const skipped = scanResult.stats || emptyStats();

  if (candidates.length === 0) {
    const reasons = [
      skipped.skippedFriend > 0 ? `${skipped.skippedFriend} 个已是好友` : '',
      skipped.skippedApplied > 0 ? `${skipped.skippedApplied} 个已申请过` : '',
    ].filter(Boolean).join('、');
    const message = reasons ? `没有可申请的候选好友（${reasons}）` : '没有可申请的候选好友';
    log('自动加好友', message, {
      module: 'friend',
      event: '自动加好友启动',
      result: 'empty',
    });
    throw new Error(message);
  }

  clearTaskTimer();
  task = {
    running: true,
    status: STATUS_RUNNING,
    intervalSec,
    candidates,
    index: 0,
    stats: {
      total: candidates.length,
      processed: 0,
      success: 0,
      failed: 0,
      skippedApplied: skipped.skippedApplied || 0,
      skippedFriend: skipped.skippedFriend || 0,
      skippedBlacklist: skipped.skippedBlacklist || 0,
      skippedSelf: skipped.skippedSelf || 0,
    },
    lastError: '',
    startedAt: Date.now(),
    finishedAt: 0,
  };

  log('自动加好友', `任务启动: 候选 ${candidates.length} 个，间隔 ${intervalSec} 秒`, {
    module: 'friend',
    event: '自动加好友启动',
    result: 'ok',
    candidateCount: candidates.length,
    intervalSec,
  });

  taskTimer = setTimeout(applyNextCandidate, 0);
  return getStatus();
}

function stopAutoFriendTask() {
  if (!task.running) {
    return getStatus();
  }
  finishTask(STATUS_STOPPED);
  return getStatus();
}

// ==================== 导出 ====================

module.exports = {
  getAutoFriendStatus: getStatus,
  scanAutoFriendCandidates,
  sendFriendApplication,
  startAutoFriendTask,
  stopAutoFriendTask,
  resetAppliedGids,
  getAppliedGidSet,
};
