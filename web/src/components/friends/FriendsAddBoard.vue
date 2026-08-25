<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { getPlatformClass, getPlatformLabel, useAccountStore } from '@/stores/account'
import { useFriendStore } from '@/stores/friend'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  accountId: string
}>()

const emit = defineEmits<{
  (e: 'added'): void
}>()

const accountStore = useAccountStore()
const friendStore = useFriendStore()
const toast = useToastStore()

const { friendPosts, friendPostsLoading, friendPostsSaving, friendPostsAdding, friendPostsError } = storeToRefs(friendStore)

const gid = ref('')
const nick = ref('')
const platform = ref<string>('qq')
const remark = ref('')

const platformOptions = [
  { label: 'QQ', value: 'qq' },
  { label: '微信', value: 'wx' },
]

const myPost = computed(() => friendPosts.value.find(post => post.isMine) || null)

const visiblePosts = computed(() => friendPosts.value.filter(post => !post.isMine))

const accountGid = computed(() => String(props.accountId ? accountStore.currentAccount?.gid || '' : ''))
const accountNick = computed(() => String(props.accountId ? accountStore.currentAccount?.nick || '' : ''))

function prefillForm() {
  const post = myPost.value
  if (post) {
    gid.value = String(post.gid)
    nick.value = post.nick
    platform.value = post.platform || 'qq'
    remark.value = post.remark || ''
  }
  else {
    gid.value = accountGid.value
    nick.value = accountNick.value
    platform.value = 'qq'
    remark.value = ''
  }
}

async function loadPosts() {
  await friendStore.fetchFriendPosts()
  prefillForm()
}

async function handlePublish() {
  if (!gid.value.trim()) {
    toast.error('请填写你的游戏 GID')
    return
  }
  const result = await friendStore.publishFriendPost({
    gid: gid.value,
    nick: nick.value,
    platform: platform.value,
    remark: remark.value,
  })
  if (result.ok) {
    toast.success(myPost.value ? '已更新加好友发布信息' : '已发布加好友信息')
    prefillForm()
  }
  else {
    toast.error(result.message || '发布失败')
  }
}

async function handleRemoveMyPost() {
  const result = await friendStore.removeMyFriendPost()
  if (result.ok) {
    toast.success('已删除你的加好友发布信息')
    gid.value = accountGid.value
    nick.value = accountNick.value
    remark.value = ''
  }
  else {
    toast.error(result.message || '删除失败')
  }
}

async function handleAdd(post: any) {
  const result = await friendStore.addFriendFromPost(props.accountId, post.id)
  if (result.ok) {
    toast.success(result.message || '已添加')
    if (result.added)
      emit('added')
  }
  else {
    toast.error(result.message || '添加失败')
  }
}

function formatTime(timestamp: number) {
  const ts = Number(timestamp) || 0
  if (!ts)
    return ''
  const date = new Date(ts)
  const now = new Date()
  const sameDay = now.getFullYear() === date.getFullYear()
    && now.getMonth() === date.getMonth()
    && now.getDate() === date.getDate()
  if (sameDay)
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  if (now.getFullYear() === date.getFullYear())
    return `${date.getMonth() + 1}-${date.getDate()}`
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

onMounted(() => {
  loadPosts()
})

watch(() => props.accountId, () => {
  loadPosts()
})
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 class="flex items-center gap-2 text-base text-gray-800 font-semibold dark:text-gray-100">
            <div class="i-carbon-add-alt text-lg" />
            我的加好友信息
          </h3>
          <p class="mt-1 text-xs text-gray-400">
            填写你的游戏 GID 并发布，本面板其他用户就能看到并把你加为好友
          </p>
        </div>
        <div v-if="myPost" class="shrink-0 rounded bg-green-100 px-2 py-1 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
          已发布
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <BaseInput v-model="gid" label="游戏 GID" placeholder="请输入你的游戏 GID" />
        <BaseInput v-model="nick" label="昵称（可选）" placeholder="你的游戏昵称" />
        <BaseSelect v-model="platform" label="平台（可选）" :options="platformOptions" />
        <BaseInput v-model="remark" label="备注（可选）" placeholder="例如：每天互浇互偷，欢迎加好友" />
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <BaseButton :loading="friendPostsSaving" @click="handlePublish">
          {{ myPost ? '更新发布' : '发布加好友信息' }}
        </BaseButton>
        <BaseButton v-if="myPost" variant="danger" :loading="friendPostsSaving" @click="handleRemoveMyPost">
          删除我的发布
        </BaseButton>
        <span class="text-xs text-gray-400">
          每用户最多一条发布，重复发布会覆盖更新
        </span>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-base text-gray-800 font-semibold dark:text-gray-100">
        本面板用户发布的互加好友信息
      </h3>
      <button
        class="rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-600"
        :disabled="friendPostsLoading"
        @click="loadPosts"
      >
        <div v-if="friendPostsLoading" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
        刷新
      </button>
      <span class="text-xs text-gray-400">
        共 {{ friendPosts.length }} 条
      </span>
    </div>

    <div v-if="friendPostsLoading && friendPosts.length === 0" class="flex justify-center py-12">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
    </div>

    <div v-else-if="friendPostsError" class="rounded-lg bg-red-50 px-4 py-6 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
      {{ friendPostsError }}
    </div>

    <div v-else-if="visiblePosts.length === 0" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      <div class="i-carbon-user-multiple mx-auto mb-3 text-4xl text-gray-300" />
      <div class="text-base text-gray-700 font-medium dark:text-gray-200">
        还没有人发布加好友信息
      </div>
      <p class="mt-2 text-sm text-gray-400">
        成为第一个发布的人吧，填好上面的 GID 就能开始互加好友
      </p>
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2">
      <div
        v-for="post in visiblePosts"
        :key="post.id"
        class="flex flex-col justify-between gap-3 rounded-lg bg-white p-4 shadow dark:bg-gray-800"
      >
        <div class="flex items-start gap-3">
          <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-1 ring-gray-100 dark:bg-gray-600 dark:ring-gray-700">
            <div class="i-carbon-user text-gray-400" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="max-w-full truncate text-base text-gray-800 font-medium dark:text-gray-100">
                {{ post.nick || `玩家 ${post.gid}` }}
              </span>
              <span class="rounded px-1.5 py-0.5 text-xs" :class="getPlatformClass(post.platform)">
                {{ getPlatformLabel(post.platform) }}
              </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
              <span>GID {{ post.gid }}</span>
              <span v-if="post.remark" class="truncate">{{ post.remark }}</span>
            </div>
            <div class="mt-1 text-xs text-gray-400">
              发布者 {{ post.username }} · {{ formatTime(post.updatedAt) }}
            </div>
          </div>
        </div>
        <div class="flex justify-end">
          <BaseButton
            :loading="friendPostsAdding[post.id]"
            :disabled="post.isKnown"
            variant="primary"
            @click="handleAdd(post)"
          >
            {{ post.isKnown ? '已添加' : '加为好友' }}
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
