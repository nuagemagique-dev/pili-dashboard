<template>
  <div class="flex-1 flex flex-col">
    <PiliSubHeader v-if="isMobile" :title="t('hubrise.title')" />

    <div
      class="flex flex-col gap-3 w-full"
      :class="isMobile ? 'px-4 pt-1 pb-5' : 'p-3 sm:p-4 md:p-6 max-w-3xl mx-auto'"
    >
      <h1 v-if="!isMobile" class="text-lg sm:text-2xl font-bold">{{ t('hubrise.title') }}</h1>
      <p class="text-[13px] sm:text-sm text-muted leading-snug">{{ t('hubrise.description') }}</p>

      <p v-if="!status && loadError" role="alert" class="text-sm text-error font-bold">
        {{ t('hubrise.loadFailed') }}
      </p>
      <p v-else-if="!status" class="text-sm text-muted">{{ t('hubrise.loading') }}</p>
      <p
        v-else-if="!status.available"
        class="p-4 rounded-[14px] bg-elevated border border-default text-sm leading-snug"
        data-testid="hubrise-unavailable"
      >
        {{ t('hubrise.notAvailable') }}
      </p>

      <template v-else>
        <HubriseBanners
          :banners="generalBanners"
          :busy-action="busyAction"
          @action="onBannerAction"
        />

        <!-- Connection -->
        <SettingsSection
          v-model:open="openSections.connection"
          :title="t('hubrise.connection.title')"
          :summary="connectionSummary"
          :dirty="false"
        >
          <div class="flex flex-col gap-3 pt-2">
            <template v-if="status.connected">
              <dl
                class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm"
                data-testid="hubrise-ids"
              >
                <template v-for="row in connectionRows" :key="row.label">
                  <dt class="text-muted">{{ t(`hubrise.connection.${row.label}`) }}</dt>
                  <dd class="min-w-0">
                    <span class="font-bold">{{ row.name ?? '-' }}</span>
                    <span v-if="row.id" class="block font-mono text-xs text-muted truncate">{{
                      row.id
                    }}</span>
                  </dd>
                </template>
                <dt class="text-muted">{{ t('hubrise.connection.lastEvent') }}</dt>
                <dd>{{ status.lastEventAt ? formatInstant(status.lastEventAt, locale) : '-' }}</dd>
                <dt class="text-muted">{{ t('hubrise.connection.lastCatalogSync') }}</dt>
                <dd>
                  {{
                    status.lastCatalogSyncAt ? formatInstant(status.lastCatalogSyncAt, locale) : '-'
                  }}
                </dd>
              </dl>
              <p v-if="status.lastError" class="text-xs text-muted break-words">
                {{ status.lastError }}
              </p>

              <div class="flex flex-wrap gap-2">
                <UButton
                  :label="t('hubrise.actions.reconnect')"
                  icon="i-lucide-refresh-cw"
                  color="neutral"
                  variant="outline"
                  :loading="settings.busy.value === 'connect'"
                  @click="connect"
                />
                <UButton
                  v-if="!confirmingDisconnect"
                  :label="t('hubrise.connection.disconnect')"
                  icon="i-lucide-unplug"
                  color="neutral"
                  variant="outline"
                  @click="confirmingDisconnect = true"
                />
              </div>

              <div
                v-if="confirmingDisconnect"
                class="p-3 rounded-[10px] bg-accented flex flex-col gap-3"
                data-testid="hubrise-disconnect"
              >
                <p class="text-sm leading-snug">{{ t('hubrise.connection.disconnectHint') }}</p>
                <UCheckbox
                  v-model="forgetOnDisconnect"
                  :label="t('hubrise.connection.forgetLinks')"
                />
                <div class="flex gap-2">
                  <UButton
                    :label="t('hubrise.connection.disconnectConfirm')"
                    color="error"
                    :loading="settings.busy.value === 'disconnect'"
                    @click="disconnect"
                  />
                  <UButton
                    :label="t('common.cancel')"
                    color="neutral"
                    variant="ghost"
                    @click="confirmingDisconnect = false"
                  />
                </div>
              </div>
            </template>
            <template v-else>
              <p class="text-sm leading-snug text-muted">
                {{ t('hubrise.connection.notConnected') }}
              </p>
              <UButton
                :label="t('hubrise.connection.connect')"
                icon="i-lucide-plug-zap"
                class="self-start"
                :loading="settings.busy.value === 'connect'"
                @click="connect"
              />
            </template>
          </div>
        </SettingsSection>

        <template v-if="status.connected">
          <!-- Enabled and the features -->
          <SettingsSection
            v-model:open="openSections.features"
            :title="t('hubrise.features.title')"
            :description="t('hubrise.features.description')"
            :dirty="false"
          >
            <div class="flex flex-col divide-y divide-default">
              <div class="flex items-center justify-between gap-4 py-3">
                <span class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-sm font-bold">{{ t('hubrise.features.enabled') }}</span>
                  <span class="text-xs text-muted leading-snug">{{
                    status.relinkRequired
                      ? t('hubrise.features.enabledRelink')
                      : t('hubrise.features.enabledHint')
                  }}</span>
                </span>
                <USwitch
                  :model-value="status.enabled"
                  color="success"
                  :disabled="settings.busy.value === 'settings'"
                  :aria-label="t('hubrise.features.enabled')"
                  @update:model-value="(value) => update({ enabled: value })"
                />
              </div>
              <div
                v-for="row in toggles"
                :key="row.id"
                class="flex items-center justify-between gap-4 py-3"
                :data-toggle="row.id"
              >
                <span class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-sm font-bold">{{ t(`hubrise.toggles.${row.id}`) }}</span>
                  <span class="text-xs text-muted leading-snug">{{
                    t(row.hintKey, row.hintParams)
                  }}</span>
                </span>
                <USwitch
                  :model-value="row.value"
                  color="success"
                  :disabled="row.disabled || settings.busy.value === 'settings'"
                  :aria-label="t(`hubrise.toggles.${row.id}`)"
                  @update:model-value="(value) => update({ [row.id]: value })"
                />
              </div>
            </div>
            <p v-if="!status.enabled" class="text-xs text-muted pt-2">
              {{ t('hubrise.features.pausedHint') }}
            </p>
            <div class="flex flex-wrap gap-2 pt-3">
              <UButton
                v-if="status.features.syncInventory"
                :label="t('hubrise.features.syncInventoryNow')"
                icon="i-lucide-boxes"
                color="neutral"
                variant="outline"
                :loading="settings.busy.value === 'syncInventory'"
                @click="syncInventory"
              />
              <UButton
                v-if="status.unlinkedProducts > 0"
                :label="t('hubrise.features.unlinked', { count: status.unlinkedProducts })"
                icon="i-lucide-link-2-off"
                color="neutral"
                variant="outline"
                :to="localePath('/products')"
              />
            </div>
          </SettingsSection>

          <!-- Who owns the menu -->
          <SettingsSection
            v-model:open="openSections.catalog"
            :title="t('hubrise.catalog.title')"
            :summary="t(`hubrise.direction.options.${status.catalogDirection}.title`)"
            :dirty="false"
          >
            <div class="flex flex-col gap-5 pt-2">
              <CatalogDirection :status="status" @reconnect="connect" />
              <PublishPanel
                v-if="status.catalogDirection === 'PUBLISH'"
                :status="status"
                @reconnect="connect"
              />
              <PlatformPrices
                v-if="status.catalogDirection === 'PUBLISH'"
                :stored="status.platformPrices"
                :busy="settings.busy.value === 'settings'"
                @save="(platformPrices) => update({ platformPrices })"
              />
              <div ref="importAnchor">
                <ImportPanel :status="status" />
              </div>
            </div>
          </SettingsSection>

          <!-- Options -->
          <SettingsSection
            v-model:open="openSections.options"
            :title="t('hubrise.options.title')"
            :description="t('hubrise.options.description')"
            :dirty="optionsDirty"
          >
            <div class="flex flex-col gap-3 pt-2">
              <UFormField :label="t('hubrise.options.catalogLanguage')">
                <USelect v-model="form.catalogLanguage" :items="languageItems" class="w-full" />
              </UFormField>
              <UFormField
                :label="t('hubrise.options.variantRef')"
                :hint="t('hubrise.options.optional')"
              >
                <UInput v-model="form.variantRef" class="w-full" />
              </UFormField>
              <UFormField
                :label="t('hubrise.options.channelName')"
                :hint="t('hubrise.options.optional')"
              >
                <UInput v-model="form.channelName" class="w-full" />
              </UFormField>
              <UFormField
                :label="t('hubrise.options.deliveryChargeRef')"
                :hint="t('hubrise.options.optional')"
              >
                <UInput v-model="form.deliveryChargeRef" class="w-full" />
              </UFormField>
              <UFormField
                :label="t('hubrise.options.paymentFeeChargeRef')"
                :hint="t('hubrise.options.optional')"
              >
                <UInput v-model="form.paymentFeeChargeRef" class="w-full" />
              </UFormField>
              <UButton
                v-if="optionsDirty"
                :label="t('common.save')"
                icon="i-lucide-save"
                :loading="settings.busy.value === 'settings'"
                block
                @click="saveOptions"
              />
            </div>
          </SettingsSection>

          <!-- Outbox -->
          <SettingsSection
            v-model:open="openSections.outbox"
            :title="t('hubrise.outbox.title')"
            :summary="
              t('hubrise.outbox.summary', {
                pending: status.backlog.pending,
                parked: status.backlog.parked,
              })
            "
            :dirty="false"
          >
            <div class="flex flex-col gap-3 pt-2">
              <div class="flex flex-wrap gap-2 items-center">
                <button
                  v-for="state in OUTBOX_FILTERS"
                  :key="state"
                  type="button"
                  :aria-pressed="outboxState === state"
                  class="px-3 min-h-11 rounded-xl border text-sm font-bold"
                  :class="
                    outboxState === state
                      ? 'bg-accented border-default'
                      : 'border-default text-muted'
                  "
                  @click="showOutbox(state)"
                >
                  {{ t(`hubrise.outbox.states.${state}`) }}
                </button>
                <UButton
                  v-if="status.backlog.parked > 0"
                  :label="t('hubrise.outbox.retryAll')"
                  icon="i-lucide-rotate-ccw"
                  class="ml-auto"
                  :loading="settings.busy.value === 'retry'"
                  @click="retry(null)"
                />
              </div>
              <p v-if="settings.outbox.value.length === 0" class="text-sm text-muted">
                {{ t('hubrise.outbox.empty') }}
              </p>
              <ul
                v-else
                class="divide-y divide-default rounded-[10px] border border-default"
                data-testid="hubrise-outbox"
              >
                <li
                  v-for="row in settings.outbox.value"
                  :key="row.id"
                  class="px-3 py-2.5 flex items-start gap-3"
                >
                  <span class="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span class="flex items-center gap-2 flex-wrap">
                      <span class="text-sm font-bold">{{
                        t(`hubrise.outbox.kinds.${row.kind}`)
                      }}</span>
                      <PiliChip :tone="row.state === 'PARKED' ? 'danger' : 'neutral'" size="sm">{{
                        t(`hubrise.outbox.states.${row.state}`)
                      }}</PiliChip>
                    </span>
                    <span class="text-xs text-muted">{{
                      t('hubrise.outbox.attempts', {
                        count: row.attempts,
                        time: formatInstant(row.createdAt, locale),
                      })
                    }}</span>
                    <span v-if="row.lastError" class="text-xs text-error break-words">{{
                      row.lastError
                    }}</span>
                    <NuxtLink
                      v-if="row.orderId"
                      :to="localePath(`/orders/${row.orderId}`)"
                      class="text-xs underline"
                      >{{ t('hubrise.outbox.openOrder') }}</NuxtLink
                    >
                  </span>
                  <UButton
                    v-if="row.state === 'PARKED'"
                    :label="t('hubrise.outbox.retry')"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    :loading="settings.busy.value === 'retry'"
                    @click="retry(row.id)"
                  />
                </li>
              </ul>
            </div>
          </SettingsSection>

          <!-- Orders that need staff -->
          <NuxtLink
            v-if="status.attention > 0"
            :to="localePath('/orders')"
            class="p-4 rounded-[14px] bg-elevated border border-error flex items-center gap-3"
            data-testid="hubrise-attention"
          >
            <UIcon name="i-lucide-triangle-alert" class="size-5 text-error shrink-0" />
            <span class="flex-1 min-w-0 text-sm font-bold">{{
              t('hubrise.attention', { count: status.attention }, status.attention)
            }}</span>
            <UIcon name="i-lucide-chevron-right" class="size-5 text-muted shrink-0" />
          </NuxtLink>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import CatalogDirection from '~/components/hubrise/CatalogDirection.vue'
