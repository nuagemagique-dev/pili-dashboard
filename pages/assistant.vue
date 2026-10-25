<template>
  <div class="flex-1 flex flex-col">
    <PiliSubHeader v-if="isMobile" :title="t('assistant.title')" />

    <div
      class="flex flex-col gap-3 w-full"
      :class="isMobile ? 'px-4 pt-1 pb-5' : 'p-3 sm:p-4 md:p-6 max-w-2xl mx-auto'"
    >
      <h1 v-if="!isMobile" class="text-lg sm:text-2xl font-bold">{{ t('assistant.title') }}</h1>
      <p class="text-[13px] sm:text-sm text-muted leading-snug">{{ t('assistant.description') }}</p>

      <!-- Bot and state -->
      <div class="p-4 rounded-[14px] bg-elevated border border-default flex flex-col gap-3">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-base font-bold">{{ t('assistant.bot') }}</span>
          <PiliChip :tone="stateTone" size="sm">{{ t(stateKey(connection)) }}</PiliChip>
        </div>
        <p v-if="stateDetail" class="text-[13px] text-muted leading-snug">{{ stateDetail }}</p>
        <div v-if="connection?.enabled && botLink" class="flex items-center gap-3 flex-wrap">
          <span class="font-mono text-sm">@{{ connection.botUsername }}</span>
          <UButton
            :label="t('assistant.openInTelegram')"
            icon="i-lucide-external-link"
            color="neutral"
            variant="outline"
            :to="botLink"
            external
            target="_blank"
          />
        </div>
      </div>

      <template v-if="connection?.enabled">
        <!-- Linked accounts -->
        <div class="p-4 rounded-[14px] bg-elevated border border-default flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <span class="text-base font-bold">{{ t('assistant.accounts.title') }}</span>
            <span class="text-sm text-muted">
              {{ connection.accounts.length }} / {{ connection.maxAccounts }}
            </span>
          </div>

          <p v-if="!connection.accounts.length" class="text-[13px] text-muted leading-snug">
            {{ t('assistant.accounts.empty') }}
          </p>
          <ul v-else class="flex flex-col divide-y divide-default">
            <li
              v-for="account in connection.accounts"
              :key="account.id"
              class="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3 flex-wrap"
            >
              <div class="flex-1 min-w-0">
                <div class="text-sm font-bold truncate">
                  {{ account.name }}
                  <span v-if="account.username" class="font-normal text-muted"
                    >@{{ account.username }}</span
                  >
                </div>
                <div class="text-xs text-muted">
                  {{ t('assistant.accounts.linkedOn', { time: formatTime(account.linkedAt) }) }}
                </div>
              </div>
              <div class="flex gap-2">
                <UButton
                  v-if="confirmingRemoveId !== account.id"
                  :label="t('assistant.accounts.remove')"
                  color="neutral"
                  variant="outline"
                  @click="confirmingRemoveId = account.id"
                />
                <template v-else>
                  <UButton
                    :label="t('assistant.accounts.removeConfirm')"
                    color="error"
                    :loading="removingId === account.id"
                    @click="removeAccount(account.id)"
                  />
                  <UButton
                    :label="t('common.cancel')"
                    color="neutral"
                    variant="ghost"
                    @click="confirmingRemoveId = ''"
                  />
                </template>
              </div>
            </li>
          </ul>

          <p
            v-if="connection.accounts.length >= connection.maxAccounts"
            class="text-[13px] text-muted leading-snug"
          >
            {{ t('assistant.accounts.full', { max: connection.maxAccounts }) }}
          </p>
          <UButton
            v-else-if="!link"
            :label="t('assistant.accounts.add')"
            icon="i-lucide-user-plus"
            size="lg"
            class="self-start"
            :loading="starting"
            :disabled="!canLinkAccount(connection)"
            @click="startLink"
          />
        </div>

        <!-- Link panel -->
        <div
          v-if="link"
          class="p-4 rounded-[14px] bg-elevated border border-default flex flex-col gap-3"
          aria-live="polite"
        >
          <span class="text-base font-bold">{{ t(`assistant.link.${linkKey}`, linkParams) }}</span>

          <template v-if="link.status === 'WAIT'">
            <img
              v-if="qrPng"
              :src="qrPng"
              :alt="t('assistant.link.qrAlt')"
              class="bg-white p-3 rounded-xl w-60 h-60 self-center sm:self-start"
            />
            <p class="text-[13px] text-muted leading-snug">{{ t('assistant.link.scanHint') }}</p>
            <p class="text-xs text-muted">
              {{ t('assistant.link.validUntil', { time: formatClock(link.expiresAt) }) }}
            </p>
            <div class="flex flex-wrap gap-2">
              <UButton
                :label="t('assistant.openInTelegram')"
                icon="i-lucide-external-link"
                :to="link.url"
                external
                target="_blank"
              />
              <UButton
                :label="copied ? t('assistant.link.copied') : t('assistant.link.copy')"
                :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                color="neutral"
                variant="outline"
                @click="copyLink"
              />
              <UButton
                :label="t('common.cancel')"
                color="neutral"
                variant="ghost"
                @click="closeLink"
              />
            </div>
          </template>

          <template v-else-if="link.status === 'EXPIRED'">
            <div class="flex flex-wrap gap-2">
              <UButton :label="t('assistant.link.new')" :loading="starting" @click="startLink" />
              <UButton
                :label="t('common.cancel')"
                color="neutral"
                variant="ghost"
                @click="closeLink"
              />
            </div>
          </template>

          <template v-else-if="link.status === 'REFUSED_FULL'">
            <UButton
              :label="t('common.done')"
              color="neutral"
              variant="outline"
              class="self-start"
              @click="closeLink"
            />
          </template>
        </div>
      </template>

      <p v-if="error" class="text-sm text-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { renderSVG } from 'uqr'
