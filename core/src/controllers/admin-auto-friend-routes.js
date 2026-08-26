function getAccountOrRespond(req, res, { getAccountIdFromRequest, canAccessAccount, includeMissingMessage = true }) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    const payload = { ok: false };
    if (includeMissingMessage) payload.error = "Missing x-account-id";
    res.status(400).json(payload);
    return null;
  }
  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({ ok: false, error: "无权访问此账号" });
    return null;
  }
  return accountId;
}

function registerAdminAutoFriendRoutes({
  app,
  provider,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  const access = { getAccountIdFromRequest, canAccessAccount };

  app.get("/api/auto-friend/status", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;
    try {
      const data = await provider.getAutoFriendStatus(accountId);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/auto-friend/scan", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    try {
      const data = await provider.scanAutoFriendCandidates(accountId, {
        gids: Array.isArray(body.gids) ? body.gids : [],
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/auto-friend/start", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    try {
      const data = await provider.startAutoFriendTask(accountId, {
        intervalSec: Number(body.intervalSec) || 5,
        gids: Array.isArray(body.gids) ? body.gids : [],
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/auto-friend/stop", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;
    try {
      const data = await provider.stopAutoFriendTask(accountId);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/auto-friend/send", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;
    const gid = Number((req.body || {}).gid);
    if (!Number.isFinite(gid) || gid <= 0) {
      return res.status(400).json({ ok: false, error: "无效的 GID" });
    }
    try {
      const data = await provider.sendFriendApplication(accountId, gid);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });
}

module.exports = { registerAdminAutoFriendRoutes };
