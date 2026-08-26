import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export interface BlacklistItem {
  gid: number
  name: string
  avatarUrl: string
}

export interface KnownFriendSettings {
  knownFriendGids: number[]
  knownFriendGidSyncCooldownSec: number
  friendsListCacheTtlSec: number
}

export interface FriendPost {
  id: string
  username: string
  gid: number
  nick: string
  platform: 'qq' | 'wx'
  remark: string
  createdAt: number
  updatedAt: number
  isMine: boolean
  isKnown: boolean
}

export interface AutoFriendCandidate {
  gid: number
  nick: string
  level: number
  source: string
}

export interface AutoFriendStatus {
  running: boolean
  status: 'idle' | 'running' | 'completed' | 'stopped' | 'error'
  intervalSec: number
  progress: number
  index: number
  candidateCount: number
  total: number
  processed: number
  success: number
  failed: number
  skippedApplied: number
  skippedFriend: number
  skippedBlacklist: number
  skippedSelf: number
  lastError: string
  startedAt: number
  finishedAt: number
  appliedCount: number
}

export const useFriendStore = defineStore('friend', () => {
  const friends = ref<any[]>([])
  const loading = ref(false)
  const dogInfoLoading = ref(false)
  const friendLands = ref<Record<string, any[]>>({})
  const friendLandsLoading = ref<Record<string, boolean>>({})
  const blacklist = ref<BlacklistItem[]>([])
  const interactRecords = ref<any[]>([])
  const interactLoading = ref(false)
  const interactError = ref('')

  const knownFriendGids = ref<number[]>([])
  const knownFriendGidSyncCooldownSec = ref(600)
  const friendsListCacheTtlSec = ref(60)
  const knownFriendSettingsLoading = ref(false)
  const knownFriendSettingsSaving = ref(false)

  const friendPosts = ref<FriendPost[]>([])
  const friendPostsLoading = ref(false)
  const friendPostsSaving = ref(false)
  const friendPostsAdding = ref<Record<string, boolean>>({})
  const friendPostsError = ref('')

  const autoFriendStatus = ref<AutoFriendStatus | null>(null)
  const autoFriendCandidates = ref<AutoFriendCandidate[]>([])
  const autoFriendLoading = ref(false)
  const autoFriendScanning = ref(false)
  const autoFriendStarting = ref(false)
  const autoFriendStopping = ref(false)
  const autoFriendError = ref('')

  function clearFriendData() {
    friends.value = []
    friendLands.value = {}
    friendLandsLoading.value = {}
    blacklist.value = []
    interactRecords.value = []
    interactError.value = ''
    knownFriendGids.value = []
    knownFriendGidSyncCooldownSec.value = 600
    friendsListCacheTtlSec.value = 60
    friendPosts.value = []
    friendPostsError.value = ''
    autoFriendStatus.value = null
    autoFriendCandidates.value = []
    autoFriendError.value = ''
  }

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  function buildPlantSummaryFromDetail(lands: any[], summary: any) {
    let stealNum = 0
    let dryNum = 0
    let weedNum = 0
    let insectNum = 0

    const detailLands = Array.isArray(lands) ? lands : []
    if (detailLands.length > 0) {
      for (const land of detailLands) {
        if (!land || !land.unlocked)
          continue
        if (land.status === 'stealable')
          stealNum++
        if (land.needWater)
          dryNum++
        if (land.needWeed)
          weedNum++
        if (land.needBug)
          insectNum++
      }
    }
    else {
      stealNum = Array.isArray(summary?.stealable) ? summary.stealable.length : 0
      dryNum = Array.isArray(summary?.needWater) ? summary.needWater.length : 0
      weedNum = Array.isArray(summary?.needWeed) ? summary.needWeed.length : 0
      insectNum = Array.isArray(summary?.needBug) ? summary.needBug.length : 0
    }

    return {
      stealNum: Number(stealNum) || 0,
      dryNum: Number(dryNum) || 0,
      weedNum: Number(weedNum) || 0,
      insectNum: Number(insectNum) || 0,
    }
  }

  function syncFriendPlantSummary(friendId: string, lands: any[], summary: any) {
    const key = String(friendId)
    const idx = friends.value.findIndex(f => String(f?.gid || '') === key)
    if (idx < 0)
      return

    const nextPlant = buildPlantSummaryFromDetail(lands, summary)
    friends.value[idx] = {
      ...friends.value[idx],
      plant: nextPlant,
    }
  }

  async function fetchFriends(accountId: string, forceSync = false) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    loading.value = true
    try {
      const res = await api.get('/api/friends', {
        headers: { 'x-account-id': accountId },
        params: forceSync ? { forceSync: 'true' } : {},
      })
      if (!isCurrentAccount(requestedId))
        return
      if (res.data.ok) {
        friends.value = res.data.data || []
      }
    }
    finally {
      loading.value = false
    }
  }

  async function fetchFriendsDogInfo(accountId: string) {
    if (!accountId)
      return { ok: false, error: '账号ID无效' }
    const requestedId = String(accountId)
    dogInfoLoading.value = true
    try {
      const res = await api.post('/api/friends/fetch-dog-info', {}, {
        headers: { 'x-account-id': accountId },
        timeout: 600000,
      })
      if (res.data.ok && Array.isArray(res.data.friends) && isCurrentAccount(requestedId)) {
        friends.value = res.data.friends
      }
      return {
        ok: !!res.data.ok,
        failCount: res.data.failCount || 0,
        blacklistCount: res.data.blacklistCount || 0,
        guardDogCount: res.data.guardDogCount || 0,
        error: res.data.error || '',
      }
    }
    catch (e: any) {
      return {
        ok: false,
        error: e?.response?.data?.error || e?.message || '获取狗信息失败',
      }
    }
    finally {
      dogInfoLoading.value = false
    }
  }

  async function fetchFriendDogInfo(accountId: string, gid: string | number) {
    if (!accountId || !gid)
      return null
    try {
      const res = await api.get(`/api/friend/${gid}/dog`, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok)
        return res.data.data
    }
    catch {
      // ignore
    }
    return null
  }
  async function fetchInteractRecords(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    interactLoading.value = true
    interactError.value = ''

    try {
      const res = await api.get('/api/interact-records', {
        headers: { 'x-account-id': accountId },
      })
      if (!isCurrentAccount(requestedId))
        return
      if (res.data.ok) {
        interactRecords.value = Array.isArray(res.data.data) ? res.data.data : []
      }
      else {
        interactError.value = res.data.error || '加载访客记录失败'
      }
    }
    catch (error: any) {
      interactError.value = error?.response?.data?.error || error?.message || '加载访客记录失败'
    }
    finally {
      interactLoading.value = false
    }
  }

  async function fetchBlacklist(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    try {
      const res = await api.get('/api/friend-blacklist', {
        headers: { 'x-account-id': accountId },
      })
      if (!isCurrentAccount(requestedId))
        return
      if (res.data.ok) {
        blacklist.value = res.data.data || []
      }
    }
    catch { /* ignore */ }
  }

  async function toggleBlacklist(accountId: string, gid: number) {
    if (!accountId || !gid)
      return
    const res = await api.post('/api/friend-blacklist/toggle', { gid }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      blacklist.value = res.data.data || []
    }
  }

  async function fetchFriendLands(accountId: string, friendId: string) {
    if (!accountId || !friendId)
      return
    const requestedId = String(accountId)
    friendLandsLoading.value[friendId] = true
    try {
      const res = await api.get(`/api/friend/${friendId}/lands`, {
        headers: { 'x-account-id': accountId },
      })
      if (!isCurrentAccount(requestedId))
        return
      if (res.data.ok) {
        const lands = res.data.data.lands || []
        const summary = res.data.data.summary || null
        friendLands.value[friendId] = lands
        syncFriendPlantSummary(friendId, lands, summary)
      }
    }
    finally {
      friendLandsLoading.value[friendId] = false
    }
  }

  async function operate(accountId: string, friendId: string, opType: string) {
    if (!accountId || !friendId)
      return { ok: false, message: '参数无效' }
    try {
      const res = await api.post(`/api/friend/${friendId}/op`, { opType }, {
        headers: { 'x-account-id': accountId },
      })
      const result = res.data?.data || res.data || {}
      await fetchFriends(accountId)
      if (friendLands.value[friendId]) {
        await fetchFriendLands(accountId, friendId)
      }
      return result
    }
    catch (e: any) {
      return { ok: false, message: e?.response?.data?.error || e?.message || '操作失败' }
    }
  }

  function applyKnownFriendSettings(data: KnownFriendSettings | null | undefined) {
    if (!data)
      return
    knownFriendGids.value = Array.isArray(data.knownFriendGids) ? data.knownFriendGids : []
    knownFriendGidSyncCooldownSec.value = Number.isFinite(data.knownFriendGidSyncCooldownSec)
      ? Math.max(30, Math.min(86400, data.knownFriendGidSyncCooldownSec))
      : 600
    friendsListCacheTtlSec.value = Number.isFinite(data.friendsListCacheTtlSec)
      ? Math.max(10, Math.min(86400, data.friendsListCacheTtlSec))
      : 60
  }

  async function fetchKnownFriendSettings(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    knownFriendSettingsLoading.value = true
    try {
      const res = await api.get('/api/friend-known-gids', {
        headers: { 'x-account-id': accountId },
      })
      if (!isCurrentAccount(requestedId))
        return
      if (res.data.ok) {
        applyKnownFriendSettings(res.data.data)
      }
    }
    finally {
      knownFriendSettingsLoading.value = false
    }
  }

  async function saveKnownFriendSettings(accountId: string, payload: Partial<KnownFriendSettings>) {
    if (!accountId)
      return
    knownFriendSettingsSaving.value = true
    try {
      const res = await api.post('/api/friend-known-gids', payload, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        applyKnownFriendSettings(res.data.data)
      }
    }
    finally {
      knownFriendSettingsSaving.value = false
    }
  }

  async function removeKnownFriendGid(accountId: string, gid: number) {
    if (!accountId || !gid)
      return
    knownFriendSettingsSaving.value = true
    try {
      const res = await api.post('/api/friend-known-gids/remove', { gid }, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        applyKnownFriendSettings(res.data.data)
      }
    }
    finally {
      knownFriendSettingsSaving.value = false
    }
  }

  async function batchAddKnownFriendGids(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return { ok: false, addedCount: 0 }
    knownFriendSettingsSaving.value = true
    try {
      const res = await api.post('/api/friend-known-gids/batch-add', { gids }, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        applyKnownFriendSettings(res.data.data)
      }
      return { ok: res.data.ok, addedCount: res.data.addedCount || 0 }
    }
    finally {
      knownFriendSettingsSaving.value = false
    }
  }

  async function removeUnsyncedKnownFriendGids(accountId: string, gids: number[]) {
    if (!accountId || !gids || gids.length === 0)
      return { ok: false, removedCount: 0 }
    knownFriendSettingsSaving.value = true
    try {
      const res = await api.post('/api/friend-known-gids/batch-remove', { gids }, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        applyKnownFriendSettings(res.data.data)
      }
      return { ok: res.data.ok, removedCount: res.data.removedCount || 0 }
    }
    finally {
      knownFriendSettingsSaving.value = false
    }
  }

  async function fetchFriendPosts() {
    friendPostsLoading.value = true
    friendPostsError.value = ''
    try {
      const res = await api.get('/api/friend-posts')
      if (res.data.ok) {
        friendPosts.value = Array.isArray(res.data.data) ? res.data.data : []
      }
      else {
        friendPostsError.value = res.data.error || '加载加好友发布信息失败'
      }
    }
    catch (e: any) {
      friendPostsError.value = e?.response?.data?.error || e?.message || '加载加好友发布信息失败'
    }
    finally {
      friendPostsLoading.value = false
    }
  }

  async function publishFriendPost(payload: { gid: number | string, nick: string, platform: string, remark: string }) {
    if (!payload || !Number(payload.gid))
      return { ok: false, message: '请输入有效的游戏 GID' }
    friendPostsSaving.value = true
    try {
      const res = await api.post('/api/friend-posts', {
        gid: Number(payload.gid),
        nick: payload.nick,
        platform: payload.platform,
        remark: payload.remark,
      })
      if (res.data.ok) {
        const post = res.data.data
        const idx = friendPosts.value.findIndex(p => p.id === post.id)
        if (idx >= 0)
          friendPosts.value[idx] = post
        else
          friendPosts.value.unshift(post)
      }
      return { ok: !!res.data.ok, message: res.data.error || '' }
    }
    catch (e: any) {
      return { ok: false, message: e?.response?.data?.error || e?.message || '发布失败' }
    }
    finally {
      friendPostsSaving.value = false
    }
  }

  async function removeMyFriendPost() {
    friendPostsSaving.value = true
    try {
      const res = await api.delete('/api/friend-posts')
      if (res.data.ok)
        friendPosts.value = friendPosts.value.filter(p => !p.isMine)
      return { ok: !!res.data.ok }
    }
    catch (e: any) {
      return { ok: false, message: e?.response?.data?.error || e?.message || '删除失败' }
    }
    finally {
      friendPostsSaving.value = false
    }
  }

  async function addFriendFromPost(accountId: string, postId: string) {
    if (!accountId || !postId)
      return { ok: false, message: '参数无效' }
    friendPostsAdding.value[postId] = true
    try {
      const res = await api.post(`/api/friend-posts/${postId}/add`, {}, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        friendPosts.value = friendPosts.value.map(p => (
          p.id === postId ? { ...p, isKnown: true } : p
        ))
      }
      return { ok: !!res.data.ok, added: !!res.data.added, message: res.data.message || res.data.error || '' }
    }
    catch (e: any) {
      return { ok: false, message: e?.response?.data?.error || e?.message || '添加失败' }
    }
    finally {
      delete friendPostsAdding.value[postId]
    }
  }

  async function fetchAutoFriendStatus(accountId: string) {
    if (!accountId)
      return
    autoFriendLoading.value = true
    try {
      const res = await api.get('/api/auto-friend/status', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok)
        autoFriendStatus.value = res.data.data
      else
        autoFriendError.value = res.data.error || '获取自动加好友状态失败'
    }
    catch (e: any) {
      autoFriendError.value = e?.response?.data?.error || e?.message || '获取自动加好友状态失败'
    }
    finally {
      autoFriendLoading.value = false
    }
  }

  async function scanAutoFriend(
    accountId: string,
    extraGids: number[] = [],
  ): Promise<
    | { ok: true, candidates: AutoFriendCandidate[], message?: string }
    | { ok: false, message: string }
  > {
    if (!accountId)
      return { ok: false, message: '参数无效' }
    autoFriendScanning.value = true
    autoFriendError.value = ''
    try {
      const res = await api.post('/api/auto-friend/scan', { gids: extraGids }, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        autoFriendCandidates.value = res.data.data?.candidates || []
        autoFriendStatus.value = {
          ...(autoFriendStatus.value || {} as AutoFriendStatus),
          ...res.data.data?.stats,
          candidateCount: res.data.data?.candidates?.length || 0,
        }
        return { ok: true, candidates: autoFriendCandidates.value }
      }
      return { ok: false, message: res.data.error || '扫描失败' }
    }
    catch (e: any) {
      return { ok: false, message: e?.response?.data?.error || e?.message || '扫描失败' }
    }
    finally {
      autoFriendScanning.value = false
    }
  }

  async function startAutoFriendTask(accountId: string, intervalSec: number, extraGids: number[] = []) {
    if (!accountId)
      return { ok: false, message: '参数无效' }
    autoFriendStarting.value = true
    autoFriendError.value = ''
    try {
      const res = await api.post('/api/auto-friend/start', { intervalSec, gids: extraGids }, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        autoFriendStatus.value = res.data.data
        return { ok: true }
      }
      return { ok: false, message: res.data.error || '启动失败' }
    }
    catch (e: any) {
      return { ok: false, message: e?.response?.data?.error || e?.message || '启动失败' }
    }
    finally {
      autoFriendStarting.value = false
    }
  }

  async function stopAutoFriendTask(accountId: string) {
    if (!accountId)
      return { ok: false, message: '参数无效' }
    autoFriendStopping.value = true
    try {
      const res = await api.post('/api/auto-friend/stop', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        autoFriendStatus.value = res.data.data
        return { ok: true }
      }
      return { ok: false, message: res.data.error || '停止失败' }
    }
    catch (e: any) {
      return { ok: false, message: e?.response?.data?.error || e?.message || '停止失败' }
    }
    finally {
      autoFriendStopping.value = false
    }
  }

  async function sendFriendApplicationTo(accountId: string, gid: number) {
    if (!accountId || !gid)
      return { ok: false, message: '参数无效' }
    try {
      const res = await api.post('/api/auto-friend/send', { gid }, {
        headers: { 'x-account-id': accountId },
      })
      return { ok: !!res.data.ok, message: res.data.data?.ok ? '申请已发送' : (res.data.error || '发送失败') }
    }
    catch (e: any) {
      return { ok: false, message: e?.response?.data?.error || e?.message || '发送失败' }
    }
  }

  return {
    friends,
    loading,
    dogInfoLoading,
    friendLands,
    friendLandsLoading,
    blacklist,
    interactRecords,
    interactLoading,
    interactError,
    knownFriendGids,
    knownFriendGidSyncCooldownSec,
    friendsListCacheTtlSec,
    knownFriendSettingsLoading,
    knownFriendSettingsSaving,
    friendPosts,
    friendPostsLoading,
    friendPostsSaving,
    friendPostsAdding,
    friendPostsError,
    clearFriendData,
    fetchFriends,
    fetchFriendsDogInfo,
    fetchFriendDogInfo,
    fetchBlacklist,
    toggleBlacklist,
    fetchInteractRecords,
    fetchFriendLands,
    operate,
    fetchKnownFriendSettings,
    saveKnownFriendSettings,
    removeKnownFriendGid,
    batchAddKnownFriendGids,
    removeUnsyncedKnownFriendGids,
    fetchFriendPosts,
    publishFriendPost,
    removeMyFriendPost,
    addFriendFromPost,
    autoFriendStatus,
    autoFriendCandidates,
    autoFriendLoading,
    autoFriendScanning,
    autoFriendStarting,
    autoFriendStopping,
    autoFriendError,
    fetchAutoFriendStatus,
    scanAutoFriend,
    startAutoFriendTask,
    stopAutoFriendTask,
    sendFriendApplicationTo,
  }
})
