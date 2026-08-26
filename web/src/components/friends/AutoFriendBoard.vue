<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useFriendStore } from '@/stores/friend'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  accountId: string
}>()

const friendStore = useFriendStore()
const toast = useToastStore()

const {
  autoFriendStatus,
  autoFriendCandidates,
  autoFriendLoading,
  autoFriendScanning,
  autoFriendStarting,
  autoFriendStopping,
  autoFriendError,
} = storeToRefs(friendStore)

const intervalSec = ref(5)
const extraGidInput = ref('')
const sendingGid = ref<number | null>(null)

const running = computed(() => !!autoFriendStatus.value?.running)
const statusLabel = computed(() => {
  const map: Record<string, string> = {
    idle: '空闲',
    running: '运行中',
    completed: '已完成',
    stopped: '已停止',
    error: '出错',
  }
  return map[String(autoFriendStatus.value?.status || 'idle')] || '空闲'
})

const totalApplied = computed(() => autoFriendStatus.value?.appliedCount ?? 0)

const candidateCount = computed(() => autoFriendStatus.value?.candidateCount ?? autoFriendCandidates.value.length)

function parseExtraGids(): number[] {
  const text = String(extraGidInput.value || '').trim()
  if (!text)
    return []
  const gids: number[] = []
  for (const part of text.split(/[,，\s]+/)) {
    const num = Number.parseInt(part, 10)
    if (Number.isFinite(num) && num > 0 && !gids.includes(num))
      gids.push(num)
  }
  return gids
}

async function loadStatus() {
  if (!props.accountId)
    return
  await friendStore.fetchAutoFriendStatus(props.accountId)
}

async function handleScan() {
  if (!props.accountId)
    return
  const result = await friendStore.scanAutoFriend(props.accountId, parseExtraGids())
  if (result.ok) {
    toast.success(`扫描完成，共 ${result.candidates.length} 个候选`)
  }
  else {
    toast.error(result.message || '扫描失败')
  }
}

async function handleStart() {
  if (!props.accountId)
    return
  const sec = Number(intervalSec.value) || 5
  const result = await friendStore.startAutoFriendTask(props.accountId, sec, parseExtraGids())
  if (result.ok) {
    toast.success(`自动加好友任务已启动，间隔 ${sec} 秒`)
  }
  else {
    toast.error(result.message || '启动失败')
  }
}

async function handleStop() {
  if (!props.accountId)
    return
  const result = await friendStore.stopAutoFriendTask(props.accountId)
  if (result.ok) {
    toast.success('自动加好友任务已停止')
  }
  else {
    toast.error(result.message || '停止失败')
  }
}

async function handleSend(gid: number) {
  if (!props.accountId)
    return
  sendingGid.value = gid
  try {
    const result = await friendStore.sendFriendApplicationTo(props.accountId, gid)
    if (result.ok) {
      toast.success(`已向 GID ${gid} 发送好友申请`)
      await loadStatus()
    }
    else {
      toast.error(result.message || `向 GID ${gid} 发送申请失败`)
    }
  }
  finally {
    sendingGid.value = null
  }
}

function statusBadgeClass() {
  if (running.value)
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
  if (String(autoFriendStatus.value?.status || '') === 'error')
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  if (String(autoFriendStatus.value?.status || '') === 'completed')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
}

onMounted(() => {
  loadStatus()
})

