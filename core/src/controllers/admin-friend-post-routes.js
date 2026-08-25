const {
  listFriendPosts,
  getFriendPostById,
  upsertFriendPost,
  deleteFriendPostByUsername,
  toPublicPost,
} = require('../services/friend-post-store');

function getCurrentUsername(req) {
  return String((req.currentUser && req.currentUser.username) || '').trim();
}

function registerAdminFriendPostRoutes({
  app,
  store,
  provider,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  /** 校验并解析面板账号，无账号时返回 null（列表接口允许无账号） */
  function resolveAccount(req, res, { required = true } = {}) {
    const accountId = getAccountIdFromRequest(req);
    if (!accountId) {
      if (!required) return '';
      res.status(400).json({ ok: false, error: 'Missing x-account-id' });
      return null;
    }
    if (!canAccessAccount(req, accountId)) {
      res.status(403).json({ ok: false, error: '无权访问此账号' });
      return null;
    }
    return accountId;
  }

  /** 获取某个账号已添加的已知好友 GID 集合 */
  function getKnownGidSet(accountId) {
    if (!accountId) return new Set();
    const gids = store.getKnownFriendGids
      ? store.getKnownFriendGids(accountId)
      : [];
    return new Set(Array.isArray(gids) ? gids.map(Number) : []);
  }

  // 获取全部加好友发布信息
  app.get('/api/friend-posts', (req, res) => {
    try {
      const username = getCurrentUsername(req);
      const accountId = resolveAccount(req, res, { required: false });
      const knownGidSet = getKnownGidSet(accountId);

      const posts = listFriendPosts().map(post => {
        const pub = toPublicPost(post, username);
        pub.isKnown = knownGidSet.has(Number(pub.gid));
        return pub;
      });
      res.json({ ok: true, data: posts });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  // 发布/更新自己的加好友信息
  app.post('/api/friend-posts', (req, res) => {
    try {
      const username = getCurrentUsername(req);
      if (!username) {
        return res.status(401).json({ ok: false, error: '未登录' });
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const gid = Number.parseInt(String(body.gid || ''), 10);
      if (!Number.isFinite(gid) || gid <= 0) {
        return res.status(400).json({ ok: false, error: '请输入有效的游戏 GID' });
      }

      const post = upsertFriendPost(username, body);
      if (!post) {
        return res.status(400).json({ ok: false, error: '发布失败，请检查输入' });
      }
      res.json({ ok: true, data: toPublicPost(post, username) });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  // 删除自己的加好友信息
  app.delete('/api/friend-posts', (req, res) => {
    try {
      const username = getCurrentUsername(req);
      if (!username) {
        return res.status(401).json({ ok: false, error: '未登录' });
      }
      const removed = deleteFriendPostByUsername(username);
      res.json({ ok: true, removed });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  // 从别人的发布信息加为好友（把 GID 加入当前账号的已知好友列表并尝试同步）
  app.post('/api/friend-posts/:id/add', async (req, res) => {
    const accountId = resolveAccount(req, res);
    if (!accountId) return;

    try {
      const post = getFriendPostById(req.params.id);
      if (!post) {
        return res.status(404).json({ ok: false, error: '发布信息不存在或已删除' });
      }

      const gid = Number(post.gid);
      if (!gid || gid <= 0) {
        return res.status(400).json({ ok: false, error: '发布信息中的 GID 无效' });
      }

      const accounts = store.getAccounts ? store.getAccounts().accounts || [] : [];
      const ownAccount = accounts.find(a => String(a.id) === String(accountId));
      const ownGid = Number(ownAccount && ownAccount.gid) || 0;
      if (ownGid > 0 && ownGid === gid) {
        return res.status(400).json({ ok: false, error: '不能添加自己发布的 GID' });
      }

      const knownGids = store.getKnownFriendGids
        ? store.getKnownFriendGids(accountId)
        : [];
      const knownSet = new Set(knownGids.map(Number));
      let added = false;
      if (!knownSet.has(gid)) {
        knownSet.add(gid);
        if (store.setKnownFriendGids) {
          store.setKnownFriendGids(accountId, Array.from(knownSet));
        }
        added = true;
      }

      if (provider && typeof provider.broadcastConfig === 'function') {
        provider.broadcastConfig(accountId);
      }

      // 账号运行时立即尝试同步好友，失败不影响接口返回
      if (
        provider
        && typeof provider.syncFriendsFromGids === 'function'
        && typeof provider.isAccountRunning === 'function'
        && provider.isAccountRunning(accountId)
      ) {
        void provider
          .syncFriendsFromGids(accountId, [gid])
          .catch(() => {});
      }

      res.json({
        ok: true,
        added,
        gid,
        message: added
          ? `已将 GID ${gid} 加入已知好友列表，正在同步好友信息`
          : '该 GID 已在已知好友列表中',
      });
    } catch (error) {
      sendProviderError(res, error);
    }
  });
}

module.exports = { registerAdminFriendPostRoutes };
