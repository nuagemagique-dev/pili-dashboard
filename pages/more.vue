<template>
  <div class="flex flex-col">
    <div class="px-4 pt-5 pb-4 flex items-center gap-3.5">
      <img src="/pili-wordmark.svg" alt="Pili" class="h-[30px] w-auto shrink-0" />
      <span class="w-px h-7 bg-(--ui-border) shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex flex-col">
        <span class="text-[15px] font-bold truncate">{{ restaurantName }}</span>
        <span v-if="authStore.user?.email" class="font-mono text-xs text-muted truncate">{{
          authStore.user.email
        }}</span>
      </span>
    </div>

    <div class="px-4 pb-5 flex flex-col gap-4">
      <div
        class="rounded-[14px] bg-elevated border border-default overflow-hidden divide-y divide-default"
      >
        <NuxtLink
          v-for="item in items"
          :key="item.to"
          :to="localePath(item.to)"
          class="w-full min-h-[60px] px-4 flex items-center gap-3 active:bg-accented"
        >
          <span class="flex-1 min-w-0 text-base font-bold truncate">{{ item.label }}</span>
          <span class="font-mono tabular-nums text-[13px] text-muted">{{ item.hint }}</span>
          <UIcon name="i-lucide-chevron-right" class="size-5 text-muted shrink-0" />
        </NuxtLink>
      </div>

      <div class="flex flex-col gap-2">
        <span class="font-mono text-xs font-bold tracking-[0.06em] uppercase text-muted">{{
          t('more.language')
        }}</span>
        <PiliSegmented
          :model-value="locale as AppLocale"
          :options="languageOptions"
          :label="t('more.language')"
          @update:model-value="(value) => value && onLanguageChange(value)"
        />
      </div>

      <button
        type="button"
        class="min-h-14 px-4 rounded-[14px] bg-elevated border border-default flex items-center gap-2.5 text-base font-bold active:bg-accented"
        @click="authStore.logout()"
      >
        <span class="size-2 rounded-full bg-error shrink-0" aria-hidden="true" />
        {{ t('navigation.logout') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AppLocale } from '~/composables/useLocaleSwitch'
import { stateKey } from '~/utils/assistant'

const { t, locale } = useI18n()
const localePath = useLocalePath()
const authStore = useAuthStore()
const isMobile = useIsMobile()
const { $gqlFetch } = useNuxtApp()
const { languages, onLanguageChange } = useLocaleSwitch()
const { enabled: orderingEnabled } = useOrderingStatus()
const { connection: assistant } = useAssistantStatus()

const restaurantName = useRuntimeConfig().public.restaurantName as string

// Plus only exists on phones: tablet and desktop have everything in the sidebar.
watch(
  isMobile,
  (mobile) => {
    if (!mobile) navigateTo(localePath('/orders'), { replace: true })
  },
  { immediate: true },
)

const MORE_COUNTS = /* GraphQL */ `
  query MoreCounts {
    customerStats {
      summary {
        totalCustomers
      }
    }
    coupons {
      status
    }
  }
`

const customerCount = ref<number | null>(null)
const activeCoupons = ref<number | null>(null)

onMounted(async () => {
  const data = await $gqlFetch<{
    customerStats: { summary: { totalCustomers: number } }
    coupons: { status: string }[]
  }>(MORE_COUNTS)
  if (!data) return
  customerCount.value = data.customerStats.summary.totalCustomers
  activeCoupons.value = data.coupons.filter((c) => c.status === 'ACTIVE').length
})

const items = computed(() => [
  {
    to: '/customers',
    label: t('navigation.customers'),
    hint: customerCount.value === null ? '' : String(customerCount.value),
  },
  {
    to: '/coupons',
    label: t('navigation.coupons'),
    hint:
      activeCoupons.value === null
        ? ''
        : t('more.activeCoupons', { count: activeCoupons.value }, activeCoupons.value),
  },
  {
    to: '/settings',
    label: t('navigation.settings'),
    hint:
      orderingEnabled.value === null
        ? ''
        : orderingEnabled.value
          ? t('more.online')
          : t('more.paused'),
  },
  {
    to: '/assistant',
    label: t('navigation.assistant'),
    hint: assistant.value?.enabled ? t(stateKey(assistant.value)) : '',
  },
])

const languageOptions = computed(() =>
  languages.map((lang) => ({ value: lang.value as AppLocale, label: lang.short })),
)
</script>