import type { PiliChipTone } from '~/components/pili/PiliChip.vue'
import {
  type AssistantConnection,
  type AssistantLink,
  botUrl,
  canLinkAccount,
  errorKey,
  isLinkFinished,
  stateKey,
} from '~/utils/assistant'
import { gqlErrorCodes } from '~/utils/orders'
import { CONNECTION_FIELDS } from '~/composables/useAssistantStatus'

const { t, locale } = useI18n()
const isMobile = useIsMobile()
const { $gqlFetch } = useNuxtApp()
const { connection, reload } = useAssistantStatus()

const LINK_FIELDS = `
  id
  status
  url
  expiresAt
  account {
    id
    name
    username
    linkedAt
  }
`

const START_LINK = /* GraphQL */ `
  mutation StartAssistantLink {
    startAssistantLink {
      ${LINK_FIELDS}
    }
  }
`

const LINK_STATUS = /* GraphQL */ `
  query AssistantLink($id: String!) {
    assistantLink(id: $id) {
      ${LINK_FIELDS}
    }
  }
`

const REMOVE_ACCOUNT = /* GraphQL */ `
  mutation RemoveAssistantAccount($id: String!) {
    removeAssistantAccount(id: $id) {
      ${CONNECTION_FIELDS}
    }
  }
`

const link = ref<AssistantLink | null>(null)
const qrPng = ref('')
const starting = ref(false)
const removingId = ref('')
const confirmingRemoveId = ref('')
const copied = ref(false)
const error = ref('')

const STATE_TONES: Record<string, PiliChipTone> = {
  READY: 'success',
  NO_ACCOUNTS: 'warning',
  TOKEN_REJECTED: 'danger',
  CONFLICT: 'warning',
  UNAVAILABLE: 'warning',
}

const stateTone = computed<PiliChipTone>(() =>
  connection.value?.enabled ? (STATE_TONES[connection.value.state] ?? 'neutral') : 'neutral',
)

const botLink = computed(() => (connection.value ? botUrl(connection.value) : null))

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat(locale.value, {
    timeZone: 'Europe/Brussels',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))

const formatClock = (iso: string) =>
  new Intl.DateTimeFormat(locale.value, {
    timeZone: 'Europe/Brussels',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))

const stateDetail = computed(() => {
  const c = connection.value
  if (!c) return ''
  if (!c.enabled) return t('assistant.notConfiguredHint')
  if (c.state === 'TOKEN_REJECTED') return t('assistant.hints.tokenRejected')
  if (c.state === 'CONFLICT') return t('assistant.hints.conflict')
  if (c.state === 'UNAVAILABLE') return t('assistant.hints.unavailable')
  return ''
})

const linkKey = computed(() => {
  const s = link.value?.status ?? 'WAIT'
  return s === 'REFUSED_FULL' ? 'refusedFull' : s.toLowerCase()
})

const linkParams = computed(() => ({
  name: link.value?.account?.name ?? '',
  max: connection.value?.maxAccounts ?? 0,
}))

/*
 * The QR code is shown as a PNG, not inline SVG: on a phone, the owner can
 * long-press it to save it.
 */
const renderPng = async (content: string): Promise<string> => {
  const svg = renderSVG(content, { border: 2 })
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 600
  canvas.height = 600
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 600, 600)
  ctx.drawImage(img, 0, 0, 600, 600)
  return canvas.toDataURL('image/png')
}

watch(
  () => link.value?.url,
  async (url) => {
    qrPng.value = ''
    if (!url) return
    qrPng.value = await renderPng(url).catch(() => '')
  },
)

let timer: ReturnType<typeof setInterval> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined

const stopPolling = () => {
  if (timer) clearInterval(timer)
  timer = undefined
}

const closeLink = () => {
  stopPolling()
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = undefined
  link.value = null
  qrPng.value = ''
}

const poll = async () => {
  if (!link.value) return
  try {
    const data = await $gqlFetch<{ assistantLink: AssistantLink }>(LINK_STATUS, {
      variables: { id: link.value.id },
    })
    if (!data) return
    link.value = data.assistantLink
    if (isLinkFinished(data.assistantLink.status)) {
      stopPolling()
      await reload()
      if (data.assistantLink.status === 'LINKED') closeTimer = setTimeout(closeLink, 3000)
    }
  } catch (e) {
    stopPolling()
    closeLink()
    error.value = t(errorKey(gqlErrorCodes(e), 'assistant.errors.poll'))
  }
}

const startLink = async () => {
  error.value = ''
  starting.value = true
  try {
    const data = await $gqlFetch<{ startAssistantLink: AssistantLink }>(START_LINK)
    if (!data) return
    closeLink()
    link.value = data.startAssistantLink
    timer = setInterval(poll, 2000)
  } catch (e) {
    error.value = t(errorKey(gqlErrorCodes(e), 'assistant.errors.start'))
  } finally {
    starting.value = false
  }
}

const copyLink = async () => {
  if (!link.value) return
  try {
    await navigator.clipboard.writeText(link.value.url)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    error.value = t('assistant.errors.copy')
  }
}

const removeAccount = async (id: string) => {
  removingId.value = id
  error.value = ''
  try {
    const data = await $gqlFetch<{ removeAssistantAccount: AssistantConnection }>(REMOVE_ACCOUNT, {
      variables: { id },
    })
    if (data) connection.value = data.removeAssistantAccount
    confirmingRemoveId.value = ''
  } catch (e) {
    error.value = t(errorKey(gqlErrorCodes(e), 'assistant.errors.remove'))
  } finally {
    removingId.value = ''
  }
}

onBeforeUnmount(closeLink)
</script>