import HubriseBanners from '~/components/hubrise/HubriseBanners.vue'
import ImportPanel from '~/components/hubrise/ImportPanel.vue'
import PlatformPrices from '~/components/hubrise/PlatformPrices.vue'
import PublishPanel from '~/components/hubrise/PublishPanel.vue'
import SettingsSection from '~/components/SettingsSection.vue'
import {
  CATALOG_LANGUAGES,
  type HubriseBanner,
  type HubriseBannerAction,
  type HubriseOutboxState,
  type HubriseSettingsForm,
  type HubriseSettingsInput,
  formatInstant,
  hubriseError,
  hubriseNavHintKey,
  oauthToast,
  settingsFormFrom,
  settingsPatch,
  splitBanners,
  statusBanners,
  toggleRows,
} from '~/utils/hubrise'

const { t, locale } = useI18n()
const isMobile = useIsMobile()
const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()
const toast = useToast()
const { status, loadError } = useHubriseStatus()
const settings = useHubriseSettings()

const openSections = reactive({
  connection: true,
  features: false,
  catalog: false,
  options: false,
  outbox: false,
})

const importAnchor = ref<HTMLElement | null>(null)
const confirmingDisconnect = ref(false)
const forgetOnDisconnect = ref(false)
const busyAction = ref<HubriseBannerAction | null>(null)

