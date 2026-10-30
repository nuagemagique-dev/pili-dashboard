import { ref } from 'vue'
import { useNuxtApp } from '#imports'
import { useHubriseStatus } from '~/composables/useHubriseStatus'
import {
  type HubriseCatalogDiff,
  type HubriseErrorInfo,
  type HubriseSyncMode,
  type HubriseSyncResult,
  hubriseError,
} from '~/utils/hubrise'

const DIFF_FIELDS = `
  catalogHash
  changes {
    entity
    action
    key
    name
    fields
  }
  warnings {
    code
    key
    message
  }
  conflicts {
    code
    key
    message
  }
  unchanged
  retiringProducts
  linkedProducts
  retireNeedsConfirm
`

const PREVIEW_SYNC = /* GraphQL */ `
  mutation PreviewHubriseCatalogSync($mode: HubriseSyncMode!) {
    previewHubriseCatalogSync(mode: $mode) {
      ${DIFF_FIELDS}
    }
  }
`

const SYNC = /* GraphQL */ `
  mutation SyncHubriseCatalog($mode: HubriseSyncMode!, $confirmRetire: Boolean) {
    syncHubriseCatalog(mode: $mode, confirmRetire: $confirmRetire) {
      mode
      applied
      pendingReview
      failedBatches
      diff {
        ${DIFF_FIELDS}
      }
    }
  }
`

/**
 * The IMPORT side of the menu (HubRise owns it): the dry run that shows what an import would do, and the import itself,
 * with the confirmation a mass retirement needs. Failures do not reject: `error` holds the HubRise code and message key.
 *
 * Call it directly in `<script setup>`.
 */
export function useHubriseCatalog() {
  const { $gqlFetch } = useNuxtApp()
  const { reload } = useHubriseStatus()
  const diff = ref<HubriseCatalogDiff | null>(null)
  const result = ref<HubriseSyncResult | null>(null)
  const busy = ref(false)
  const error = ref<HubriseErrorInfo | null>(null)

  const run = async <T>(work: () => Promise<T>): Promise<T | null> => {
    busy.value = true
    error.value = null
    try {
      return await work()
    } catch (failure: unknown) {
      error.value = hubriseError(failure)
      return null
    } finally {
      busy.value = false
    }
  }

  /** Computes what an import would do and writes nothing. */
  const preview = (mode: HubriseSyncMode): Promise<HubriseCatalogDiff | null> =>
    run(async () => {
      const data = await $gqlFetch<{ previewHubriseCatalogSync: HubriseCatalogDiff }>(
        PREVIEW_SYNC,
        { variables: { mode } },
      )
      diff.value = data.previewHubriseCatalogSync
      await reload()
      return data.previewHubriseCatalogSync
    })

  const sync = (mode: HubriseSyncMode, confirmRetire = false): Promise<HubriseSyncResult | null> =>
    run(async () => {
      const data = await $gqlFetch<{ syncHubriseCatalog: HubriseSyncResult }>(SYNC, {
        variables: { mode, confirmRetire },
      })
      result.value = data.syncHubriseCatalog
      diff.value = data.syncHubriseCatalog.diff
      await reload()
      return data.syncHubriseCatalog
    })

  const reset = () => {
    diff.value = null
    result.value = null
    error.value = null
  }

  return { diff, result, busy, error, preview, sync, reset }
}
