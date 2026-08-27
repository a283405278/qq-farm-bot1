import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useQqLoginStore = defineStore('qq-login', () => {
  const isLoading = ref(false)
  const qrImage = ref<string | null>(null)
  const qrCreatedAt = ref(0)
  const loginCode = ref('')
  const status = ref<'idle' | 'qr_loading' | 'qr_ready' | 'scanning' | 'success' | 'error'>('idle')
  const statusMessage = ref('')
  const errorMessage = ref('')
  const nickname = ref('')
  const uin = ref('')
  const avatar = ref('')

  function buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-admin-token': localStorage.getItem('admin_token') || '',
    }
  }

  function resetState() {
    qrImage.value = null
    qrCreatedAt.value = 0
    loginCode.value = ''
    status.value = 'idle'
    statusMessage.value = ''
    errorMessage.value = ''
    nickname.value = ''
    uin.value = ''
    avatar.value = ''
  }

  async function getQRCode(): Promise<boolean> {
    isLoading.value = true
    status.value = 'qr_loading'
    statusMessage.value = '正在获取二维码...'
    errorMessage.value = ''

    try {
      const response = await fetch('/api/qr/create', {
        method: 'POST',
        headers: buildHeaders(),
        body: '{}',
      })
      const result = await response.json()
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || '获取二维码失败')
      }
      const data = result.data || {}
      loginCode.value = data.code || ''
      qrImage.value = data.image || ''
      qrCreatedAt.value = Date.now()
      status.value = 'qr_ready'
      statusMessage.value = '请使用 QQ 扫描二维码登录'
      return true
    }
    catch (e: any) {
      status.value = 'error'
      qrCreatedAt.value = 0
      errorMessage.value = `请求失败: ${e.message || '获取二维码失败'}`
      return false
    }
    finally {
      isLoading.value = false
    }
  }

  async function checkLogin(): Promise<{ success: boolean, code?: string }> {
    if (!loginCode.value) {
      return { success: false }
    }

    status.value = 'scanning'
    statusMessage.value = '正在检查登录状态...'

    try {
      const response = await fetch('/api/qr/check', {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ code: loginCode.value }),
      })
      const result = await response.json()
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || '检查登录状态失败')
      }
      const data = result.data || {}
      const qrStatus = data.status

      if (qrStatus === 'OK') {
        nickname.value = data.nickname || ''
        uin.value = data.uin || ''
        avatar.value = data.avatar || ''
        status.value = 'success'
        statusMessage.value = `登录成功！欢迎 ${nickname.value || 'QQ 用户'}`
        return { success: true, code: data.code || '' }
      }
      if (qrStatus === 'Used') {
        status.value = 'error'
        errorMessage.value = '二维码已失效，请刷新重试'
        return { success: false }
      }
      if (qrStatus === 'Wait') {
        status.value = 'qr_ready'
        statusMessage.value = '等待扫码中'
        return { success: false }
      }
      status.value = 'error'
      errorMessage.value = data.error || '登录失败'
      return { success: false }
    }
    catch (e: any) {
      status.value = 'error'
      errorMessage.value = `请求失败: ${e.message || '检查登录状态失败'}`
      return { success: false }
    }
  }

  return {
    isLoading,
    qrImage,
    qrCreatedAt,
    loginCode,
    status,
    statusMessage,
    errorMessage,
    nickname,
    uin,
    avatar,
    resetState,
    getQRCode,
    checkLogin,
  }
})
