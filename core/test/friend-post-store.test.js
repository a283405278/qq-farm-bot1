const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FARM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'friend-post-store-'));

const {
  normalizeGid,
  normalizeNick,
  normalizeRemark,
  normalizePlatform,
  normalizePostInput,
  upsertFriendPost,
  listFriendPosts,
  getFriendPostById,
  getFriendPostByUsername,
  deleteFriendPostByUsername,
  deleteFriendPostById,
  toPublicPost,
} = require('../src/services/friend-post-store');

test('normalizeGid 只接受正整数', () => {
  assert.equal(normalizeGid('12345'), 12345);
  assert.equal(normalizeGid('0'), 0);
  assert.equal(normalizeGid('-1'), 0);
  assert.equal(normalizeGid('abc'), 0);
  assert.equal(normalizeGid(undefined), 0);
});

test('normalizePlatform 归一化平台', () => {
  assert.equal(normalizePlatform('qq'), 'qq');
  assert.equal(normalizePlatform('QQ'), 'qq');
  assert.equal(normalizePlatform('wx'), 'wx');
  assert.equal(normalizePlatform('wechat'), 'wx');
  assert.equal(normalizePlatform(''), 'qq');
});

test('normalizeNick 与 normalizeRemark 限制长度', () => {
  assert.equal(normalizeNick('张三'), '张三');
  assert.equal(normalizeNick('a'.repeat(50)), 'a'.repeat(32));
  assert.equal(normalizeRemark('备注内容'), '备注内容');
  assert.equal(normalizeRemark('r'.repeat(300)).length, 200);
});

test('normalizePostInput 在缺少有效 GID 时返回 null', () => {
  assert.equal(normalizePostInput({ gid: '' }), null);
  assert.equal(normalizePostInput({}), null);
  assert.deepEqual(normalizePostInput({ gid: '10001', nick: ' 小农 ' }), {
    gid: 10001,
    nick: '小农',
    platform: 'qq',
    remark: '',
  });
});

test('upsert 同一用户重复发布会更新原公告', () => {
  deleteFriendPostByUsername('user-a');
  const first = upsertFriendPost('user-a', { gid: 10001, nick: '一号' });
  assert.ok(first.id);
  assert.equal(getFriendPostByUsername('user-a').gid, 10001);

  const second = upsertFriendPost('user-a', { gid: 10002, nick: '二号' });
  assert.equal(second.id, first.id);
  assert.equal(getFriendPostByUsername('user-a').gid, 10002);
  assert.equal(listFriendPosts().length, 1);
});

test('listFriendPosts 按更新时间倒序排列', () => {
  deleteFriendPostByUsername('user-a');
  deleteFriendPostByUsername('user-b');
  upsertFriendPost('user-a', { gid: 10001, nick: 'A' });
  const now = Date.now();
  const posts = readPostsForTest();
  const aPost = posts.find(p => p.username === 'user-a');
  aPost.updatedAt = now - 1000;
  writePostsForTest(posts);

  upsertFriendPost('user-b', { gid: 10002, nick: 'B' });

  const list = listFriendPosts();
  assert.equal(list[0].username, 'user-b');
  assert.equal(list[1].username, 'user-a');
});

test('删除公告支持按用户与按 ID', () => {
  const post = upsertFriendPost('user-c', { gid: 10003, nick: 'C' });
  assert.equal(deleteFriendPostById(post.id), true);
  assert.equal(getFriendPostById(post.id), null);

  upsertFriendPost('user-d', { gid: 10004, nick: 'D' });
  assert.equal(deleteFriendPostByUsername('user-d'), true);
  assert.equal(getFriendPostByUsername('user-d'), null);
  assert.equal(deleteFriendPostByUsername('user-d'), false);
});

test('toPublicPost 标记本人发布', () => {
  const post = { id: 'x', username: 'me', gid: 1, nick: 'n', platform: 'qq', remark: '', createdAt: 1, updatedAt: 1 };
  assert.equal(toPublicPost(post, 'me').isMine, true);
  assert.equal(toPublicPost(post, 'other').isMine, false);
});

function readPostsForTest() {
  const file = path.join(process.env.FARM_DATA_DIR, 'friend-posts.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writePostsForTest(posts) {
  const file = path.join(process.env.FARM_DATA_DIR, 'friend-posts.json');
  fs.writeFileSync(file, JSON.stringify(posts, null, 2), 'utf8');
}
