<template>
  <div class="flex-1 flex flex-col">
    <PiliSubHeader v-if="isMobile" :title="t('terminals.title')" />

    <div
      class="flex flex-col gap-3 w-full"
      :class="isMobile ? 'px-4 pt-1 pb-5' : 'p-3 sm:p-4 md:p-6 max-w-3xl mx-auto'"
    >
      <div class="flex items-start gap-3 flex-wrap">
        <div class="flex-1 min-w-0 flex flex-col gap-1">
          <h1 v-if="!isMobile" class="text-lg sm:text-2xl font-bold">
            {{ t('terminals.title') }}
          </h1>
          <p class="text-[13px] sm:text-sm text-muted leading-snug">
            {{ t('terminals.description') }}
          </p>
        </div>
        <UButton
          icon="i-lucide-plus"
          size="lg"
          :label="t('terminals.add.button')"
          data-testid="add-terminal"
          @click="showAdd = true"
        />
      </div>

      <p v-if="revokeError" class="text-sm text-error" role="alert">{{ t(revokeError) }}</p>

      <div class="rounded-[14px] bg-elevated border border-default">
        <div v-if="loading" class="p-4 flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          {{ t('terminals.loading') }}
        </div>
        <div v-else-if="loadError" class="p-4 flex items-center gap-3 flex-wrap">
          <p class="flex-1 text-sm text-error">{{ t('terminals.loadFailed') }}</p>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :label="t('terminals.retry')"
            @click="refresh"
          />
        </div>
        <p v-else-if="!devices.length" class="p-4 text-sm text-muted leading-snug">
          {{ t('terminals.empty') }}
        </p>
        <ul v-else class="flex flex-col divide-y divide-default">
          <li
            v-for="device in devices"
            :key="device.id"
            class="p-4 flex items-center gap-3 flex-wrap"
            :class="{ 'opacity-60': !isActiveDevice(device) }"
            data-testid="terminal-row"
          >
            <div class="flex-1 min-w-0 flex flex-col gap-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-base font-bold truncate">{{ device.label }}</span>
                <PiliChip v-if="isActiveDevice(device)" tone="success" size="sm">{{
                  t('terminals.status.active')
                }}</PiliChip>
                <PiliChip v-else tone="neutral" size="sm">{{
                  t('terminals.status.revoked', {
                    date: formatDate(device.revokedAt ?? '', locale),
                  })
                }}</PiliChip>
              </div>
              <span class="font-mono text-xs text-muted break-all">{{ device.serialNumber }}</span>
              <span class="text-xs text-muted">
                {{ t('terminals.registered', { date: formatDate(device.registeredAt, locale) }) }}
                ·
                {{
                  device.lastSeenAt
                    ? t('terminals.lastSeen', {
                        time: formatRelativeTime(device.lastSeenAt, now, locale),
                      })
                    : t('terminals.neverSeen')
                }}
              </span>
            </div>
            <UButton
              v-if="isActiveDevice(device)"
              color="neutral"
              variant="outline"
              icon="i-lucide-ban"
              :label="t('terminals.revoke.button')"
              :loading="revokingId === device.id"
              @click="revokeTarget = device"
            />
          </li>
        </ul>
      </div>
    </div>

    <!-- Enroll a handheld: bottom sheet on phones, modal from md -->
    <PiliBottomSheet v-if="isMobile" v-model:open="showAdd" :title="t('terminals.add.title')" full>
      <TerminalsEnrollmentPanel
        :enrollment="enrollment"
        :api-base-url="apiBaseUrl"
        :creating="creating"
        :error="createError"
        @create="createEnrollment"
        @close="showAdd = false"
      />
    </PiliBottomSheet>
    <UModal
      v-else
      v-model:open="showAdd"
      :title="t('terminals.add.title')"
      :ui="{ content: 'max-w-xl' }"
    >
      <template #body>
        <TerminalsEnrollmentPanel
          :enrollment="enrollment"
          :api-base-url="apiBaseUrl"
          :creating="creating"
          :error="createError"
          @create="createEnrollment"
          @close="showAdd = false"
        />
      </template>
    </UModal>

    <!-- Revoke confirmation -->
    <UModal
      :open="revokeTarget !== null"
      :title="t('terminals.revoke.title', { label: revokeTarget?.label ?? '' })"
      :description="t('terminals.revoke.message')"
      :dismissible="!revokingId"
      :ui="{ footer: 'flex justify-end gap-2' }"
      @update:open="(open) => !open && (revokeTarget = null)"
    >
      <template #footer>
        <UButton
          color="neutral"
          variant="solid"
          :disabled="Boolean(revokingId)"
          :label="t('common.cancel')"
          @click="revokeTarget = null"
        />
        <UButton
          color="error"
          :loading="Boolean(revokingId)"
          :label="t('terminals.revoke.confirm')"
          data-testid="confirm-revoke"
          @click="confirmRevoke"
        />
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate } from '~/utils/utils'
import {
  formatRelativeTime,
  isActiveDevice,
  normalizeApiBaseUrl,
  type PosDevice,
} from '~/utils/posTerminals'

const { t, locale } = useI18n()
const localePath = useLocalePath()
const authStore = useAuthStore()
const isMobile = useIsMobile()

// Handhelds are an admin matter: anyone else goes back to the orders.
if (!authStore.user?.isAdmin) {
  await navigateTo(localePath('/orders'), { replace: true })
}

/*
 * The handheld calls the same public API as this dashboard. The dashboard is a static SPA
 * (no SSR), so `api` is the public base URL baked in at build time, never an internal one.
 */
const apiBaseUrl = normalizeApiBaseUrl(String(useRuntimeConfig().public.api ?? ''))

const {
  devices,
  loading,
  loadError,
  now,
  refresh,
  enrollment,
  creating,
  createError,
  createEnrollment,
  closeEnrollment,
  revokingId,
  revokeError,
  revoke,
} = usePosTerminals()

const showAdd = ref(false)
const revokeTarget = ref<PosDevice | null>(null)

// The dialog closed: forget the code and reload, so a handheld enrolled meanwhile shows up.
watch(showAdd, (open) => {
  if (!open) void closeEnrollment()
})

const confirmRevoke = async () => {
  if (!revokeTarget.value) return
  await revoke(revokeTarget.value.id)
  revokeTarget.value = null
}
</script>
