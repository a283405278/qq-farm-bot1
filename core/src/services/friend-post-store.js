/**
 * 加好友发布信息存储
 *
 * 提供"互加好友"公告的持久化，数据以 JSON 文件保存在 data 目录：
 *   - friend-posts.json
 *
 * 每个面板用户只能发布一条公告（重复发布视为更新）。
 */
const crypto = require('node:crypto');
const { getDataFile } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');

const FRIEND_POSTS_FILE = 'friend-posts.json';
const MAX_REMARK_LENGTH = 200;
const MAX_NICK_LENGTH = 32;
const MAX_POSTS = 2000;

function generatePostId() {
  return `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizePlatform(value) {
  const platform = String(value || '').trim().toLowerCase();
  if (platform === 'wx' || platform === 'wechat') return 'wx';
  if (platform === 'qq') return 'qq';
  return 'qq';
}

function normalizeGid(value) {
  const gid = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(gid) && gid > 0 ? gid : 0;
}

function normalizeNick(value) {
  return String(value || '').trim().slice(0, MAX_NICK_LENGTH);
}

function normalizeRemark(value) {
  return String(value || '').trim().slice(0, MAX_REMARK_LENGTH);
}

function normalizePostInput(input) {
  const gid = normalizeGid(input && input.gid);
  if (!gid) return null;
  return {
    gid,
    nick: normalizeNick(input && input.nick),
    platform: normalizePlatform(input && input.platform),
    remark: normalizeRemark(input && input.remark),
  };
}

function readPosts() {
  const posts = readJsonFile(getDataFile(FRIEND_POSTS_FILE), () => []);
  return Array.isArray(posts) ? posts : [];
}

function writePosts(posts) {
  writeJsonFileAtomic(getDataFile(FRIEND_POSTS_FILE), posts.slice(0, MAX_POSTS));
}

function toPublicPost(post, currentUsername = '') {
  return {
    id: post.id,
    gid: post.gid,
    nick: post.nick,
    platform: post.platform,
    remark: post.remark,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    username: post.username,
    isMine: currentUsername && post.username === currentUsername,
  };
}

/** 返回全部公告，按更新时间倒序 */
function listFriendPosts() {
  return readPosts()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function getFriendPostById(id) {
  if (!id) return null;
  return readPosts().find(post => post.id === id) || null;
}

function getFriendPostByUsername(username) {
  if (!username) return null;
  return readPosts().find(post => post.username === username) || null;
}

/** 发布或更新自己的公告（每用户一条） */
function upsertFriendPost(username, input) {
  if (!username) return null;
  const normalized = normalizePostInput(input);
  if (!normalized) return null;

  const posts = readPosts();
  const now = Date.now();
  const existing = posts.find(post => post.username === username);
  let next;
  if (existing) {
    next = {
      ...existing,
      ...normalized,
      updatedAt: now,
    };
    const index = posts.indexOf(existing);
    posts[index] = next;
  } else {
    next = {
      id: generatePostId(),
      username,
      ...normalized,
      createdAt: now,
      updatedAt: now,
    };
    posts.push(next);
  }
  writePosts(posts);
  return next;
}

/** 删除自己的公告 */
function deleteFriendPostByUsername(username) {
  if (!username) return false;
  const posts = readPosts();
  const index = posts.findIndex(post => post.username === username);
  if (index < 0) return false;
  posts.splice(index, 1);
  writePosts(posts);
  return true;
}

/** 按 ID 删除公告（仅本人或管理员使用） */
function deleteFriendPostById(id) {
  if (!id) return false;
  const posts = readPosts();
  const index = posts.findIndex(post => post.id === id);
  if (index < 0) return false;
  const [removed] = posts.splice(index, 1);
  writePosts(posts);
  return !!removed;
}

module.exports = {
  MAX_REMARK_LENGTH,
  MAX_NICK_LENGTH,
  MAX_POSTS,
  normalizePlatform,
  normalizeGid,
  normalizeNick,
  normalizeRemark,
  normalizePostInput,
  listFriendPosts,
  getFriendPostById,
  getFriendPostByUsername,
  upsertFriendPost,
  deleteFriendPostByUsername,
  deleteFriendPostById,
  toPublicPost,
};
