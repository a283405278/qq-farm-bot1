const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FARM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-friend-'));

function mockModule(filename, exports) {
  return { id: filename, filename, loaded: true, exports };
}

function setupMocks({ interactRecords = [], connected = true, sendError = null, knownGids = [], blacklist = [] } = {}) {
  process.env.FARM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-friend-'));

  const servicePath = require.resolve('../src/services/auto-friend');
  const interactPath = require.resolve('../src/services/interact');
  const storePath = require.resolve('../src/models/store');
  const networkPath = require.resolve('../src/utils/network');
  const protoPath = require.resolve('../src/utils/proto');
  const utilsPath = require.resolve('../src/utils/utils');
  const paths = [interactPath, storePath, networkPath, protoPath, utilsPath];
  const previous = new Map(paths.map(p => [p, require.cache[p]]));

  const sentGids = [];

  const replyType = () => ({
    create: value => value,
    encode: () => ({ finish: () => Buffer.alloc(0) }),
    decode: () => ({}),
  });

  require.cache[interactPath] = mockModule(interactPath, {
    getInteractRecords: async () => interactRecords,
  });
  require.cache[storePath] = mockModule(storePath, {
    getFriendBlacklist: () => blacklist,
    getKnownFriendGids: () => knownGids,
  });
  require.cache[networkPath] = mockModule(networkPath, {
    isConnected: () => connected,
    getUserState: () => ({ gid: 999 }),
    sendMsgAsync: async () => {
      if (sendError) throw (sendError instanceof Error ? sendError : new Error(sendError));
      return { body: Buffer.alloc(0) };
    },
  });
  require.cache[protoPath] = mockModule(protoPath, {
    types: {
      ReportArkClickRequest: replyType(),
      ReportArkClickReply: replyType(),
    },
  });
  require.cache[utilsPath] = mockModule(utilsPath, {
    toNum: value => Number(value) || 0,
    toLong: value => ({ toNumber: () => Number(value) }),
    log: () => {},
    logWarn: () => {},
  });

  const captureArkClick = { sharerId: 0, sceneId: '' };
  require.cache[protoPath].exports.types.ReportArkClickRequest.create = (value) => {
    captureArkClick.sharerId = Number(value.sharer_id && value.sharer_id.toNumber ? value.sharer_id.toNumber() : value.sharer_id);
    captureArkClick.sceneId = value.scene_id;
    sentGids.push(captureArkClick.sharerId);
    return value;
  };

  delete require.cache[servicePath];
  const service = require(servicePath);

  const restore = () => {
    delete require.cache[servicePath];
    for (const p of paths) {
      if (previous.get(p)) require.cache[p] = previous.get(p);
      else delete require.cache[p];
    }
  };

  return { service, restore, sentGids, captureArkClick };
}

function waitFor(predicate, timeoutMs = 5000, stepMs = 50) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitFor timeout'));
      }
    }, stepMs);
  });
}

test('sendFriendApplication 未连接时报错', async () => {
  const { service, restore } = setupMocks({ connected: false });
  try {
    await assert.rejects(() => service.sendFriendApplication(10001), /未连接/);
  } finally {
    restore();
  }
});

test('sendFriendApplication 发送 ReportArkClick 并标记已申请', async () => {
  const { service, restore, captureArkClick, sentGids } = setupMocks();
  try {
    await service.sendFriendApplication(123456);
    assert.deepEqual(sentGids, [123456]);
    assert.equal(captureArkClick.sceneId, '1256');
    const applied = service.getAppliedGidSet();
    assert.equal(applied.has(123456), true);
  } finally {
    restore();
  }
});

test('sendFriendApplication 失败时不标记已申请', async () => {
  const { service, restore, sentGids } = setupMocks({ sendError: '网络繁忙' });
  try {
    await assert.rejects(() => service.sendFriendApplication(123456), /网络繁忙/);
    assert.deepEqual(sentGids, [123456]);
    const applied = service.getAppliedGidSet();
    assert.equal(applied.has(123456), false);
  } finally {
    restore();
  }
});