watch(() => props.accountId, () => {
  loadStatus()
})
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 class="flex items-center gap-2 text-base text-gray-800 font-semibold dark:text-gray-100">
            <div class="i-carbon-user-profile-add text-lg" />
            自动加好友
          </h3>
          <p class="mt-1 text-xs text-gray-400">
            扫描最近访客，逐个发送游戏内好友申请，对方接受后即可互相偷菜
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span class="rounded-full px-2 py-1 text-xs font-medium" :class="statusBadgeClass()">
            {{ statusLabel }}
          </span>
          <button
            class="rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-600"
            :disabled="autoFriendLoading"
            @click="loadStatus"
          >
            <div v-if="autoFriendLoading" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
            刷新状态
          </button>
        </div>
      </div>

      <div v-if="autoFriendError" class="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
        {{ autoFriendError }}
      </div>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-700/50">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            已申请 GID
          </div>
          <div class="mt-1 text-lg font-semibold">
            {{ totalApplied }}
          </div>
        </div>
        <div class="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-700/50">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            候选好友
          </div>
          <div class="mt-1 text-lg font-semibold">
            {{ candidateCount }}
          </div>
        </div>
        <div class="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-700/50">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            成功 / 失败
          </div>
          <div class="mt-1 text-lg font-semibold">
            <span class="text-green-600 dark:text-green-400">{{ autoFriendStatus?.success || 0 }}</span>
            <span class="mx-1 text-gray-400">/</span>
            <span class="text-red-600 dark:text-red-400">{{ autoFriendStatus?.failed || 0 }}</span>
          </div>
        </div>
        <div class="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-700/50">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            进度
          </div>
          <div class="mt-1 text-lg font-semibold">
            {{ autoFriendStatus?.processed || 0 }} / {{ autoFriendStatus?.candidateCount || 0 }}
          </div>
        </div>
      </div>

      <div v-if="autoFriendStatus?.lastError" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300">
        最近错误：{{ autoFriendStatus.lastError }}
      </div>

      <div class="grid mt-4 gap-3 sm:grid-cols-2">
        <BaseInput v-model="intervalSec" type="number" min="1" max="3600" step="1" label="申请间隔（秒）" placeholder="1-3600，默认 5" />
        <BaseInput v-model="extraGidInput" label="补充 GID（可选）" placeholder="逗号或空格分隔的 GID 列表" />
      </div>
      <p class="mt-2 text-xs text-gray-400">
        补充 GID 会与最近访客合并为候选，按等级从高到低排序。任务启动后会串行逐个发送申请，间隔为上方设置的值。
      </p>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <BaseButton :loading="autoFriendScanning" :disabled="running" variant="outline" @click="handleScan">
          扫描候选
        </BaseButton>
        <BaseButton :loading="autoFriendStarting" :disabled="running" variant="primary" @click="handleStart">
          启动任务
        </BaseButton>
        <BaseButton v-if="running" :loading="autoFriendStopping" variant="danger" @click="handleStop">
          停止任务
        </BaseButton>
      </div>
    </div>

    <div class="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h3 class="text-base text-gray-800 font-semibold dark:text-gray-100">
          候选玩家
        </h3>
        <span class="text-xs text-gray-400">
          共 {{ autoFriendCandidates.length }} 个
        </span>
      </div>

      <div v-if="autoFriendCandidates.length === 0" class="rounded-lg bg-gray-50 py-10 text-center text-gray-400 dark:bg-gray-700/50">
        暂无候选，点击「扫描候选」从最近访客中获取
      </div>

      <div v-else class="grid gap-3 sm:grid-cols-2">
        <div
          v-for="candidate in autoFriendCandidates"
          :key="candidate.gid"
          class="flex items-center justify-between gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50"
        >
          <div class="min-w-0">
            <div class="truncate text-sm text-gray-800 font-medium dark:text-gray-100">
              {{ candidate.nick || `玩家 ${candidate.gid}` }}
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
              <span>GID {{ candidate.gid }}</span>
              <span v-if="candidate.level">Lv.{{ candidate.level }}</span>
              <span class="rounded bg-gray-200 px-1.5 py-0.5 dark:bg-gray-600">
                {{ candidate.source === 'visitor' ? '访客' : '补充' }}
              </span>
            </div>
          </div>
          <BaseButton
            size="sm"
            :loading="sendingGid === candidate.gid"
            :disabled="running"
            variant="primary"
            @click="handleSend(candidate.gid)"
          >
            发送申请
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
