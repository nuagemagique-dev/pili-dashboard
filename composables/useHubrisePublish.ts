import { onScopeDispose, ref } from 'vue'
import { useNuxtApp } from '#imports'
import {
  HUBRISE_PUBLISH_FIELDS,
  HUBRISE_STATUS_FIELDS,
  useHubriseStatusState,
} from '~/composables/useHubriseStatus'
import {
  type HubriseCatalogDirection,
  type HubriseErrorInfo,
  type HubrisePublishPreview,
  type HubrisePublishResult,
  type HubriseStatus,
  hubriseError,
  publishVariables,
} from '~/utils/hubrise'

const ISSUE_FIELDS = `
  code
  key
  message
`

const SET_DIRECTION = /* GraphQL */ `
  mutation SetHubriseCatalogDirection(
    $direction: HubriseCatalogDirection!
    $acknowledgeLocalOverwrite: Boolean
  ) {
    setHubriseCatalogDirection(
      direction: $direction
      acknowledgeLocalOverwrite: $acknowledgeLocalOverwrite
    ) {
      ${HUBRISE_STATUS_FIELDS}
    }
  }
`

const PREVIEW = /* GraphQL */ `
  query PreviewHubriseCatalogPublish($removeForeign: Boolean) {
    previewHubriseCatalogPublish(removeForeign: $removeForeign) {
      planHash
      firstPublish
      added
      updated
      removed
      unchanged
      foreign
      counts {
        entity
        added
        updated
        removed
      }
      changes {
        entity
        action
        key
        ref
        name
        fields
      }
      truncated
      foreignItems {
        entity
        ref
        name
      }
      preserved
      warnings {
        ${ISSUE_FIELDS}
      }
      blockers {
        ${ISSUE_FIELDS}
      }
      removalsNeedConfirm
      generatedAt
    }
  }
`

const PUBLISH = /* GraphQL */ `
  mutation PublishHubriseCatalog($confirmRemovals: Boolean, $removeForeign: Boolean, $planHash: String) {
    publishHubriseCatalog(
      confirmRemovals: $confirmRemovals
      removeForeign: $removeForeign
      planHash: $planHash
    ) {
      published
      queued
      status {
        ${HUBRISE_PUBLISH_FIELDS}
      }
    }
  }
`

const ACKNOWLEDGE = /* GraphQL */ `
  mutation AcknowledgeHubriseExternalChange {
    acknowledgeHubriseExternalChange {
      ${HUBRISE_STATUS_FIELDS}
    }
  }
`

/**
 * The PUBLISH side of the menu (the dashboard owns it): who owns the menu, the preview of what a publish would change,
 * the confirmed publish, and the external-change acknowledgement. Failures do not reject: `error` holds the HubRise code
 * and message key, `stale` says the plan changed under the admin (the preview was reloaded) and `retryIn` counts down
 * the seconds HubRise asked to wait.
 *
 * Call it directly in `<script setup>`.
 */
export function useHubrisePublish() {
  const { $gqlFetch } = useNuxtApp()
  const { status, setStatus } = useHubriseStatusState()
  const preview = ref<HubrisePublishPreview | null>(null)
  const loadingPreview = ref(false)
  const publishing = ref(false)
  const switching = ref(false)
  const error = ref<HubriseErrorInfo | null>(null)
  const stale = ref(false)
  const retryIn = ref(0)

  let countdown: ReturnType<typeof setInterval> | null = null
  const stopCountdown = () => {
    if (countdown !== null) clearInterval(countdown)
    countdown = null
  }
  const startCountdown = (seconds: number) => {
    stopCountdown()
    retryIn.value = seconds
    countdown = setInterval(() => {
      retryIn.value -= 1
      if (retryIn.value <= 0) stopCountdown()
    }, 1000)
  }
  onScopeDispose(stopCountdown)

  const fail = (failure: unknown): HubriseErrorInfo => {
    const info = hubriseError(failure)
    error.value = info
    if (info.retryAfterSeconds !== null) startCountdown(info.retryAfterSeconds)
    return info
  }

  const begin = () => {
    error.value = null
    stale.value = false
    stopCountdown()
    retryIn.value = 0
  }

  /** Switches who owns the menu. Returns the new status, or null with `error` set. */
  const setDirection = async (
    direction: HubriseCatalogDirection,
    acknowledgeLocalOverwrite = false,
  ): Promise<HubriseStatus | null> => {
    switching.value = true
    begin()
    try {
      const data = await $gqlFetch<{ setHubriseCatalogDirection: HubriseStatus }>(SET_DIRECTION, {
        variables: { direction, acknowledgeLocalOverwrite },
      })
      setStatus(data.setHubriseCatalogDirection)
      return data.setHubriseCatalogDirection
    } catch (failure: unknown) {
      fail(failure)
      return null
    } finally {
      switching.value = false
    }
  }

  /** Computes what a publish would change (one read of the HubRise catalog) and writes nothing. */
  const loadPreview = async (removeForeign = false): Promise<HubrisePublishPreview | null> => {
    loadingPreview.value = true
    begin()
    try {
      const data = await $gqlFetch<{ previewHubriseCatalogPublish: HubrisePublishPreview }>(
        PREVIEW,
        { variables: { removeForeign } },
      )
      preview.value = data.previewHubriseCatalogPublish
      return data.previewHubriseCatalogPublish
    } catch (failure: unknown) {
      fail(failure)
      return null
    } finally {
      loadingPreview.value = false
    }
  }

  /**
   * Publishes the plan the admin saw. When the plan changed meanwhile (HUBRISE_PREVIEW_STALE) nothing is written: the
   * preview is loaded again and `stale` is set, so the admin reads the new plan before confirming it.
   */
  const publish = async (
    seen: HubrisePublishPreview,
    removeForeign: boolean,
  ): Promise<HubrisePublishResult | null> => {
    publishing.value = true
    begin()
    try {
      const data = await $gqlFetch<{ publishHubriseCatalog: HubrisePublishResult }>(PUBLISH, {
        variables: { ...publishVariables(seen, removeForeign) },
      })
      // The mutation answers with the publish block only: fold it into the shared status (when none is loaded yet,
      // the next read brings the whole status).
      if (status.value !== null)
        setStatus({ ...status.value, publish: data.publishHubriseCatalog.status })
      return data.publishHubriseCatalog
    } catch (failure: unknown) {
      const info = fail(failure)
      if (info.code === 'HUBRISE_PREVIEW_STALE') {
        if ((await loadPreview(removeForeign)) !== null) {
          error.value = info
          stale.value = true
        }
      }
      return null
    } finally {
      publishing.value = false
    }
  }

  /** Clears the "someone edited HubRise elsewhere" warning. */
  const acknowledgeExternalChange = async (): Promise<HubriseStatus | null> => {
    begin()
    try {
      const data = await $gqlFetch<{ acknowledgeHubriseExternalChange: HubriseStatus }>(ACKNOWLEDGE)
      setStatus(data.acknowledgeHubriseExternalChange)
      return data.acknowledgeHubriseExternalChange
    } catch (failure: unknown) {
      fail(failure)
      return null
    }
  }

  const reset = () => {
    preview.value = null
    begin()
  }

  return {
    preview,
    loadingPreview,
    publishing,
    switching,
    error,
    stale,
    retryIn,
    setDirection,
    loadPreview,
    publish,
    acknowledgeExternalChange,
    reset,
  }
}