test('scanAutoFriendCandidates 过滤自己/黑名单/已知好友/已申请', async () => {
  const interactRecords = [
    { visitorGid: 10001, nick: 'A', level: 10 },
    { visitorGid: 999, nick: '自己', level: 50 },
    { visitorGid: 10003, nick: 'C', level: 5 },
    { visitorGid: 10004, nick: 'D', level: 7 },
  ];
  const { service, restore } = setupMocks({
    interactRecords,
    knownGids: [10003],
    blacklist: [10004],
  });
  try {
    await service.sendFriendApplication(10001);
    const result = await service.scanAutoFriendCandidates();
    const gids = result.candidates.map(c => c.gid);
    assert.deepEqual(gids, []);
    assert.equal(result.stats.skippedSelf, 1);
    assert.equal(result.stats.skippedFriend, 1);
    assert.equal(result.stats.skippedBlacklist, 1);
    assert.equal(result.stats.skippedApplied, 1);
  } finally {
    restore();
  }
});

test('scanAutoFriendCandidates 支持补充 GID 并按等级排序', async () => {
  const interactRecords = [
    { visitorGid: 10001, nick: 'A', level: 3 },
    { visitorGid: 10002, nick: 'B', level: 30 },
  ];
  const { service, restore } = setupMocks({ interactRecords });
  try {
    const result = await service.scanAutoFriendCandidates({ gids: [20001, 20002] });
    const gids = result.candidates.map(c => c.gid);
    assert.deepEqual(gids, [10002, 10001, 20001, 20002]);
    const source = result.candidates.find(c => c.gid === 20001);
    assert.equal(source.source, 'manual');
  } finally {
    restore();
  }
});

test('startAutoFriendTask 未连接时报错', async () => {
  const { service, restore } = setupMocks({ connected: false });
  try {
    await assert.rejects(() => service.startAutoFriendTask({ intervalSec: 2 }), /未连接/);
  } finally {
    restore();
  }
});

test('startAutoFriendTask 无可申请候选时报错', async () => {
  const { service, restore } = setupMocks({ interactRecords: [{ visitorGid: 999 }] });
  try {
    await assert.rejects(() => service.startAutoFriendTask({ intervalSec: 2 }), /没有可申请/);
  } finally {
    restore();
  }
});

test('startAutoFriendTask 运行并完成，统计成功/失败', async () => {
  const interactRecords = [
    { visitorGid: 10001, nick: 'A', level: 5 },
    { visitorGid: 10002, nick: 'B', level: 6 },
  ];
  const { service, restore, sentGids } = setupMocks({ interactRecords });
  try {
    const status = await service.startAutoFriendTask({ intervalSec: 1 });
    assert.equal(status.running, true);
    assert.equal(status.status, 'running');
    assert.equal(status.candidateCount, 2);

    await waitFor(() => service.getAutoFriendStatus().status === 'completed');

    const final = service.getAutoFriendStatus();
    assert.equal(final.success, 2);
    assert.equal(final.failed, 0);
    assert.equal(final.processed, 2);
    assert.equal(final.progress, 100);
    assert.deepEqual(sentGids, [10002, 10001]);
  } finally {
    restore();
  }
});

test('startAutoFriendTask 发送失败计入 failed', async () => {
  const interactRecords = [
    { visitorGid: 10001, nick: 'A', level: 5 },
    { visitorGid: 10002, nick: 'B', level: 6 },
  ];
  const { service, restore } = setupMocks({
    interactRecords,
    sendError: new Error('服务器拒绝'),
  });
  try {
    const status = await service.startAutoFriendTask({ intervalSec: 1 });
    assert.equal(status.running, true);
    await waitFor(() => service.getAutoFriendStatus().status === 'completed');
    const final = service.getAutoFriendStatus();
    assert.equal(final.success, 0);
    assert.equal(final.failed, 2);
    assert.equal(final.lastError, '服务器拒绝');
  } finally {
    restore();
  }
});

test('stopAutoFriendTask 停止正在运行的任务', async () => {
  const interactRecords = [
    { visitorGid: 10001, nick: 'A', level: 5 },
    { visitorGid: 10002, nick: 'B', level: 6 },
  ];
  const { service, restore } = setupMocks({ interactRecords });
  try {
    await service.startAutoFriendTask({ intervalSec: 60 });
    const status = service.stopAutoFriendTask();
    assert.equal(status.status, 'stopped');
    assert.equal(status.running, false);
  } finally {
    restore();
  }
});

test('getAutoFriendStatus 返回完整统计结构', async () => {
  const { service, restore } = setupMocks();
  try {
    const status = service.getAutoFriendStatus();
    assert.equal(status.status, 'idle');
    assert.equal(status.running, false);
    assert.equal(status.success, 0);
    assert.equal(status.failed, 0);
    assert.equal(status.candidateCount, 0);
    assert.equal(status.appliedCount, 0);
    assert.equal(typeof status.progress, 'number');
  } finally {
    restore();
  }
});
