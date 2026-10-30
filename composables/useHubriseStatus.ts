import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useNuxtApp, useState } from '#imports'
import type { HubriseStatus } from '~/utils/hubrise'

/** The publish block of a HubriseStatus (also selected by the publish mutations). */
export const HUBRISE_PUBLISH_FIELDS = `
  enabled
  active
  pending
  pendingSince
  nextPublishAt
  publishing
  lastPublishedAt
  firstPublishConfirmedAt
  awaitingFirstPublish
  lastError
  lastErrorCode
  lastErrorAt
  externalChangeAt
  needsReconnectForWrite
  accountCatalogDetected
  publishImages
  publishedProducts
  pendingProducts
`

/** Everything the HubRise page, the banner and the navigation read; every mutation that answers a status selects it. */
export const HUBRISE_STATUS_FIELDS = `
  available
  connected
  enabled
  accountId
  accountName
  locationId
  locationName
  catalogId
  catalogName
  customerListId
  customerListName
  features {
    pushOrders
    syncStatus
    syncInventory
    syncCatalog
    publishCatalog
  }
  syncCustomers
  catalogAutoImport
  catalogUpdateAvailable
  catalogPendingReview
  autoRefundOnCancel
  catalogLanguage
  variantRef
  channelName
  deliveryChargeRef
  paymentFeeChargeRef
  platformPrices {
    variantRef
    name
    markupPercent
    roundToCents
  }
  importImages
  lastCatalogSyncAt
  lastEventAt
  authErrorAt
  lastError
  relinkRequired
  backlog {
    pending
    parked
  }
  unlinkedProducts
  attention
  catalogDirection
  publish {
    ${HUBRISE_PUBLISH_FIELDS}
  }
`

const GET_STATUS = /* GraphQL */ `
  query HubriseStatus {
    hubriseStatus {
      ${HUBRISE_STATUS_FIELDS}
    }
  }
`

const STATUS_KEY = 'pili-hubrise-status'

/** How often the status is read again while a screen that shows it is open. */
export const HUBRISE_POLL_MS = 30_000

/** The shared status without any loading or polling: for the composables that only write it. */
export function useHubriseStatusState() {
  const status = useState<HubriseStatus | null>(STATUS_KEY, () => null)
  const setStatus = (next: HubriseStatus) => {
    status.value = next
  }
  return { status, setStatus }
}

// One read at a time and one timer for the whole page, however many components ask for the status.
let inflight: Promise<HubriseStatus | null> | null = null
// The outcome of the latest shared read, copied into the refs of every caller.
let lastError: unknown = null
const pollers = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

/**
 * The HubRise status, shared by the layout banner, the navigation and the HubRise page. `status` stays null until the
 * first load; `status.available === false` means the server has no HubRise configured and every consumer hides itself.
 *
 * Call it directly in `<script setup>`: it loads when mounted and reads again every 30 seconds while a component that
 * uses it is on screen (a single timer, stopped with the last one).
 */
export function useHubriseStatus() {
  const { $gqlFetch } = useNuxtApp()
  const { status, setStatus } = useHubriseStatusState()
  const loading = ref(false)
  const loadError = ref<unknown>(null)

  const read = async (): Promise<HubriseStatus | null> => {
    loading.value = true
    try {
      const data = await $gqlFetch<{ hubriseStatus: HubriseStatus } | null>(GET_STATUS)
      lastError = null
      loadError.value = null
      if (data?.hubriseStatus) setStatus(data.hubriseStatus)
      return status.value
    } catch (error: unknown) {
      // Not an admin, or the API is down: keep what is shown, the page displays the error.
      lastError = error
      loadError.value = error
      return null
    } finally {
      loading.value = false
    }
  }

  const reload = async (): Promise<HubriseStatus | null> => {
    inflight ??= read().finally(() => {
      inflight = null
    })
    // A caller that joined a read started by another one waits and gets its outcome too.
    loading.value = true
    try {
      return await inflight
    } finally {
      loadError.value = lastError
      loading.value = false
    }
  }

  // The poll leaves a server without HubRise alone.
  const poll = () => {
    if (status.value?.available !== false) void reload()
  }

  onMounted(() => {
    pollers.add(poll)
    void reload()
    // Every poller asks, the shared read answers once.
    timer ??= setInterval(() => {
      for (const ask of pollers) ask()
    }, HUBRISE_POLL_MS)
  })
  onBeforeUnmount(() => {
    pollers.delete(poll)
    if (pollers.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  })

  return { status, setStatus, reload, loading, loadError }
}
