<template>
  <a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-(--ui-bg) focus:border focus:border-(--ui-border) focus:rounded-lg focus:text-sm focus:font-medium"
  >
    Skip to content
  </a>
  <UDashboardGroup storage="cookie" storage-key="tsb-dashboard">
    <!-- Sidebar (tablet+ : collapsible) -->
    <UDashboardSidebar
      collapsible
      collapsed
      class="hidden md:flex bg-elevated border-r border-default"
      :ui="{
        footer: 'border-t border-default flex flex-col gap-4',
        body: 'flex flex-col gap-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        header: 'flex justify-center border-b border-default',
      }"
    >
      <template #header="{ collapsed }">
        <div class="flex items-center justify-center py-6 w-full">
          <img
            :src="collapsed ? '/pili-mark.svg' : '/pili-wordmark.svg'"
            alt="Pili"
            class="w-auto object-contain"
            :class="collapsed ? 'h-8' : 'h-7'"
          />
        </div>
      </template>

      <template #default="{ collapsed: isCollapsed }">
        <UNavigationMenu
          :collapsed="isCollapsed && !isMobile"
          :items="navigationItems"
          orientation="vertical"
          size="lg"
          class="flex-1"
          :ui="{
            link:
              isCollapsed && !isMobile
                ? 'py-3 px-0 text-base justify-center'
                : 'py-3 px-4 text-base w-full',
          }"
        />
      </template>

      <template #footer="{ collapsed: isCollapsed }">
        <!-- Language Switcher -->
        <UDropdownMenu :items="languageItems">
          <UButton
            :label="isCollapsed && !isMobile ? undefined : currentLocaleLabel"
            :icon="currentLocaleIcon"
            color="neutral"
            variant="ghost"
            size="lg"
            block
            :square="isCollapsed && !isMobile"
          />
        </UDropdownMenu>

        <!-- Logout Button -->
        <div class="h-px bg-(--ui-border)" />
        <UButton
          :label="isCollapsed && !isMobile ? undefined : t('navigation.logout')"
          icon="i-lucide-log-out"
          color="neutral"
          variant="ghost"
          size="lg"
          block
          :square="isCollapsed && !isMobile"
          :ui="{ leadingIcon: 'text-error' }"
          @click="handleLogout"
        />

        <!-- Collapse Toggle -->
        <UDashboardSidebarCollapse />
      </template>
    </UDashboardSidebar>

    <UDashboardPanel
      :ui="{
        root: 'max-md:pt-[env(safe-area-inset-top)]',
        body: 'bg-default p-0 sm:p-0 md:p-6 gap-0 sm:gap-0 md:gap-6',
      }"
    >
      <template #body>
        <!-- Below md the pages own their padding; the tab bar height is reserved here. -->
        <div
          id="main-content"
          class="flex-1 flex flex-col pb-(--pili-tabbar-h)"
          :style="{
            '--pili-tabbar-h': tabBarVisible ? 'calc(72px + env(safe-area-inset-bottom))' : '0px',
            '--pili-safe-bottom': tabBarVisible ? '0px' : 'env(safe-area-inset-bottom)',
          }"
        >
          <AssistantBanner />
          <HubriseBanner />
          <slot />
        </div>
      </template>
    </UDashboardPanel>

    <MobileTabBar v-if="tabBarVisible" />
  </UDashboardGroup>
</template>

<script setup lang="ts">
import type { NavigationMenuItem } from '#ui/types'
import { hubriseNavVisible } from '~/utils/hubrise'

const { locale, t } = useI18n()
const route = useRoute()
const ordersStore = useOrdersStore()
const { status: hubriseStatus } = useHubriseStatus()

const isMobile = useIsMobile()
const { visible: tabBarVisible } = useTabBar()
const { languages, onLanguageChange } = useLocaleSwitch()

const currentLocaleLabel = computed(
  () => languages.find((l) => l.value === locale.value)?.label || '🌐',
)

const currentLocaleIcon = computed(() => 'i-lucide-languages')

const languageItems = computed(() =>
  languages.map((lang) => ({
    label: lang.label,
    onClick: () => onLanguageChange(lang.value),
  })),
)

// Pili: the active item is a Brume fill with Encre text and icon, never Volt.
const navItemUi = (active: boolean) =>
  active
    ? {
        link: 'text-inverted hover:text-inverted before:bg-inverted hover:before:bg-inverted',
        linkLeadingIcon: 'text-inverted group-hover:text-inverted',
      }
    : {
        link: 'text-muted hover:before:bg-accented',
        linkLeadingIcon: 'text-muted',
      }

const navigationItems = computed<NavigationMenuItem[][]>(() => {
  const item = (label: string, icon: string, path: string): NavigationMenuItem => {
    const active = route.path.includes(`/${path}`)
    return { label, icon, to: `/${locale.value}/${path}`, active, ui: navItemUi(active) }
  }
  return [
    [
      item(t('navigation.products'), 'i-lucide-package', 'products'),
      {
        ...item(t('navigation.orders'), 'i-lucide-shopping-bag', 'orders'),
        // Unacknowledged orders are waiting, not an error: amber, in mono.
        badge:
          ordersStore.unacknowledgedPendingCount > 0
            ? {
                label: String(ordersStore.unacknowledgedPendingCount),
                color: 'warning' as const,
                variant: 'solid' as const,
                class: 'font-mono tabular-nums font-bold',
              }
            : undefined,
      },
      item(t('navigation.orderHistory'), 'i-lucide-history', 'order-history'),
      item(t('navigation.customers'), 'i-lucide-users', 'customers'),
      item(t('navigation.coupons'), 'i-lucide-ticket', 'coupons'),
      item(t('navigation.settings'), 'i-lucide-settings', 'settings'),
      item(t('navigation.assistant'), 'i-lucide-message-circle', 'assistant'),
      ...(hubriseNavVisible(hubriseStatus.value)
        ? [item(t('navigation.hubrise'), 'i-lucide-plug-zap', 'hubrise')]
        : []),
    ],
  ]
})

const handleLogout = async () => {
  const authStore = useAuthStore()
  await authStore.logout()
}
</script>

<style>
html {
  font-size: 16px;
}
</style>
