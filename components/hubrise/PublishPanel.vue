<template>
  <div class="flex flex-col gap-3" data-testid="hubrise-publish">
    <p class="text-[13px] sm:text-sm text-muted leading-snug">{{ t('hubrise.publish.intro') }}</p>

    <HubriseBanners :banners="banners" @action="onBannerAction" />

    <div class="p-3.5 rounded-[14px] bg-elevated border border-default flex flex-col gap-2.5">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-base font-bold">{{ t('hubrise.publish.statusTitle') }}</span>
        <PiliChip :tone="phaseTone" size="sm">{{
          t(`hubrise.publish.phase.${phase.phase}`)
        }}</PiliChip>
      </div>
      <p v-if="phase.phase === 'pending'" class="text-sm" data-testid="hubrise-publish-next">
        {{
          phase.seconds === null
            ? t('hubrise.publish.nextUnknown')
            : t('hubrise.publish.nextIn', { time: formatCountdown(phase.seconds) })
        }}
      </p>
      <p v-else-if="phase.phase === 'awaitingFirst'" class="text-sm leading-snug">
        {{ t('hubrise.publish.awaitingFirst') }}
      </p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt class="text-muted">{{ t('hubrise.publish.lastPublished') }}</dt>
        <dd data-testid="hubrise-publish-last">
          {{
            publish.lastPublishedAt
              ? formatInstant(publish.lastPublishedAt, locale)
              : t('hubrise.publish.never')
          }}
        </dd>
        <dt class="text-muted">{{ t('hubrise.publish.products') }}</dt>
        <dd>
          {{
            t('hubrise.publish.productsCount', {
              published: publish.publishedProducts,
              pending: publish.pendingProducts,
            })
          }}
        </dd>
      </dl>
      <div class="flex flex-wrap gap-2 pt-1">
        <UButton
          :label="t('hubrise.publish.previewButton')"
          icon="i-lucide-cloud-upload"
          :disabled="!canPreview"
          @click="dialogOpen = true"
        />
      </div>
      <p v-if="!status.enabled" class="text-xs text-muted">{{ t('hubrise.import.enableFirst') }}</p>
    </div>

    <p v-if="shownError" role="alert" class="text-sm text-error font-bold">
      {{ t(shownError.key, shownError.params) }}
    </p>

    <div class="flex items-center justify-between gap-4 py-1">
      <span class="flex flex-col gap-0.5 min-w-0">
        <span class="text-sm font-bold">{{ t('hubrise.toggles.publishImages') }}</span>
        <span class="text-xs text-muted leading-snug">{{ t('hubrise.hints.publishImages') }}</span>
      </span>
      <USwitch
        :model-value="publish.publishImages"
        color="success"
        :loading="settings.busy.value === 'settings'"
        :disabled="!status.enabled"
        :aria-label="t('hubrise.toggles.publishImages')"
        @update:model-value="setImages"
      />
    </div>

    <PublishPreviewDialog v-model:open="dialogOpen" @published="onPublished" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HubriseBanners from '~/components/hubrise/HubriseBanners.vue'
import PublishPreviewDialog from '~/components/hubrise/PublishPreviewDialog.vue'
import type { PiliChipTone } from '~/components/pili/PiliChip.vue'
import {
  type HubriseBanner,
  type HubriseErrorInfo,
  type HubriseStatus,
  formatCountdown,
  formatInstant,
  hubriseError,
  publishPhase,
  splitBanners,
  statusBanners,
} from '~/utils/hubrise'

const { status } = defineProps<{ status: HubriseStatus }>()

const emit = defineEmits<{ reconnect: [] }>()

const { t, locale } = useI18n()
const toast = useToast()
const settings = useHubriseSettings()
const external = useHubrisePublish()

const dialogOpen = ref(false)
const actionError = ref<HubriseErrorInfo | null>(null)

// The countdown to the debounced publish ticks every second while the panel is on screen.
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  ticker = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => {
  if (ticker !== null) clearInterval(ticker)
})

const publish = computed(() => status.publish)
const shownError = computed(() => actionError.value ?? external.error.value)
const phase = computed(() => publishPhase(status.publish, now.value))
const banners = computed(() => splitBanners(statusBanners(status)).publish)
const canPreview = computed(
  () => status.enabled && status.connected && !status.publish.needsReconnectForWrite,
)

const PHASE_TONES: Record<string, PiliChipTone> = {
  awaitingFirst: 'warning',
  paused: 'neutral',
  publishing: 'info',
  pending: 'warning',
  upToDate: 'success',
}
const phaseTone = computed(() => PHASE_TONES[phase.value.phase] ?? 'neutral')

const onBannerAction = async (banner: HubriseBanner) => {
  if (banner.action === 'reconnect') emit('reconnect')
  else if (banner.action === 'preview') dialogOpen.value = true
  else if (banner.action === 'acknowledge') await external.acknowledgeExternalChange()
}

const setImages = async (value: boolean) => {
  actionError.value = null
  try {
    await settings.updateSettings({ publishImages: value })
  } catch (failure: unknown) {
    actionError.value = hubriseError(failure)
  }
}

const onPublished = (queued: boolean) => {
  toast.add({
    title: queued ? t('hubrise.publish.queued') : t('hubrise.publish.published'),
    color: 'success',
  })
}
</script>
