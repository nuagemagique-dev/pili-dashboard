<template>
  <div v-if="banners.length > 0" class="flex flex-col gap-2">
    <div
      v-for="banner in banners"
      :key="banner.id"
      :role="banner.tone === 'error' ? 'alert' : 'status'"
      :data-banner="banner.id"
      class="px-4 py-3 rounded-[14px] flex items-start gap-3 text-inverted"
      :class="TONE_CLASS[banner.tone]"
    >
      <UIcon :name="TONE_ICON[banner.tone]" class="size-5 shrink-0 mt-0.5" />
      <span class="flex-1 min-w-0 text-sm font-bold leading-snug">{{
        t(banner.key, bannerParams(banner, locale))
      }}</span>
      <UButton
        v-if="banner.action"
        :label="t(`hubrise.actions.${banner.action}`)"
        color="neutral"
        variant="solid"
        size="sm"
        class="shrink-0"
        :loading="busyAction === banner.action"
        @click="emit('action', banner)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { type HubriseBanner, type HubriseBannerAction, bannerParams } from '~/utils/hubrise'

const { banners, busyAction = null } = defineProps<{
  banners: HubriseBanner[]
  /** The action running now: its button shows a spinner. */
  busyAction?: HubriseBannerAction | null
}>()

const emit = defineEmits<{ action: [banner: HubriseBanner] }>()

const { t, locale } = useI18n()

const TONE_CLASS: Record<HubriseBanner['tone'], string> = {
  error: 'bg-error',
  warning: 'bg-warning',
  info: 'bg-info',
}
const TONE_ICON: Record<HubriseBanner['tone'], string> = {
  error: 'i-lucide-circle-alert',
  warning: 'i-lucide-triangle-alert',
  info: 'i-lucide-info',
}
</script>