const generalBanners = computed(() => splitBanners(statusBanners(status.value)).general)
const toggles = computed(() => (status.value ? toggleRows(status.value) : []))

const connectionSummary = computed(() => {
  const key = hubriseNavHintKey(status.value)
  return key === null ? '' : t(key)
})

const connectionRows = computed(() => {
  const s = status.value
  if (!s) return []
  return [
    { label: 'account', name: s.accountName, id: s.accountId },
    { label: 'location', name: s.locationName, id: s.locationId },
    { label: 'catalog', name: s.catalogName, id: s.catalogId },
    { label: 'customerList', name: s.customerListName, id: s.customerListId },
  ]
})

const languageItems = CATALOG_LANGUAGES.map((value): { value: string; label: string } => ({
  value,
  label: t(`hubrise.options.languages.${value}`),
}))

// The options form follows the stored status until the admin edits it.
const form = reactive<HubriseSettingsForm>({
  catalogLanguage: 'fr',
  variantRef: '',
  channelName: '',
  deliveryChargeRef: '',
  paymentFeeChargeRef: '',
})
watch(
  () => status.value,
  (next, previous) => {
    if (!next) return
    const stored = settingsFormFrom(next)
    const before = previous ? settingsFormFrom(previous) : null
    for (const key of Object.keys(stored) as (keyof typeof stored)[]) {
      // Only a field the admin did not touch follows the server.
      if (before === null || form[key] === before[key]) form[key] = stored[key]
    }
  },
  { immediate: true },
)
const optionsDirty = computed(
  () => status.value !== null && Object.keys(settingsPatch(status.value, form)).length > 0,
)

