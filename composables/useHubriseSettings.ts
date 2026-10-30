import { ref } from 'vue'
import { navigateTo, useNuxtApp } from '#imports'
import { HUBRISE_STATUS_FIELDS, useHubriseStatus } from '~/composables/useHubriseStatus'
import type {
  HubriseOutboxItem,
  HubriseOutboxState,
  HubriseSettingsInput,
  HubriseStatus,
} from '~/utils/hubrise'

const UPDATE_SETTINGS = /* GraphQL */ `
  mutation UpdateHubriseSettings($input: HubriseSettingsInput!) {
    updateHubriseSettings(input: $input) {
      ${HUBRISE_STATUS_FIELDS}
    }
  }
`

const START_CONNECTION = /* GraphQL */ `
  mutation StartHubriseConnection {
    startHubriseConnection
  }
`

const DISCONNECT = /* GraphQL */ `
  mutation DisconnectHubrise($forgetLinks: Boolean) {
    disconnectHubrise(forgetLinks: $forgetLinks) {
      ${HUBRISE_STATUS_FIELDS}
    }
  }
`

const FORGET_LINKS = /* GraphQL */ `
  mutation ForgetHubriseLinks {
    forgetHubriseLinks
  }
`

const SYNC_INVENTORY = /* GraphQL */ `
  mutation SyncHubriseInventory {
    syncHubriseInventory
  }
`

const LINK_PRODUCT = /* GraphQL */ `
  mutation LinkHubriseProduct($productId: ID!, $skuRef: String) {
    linkHubriseProduct(productId: $productId, skuRef: $skuRef)
  }
`

const OUTBOX = /* GraphQL */ `
  query HubriseOutbox($state: HubriseOutboxState, $first: Int) {
    hubriseOutbox(state: $state, first: $first) {
      id
      kind
      orderId
      state
      attempts
      lastError
      nextAttemptAt
      createdAt
      sentAt
      parkedAt
    }
  }
`

const RETRY_OUTBOX = /* GraphQL */ `
  mutation RetryHubriseOutbox($id: String) {
    retryHubriseOutbox(id: $id)
  }
`

/** Rows of the outbox the page lists at once. */
export const OUTBOX_PAGE_SIZE = 50

export type HubriseAction =
  | 'settings'
  | 'connect'
  | 'disconnect'
  | 'forgetLinks'
  | 'syncInventory'
  | 'linkProduct'
  | 'outbox'
  | 'retry'

/**
 * The actions of the HubRise page that are not about the menu: settings, connection, links, inventory, outbox. Each one
 * rejects with the raw GraphQL errors (read them with `hubriseError`), so the page decides how to tell the failure. The
 * shared status is refreshed after every action that changes it.
 *
 * Call it directly in `<script setup>`.
 */
export function useHubriseSettings() {
  const { $gqlFetch } = useNuxtApp()
  const { setStatus, reload } = useHubriseStatus()
  /** The action running now, for the spinner of its button; null when idle. */
  const busy = ref<HubriseAction | null>(null)
  const outbox = ref<HubriseOutboxItem[]>([])

  const run = async <T>(action: HubriseAction, work: () => Promise<T>): Promise<T> => {
    busy.value = action
    try {
      return await work()
    } finally {
      busy.value = null
    }
  }

  const updateSettings = (input: HubriseSettingsInput): Promise<HubriseStatus> =>
    run('settings', async () => {
      const data = await $gqlFetch<{ updateHubriseSettings: HubriseStatus }>(UPDATE_SETTINGS, {
        variables: { input },
      })
      setStatus(data.updateHubriseSettings)
      return data.updateHubriseSettings
    })

  /** Sends the browser to HubRise to authorize; HubRise sends it back to /hubrise?hubrise=<outcome>. */
  const connect = (): Promise<void> =>
    run('connect', async () => {
      const data = await $gqlFetch<{ startHubriseConnection: string }>(START_CONNECTION)
      const url = new URL(data.startHubriseConnection)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('The HubRise authorization address is not a web address')
      }
      await navigateTo(url.toString(), { external: true })
    })

  const disconnect = (forgetLinks: boolean): Promise<HubriseStatus> =>
    run('disconnect', async () => {
      const data = await $gqlFetch<{ disconnectHubrise: HubriseStatus }>(DISCONNECT, {
        variables: { forgetLinks },
      })
      setStatus(data.disconnectHubrise)
      return data.disconnectHubrise
    })

  /** Clears every catalog link (the products stay). Returns how many links went. */
  const forgetLinks = (): Promise<number> =>
    run('forgetLinks', async () => {
      const data = await $gqlFetch<{ forgetHubriseLinks: number }>(FORGET_LINKS)
      await reload()
      return data.forgetHubriseLinks
    })

  /** Reads the HubRise inventory now. Returns how many products and options changed. */
  const syncInventory = (): Promise<number> =>
    run('syncInventory', async () => {
      const data = await $gqlFetch<{ syncHubriseInventory: number }>(SYNC_INVENTORY)
      await reload()
      return data.syncHubriseInventory
    })

  /** Links a product to a HubRise SKU by hand; no `skuRef` removes the link. */
  const linkProduct = (productId: string, skuRef: string | null): Promise<boolean> =>
    run('linkProduct', async () => {
      const data = await $gqlFetch<{ linkHubriseProduct: boolean }>(LINK_PRODUCT, {
        variables: { productId, skuRef },
      })
      await reload()
      return data.linkHubriseProduct
    })

  const loadOutbox = (state: HubriseOutboxState | null = null): Promise<HubriseOutboxItem[]> =>
    run('outbox', async () => {
      const data = await $gqlFetch<{ hubriseOutbox: HubriseOutboxItem[] }>(OUTBOX, {
        variables: { state, first: OUTBOX_PAGE_SIZE },
      })
      outbox.value = data.hubriseOutbox
      return data.hubriseOutbox
    })

  /** Retries the parked rows of one chain (`id`) or all of them. Returns how many came back. */
  const retryOutbox = (id: string | null = null): Promise<number> =>
    run('retry', async () => {
      const data = await $gqlFetch<{ retryHubriseOutbox: number }>(RETRY_OUTBOX, {
        variables: { id },
      })
      await reload()
      return data.retryHubriseOutbox
    })

  return {
    busy,
    outbox,
    updateSettings,
    connect,
    disconnect,
    forgetLinks,
    syncInventory,
    linkProduct,
    loadOutbox,
    retryOutbox,
  }
}