const notify = (failure: unknown) => {
  const info = hubriseError(failure)
  toast.add({ title: t(info.key, info.params), color: 'error' })
}

const update = async (input: HubriseSettingsInput) => {
  try {
    await settings.updateSettings(input)
  } catch (failure: unknown) {
    notify(failure)
  }
}

const saveOptions = async () => {
  if (status.value === null) return
  await update(settingsPatch(status.value, form))
}

const connect = async () => {
  try {
    await settings.connect()
  } catch (failure: unknown) {
    notify(failure)
  }
}

const disconnect = async () => {
  try {
    await settings.disconnect(forgetOnDisconnect.value)
    confirmingDisconnect.value = false
    forgetOnDisconnect.value = false
    toast.add({ title: t('hubrise.connection.disconnected'), color: 'success' })
  } catch (failure: unknown) {
    notify(failure)
  }
}

const syncInventory = async () => {
  try {
    const count = await settings.syncInventory()
    toast.add({ title: t('hubrise.features.inventorySynced', { count }), color: 'success' })
  } catch (failure: unknown) {
    notify(failure)
  }
}

const onBannerAction = async (banner: HubriseBanner) => {
  busyAction.value = banner.action
  try {
    if (banner.action === 'reconnect') await connect()
    else if (banner.action === 'forgetLinks') await forgetLinks()
    else if (banner.action === 'reviewImport' || banner.action === 'import') await showImport()
  } finally {
    busyAction.value = null
  }
}

const forgetLinks = async () => {
  try {
    const count = await settings.forgetLinks()
    toast.add({ title: t('hubrise.connection.linksForgotten', { count }), color: 'success' })
  } catch (failure: unknown) {
    notify(failure)
  }
}

const showImport = async () => {
  openSections.catalog = true
  await nextTick()
  importAnchor.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Outbox
const OUTBOX_FILTERS: HubriseOutboxState[] = ['PARKED', 'PENDING']
const outboxState = ref<HubriseOutboxState>('PARKED')

const showOutbox = async (state: HubriseOutboxState) => {
  outboxState.value = state
  try {
    await settings.loadOutbox(state)
  } catch (failure: unknown) {
    notify(failure)
  }
}

const retry = async (id: string | null) => {
  try {
    const count = await settings.retryOutbox(id)
    toast.add({ title: t('hubrise.outbox.retried', { count }), color: 'success' })
    await settings.loadOutbox(outboxState.value)
  } catch (failure: unknown) {
    notify(failure)
  }
}

watch(
  () => openSections.outbox,
  (open) => {
    if (open && status.value?.connected === true) void showOutbox(outboxState.value)
  },
)

// Back from HubRise: one toast per outcome, then the address is cleaned.
onMounted(async () => {
  const outcome = oauthToast(route.query.hubrise)
  if (outcome === null) return
  toast.add({ title: t(outcome.key), color: outcome.color })
  const rest = Object.fromEntries(
    Object.entries(route.query).filter(([name]) => name !== 'hubrise'),
  )
  await router.replace({ query: rest })
})
</script>
