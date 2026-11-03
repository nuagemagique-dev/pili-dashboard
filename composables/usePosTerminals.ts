import { computed, onMounted, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useGqlMutation, useNuxtApp } from '#imports'
import { hasText } from '~/utils/guards'
import {
  enrollmentErrorKey,
  revokeErrorKey,
  secondsUntil,
  sortDevices,
  type PosDevice,
  type PosEnrollment,
} from '~/utils/posTerminals'

const DEVICE_FIELDS = `
  id
  label
  serialNumber
  registeredAt
  lastSeenAt
  revokedAt
`

const GET_DEVICES = /* GraphQL */ `
  query PosDevices {
    posDevices {
      ${DEVICE_FIELDS}
    }
  }
`

const CREATE_ENROLLMENT = /* GraphQL */ `
  mutation CreatePosEnrollment($label: String!) {
    createPosEnrollment(label: $label) {
      code
      expiresAt
    }
  }
`

const REVOKE_DEVICE = /* GraphQL */ `
  mutation RevokePosDevice($id: ID!) {
    revokePosDevice(id: $id) {
      ${DEVICE_FIELDS}
    }
  }
`

/**
 * The enrolled handhelds of this restaurant, with the enroll and revoke actions of the
 * terminals page. Errors are i18n keys. `now` ticks every 30 s for the "last seen" times.
 */
export function usePosTerminals() {
  const { $gqlFetch } = useNuxtApp()
  const devices = ref<PosDevice[]>([])
  const loading = ref(true)
  const loadError = ref(false)

  const enrollment = ref<PosEnrollment | null>(null)
  const createError = ref('')
  const revokeError = ref('')
  const revokingId = ref('')

  const { mutate: createMutate, loading: creating } = useGqlMutation<{
    createPosEnrollment: PosEnrollment
  }>(CREATE_ENROLLMENT)
  const { mutate: revokeMutate } = useGqlMutation<{ revokePosDevice: PosDevice }>(REVOKE_DEVICE)

  const now = ref(Date.now())
  const tick = setInterval(() => {
    now.value = Date.now()
  }, 30_000)
  onScopeDispose(() => {
    clearInterval(tick)
  })

  const refresh = async () => {
    loadError.value = false
    try {
      const data = await $gqlFetch<{ posDevices: PosDevice[] } | null>(GET_DEVICES)
      if (data) devices.value = sortDevices(data.posDevices)
    } catch {
      loadError.value = true
    } finally {
      loading.value = false
      now.value = Date.now()
    }
  }

  /** Asks for a one-time code; true when `enrollment` holds it. */
  const createEnrollment = async (label: string): Promise<boolean> => {
    createError.value = ''
    try {
      const data = await createMutate({ label: label.trim() })
      enrollment.value = data.createPosEnrollment
      return true
    } catch (error) {
      createError.value = enrollmentErrorKey(error)
      return false
    }
  }

  /** Forgets the code (the dialog closed) and reloads the list, which shows the new handheld. */
  const closeEnrollment = async () => {
    enrollment.value = null
    createError.value = ''
    await refresh()
  }

  /** Revokes a handheld: the backend cuts it off at once. True on success. */
  const revoke = async (id: string): Promise<boolean> => {
    revokeError.value = ''
    revokingId.value = id
    try {
      const data = await revokeMutate({ id })
      const revoked = data.revokePosDevice
      devices.value = sortDevices(devices.value.map((d) => (d.id === revoked.id ? revoked : d)))
      return true
    } catch (error) {
      revokeError.value = revokeErrorKey(error)
      return false
    } finally {
      revokingId.value = ''
    }
  }

  onMounted(refresh)

  return {
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
  }
}

/**
 * Seconds left before `expiresAt`, ticking every second while there is a date and some
 * time left; 0 once expired or without a date.
 */
export function useEnrollmentCountdown(expiresAt: Ref<string | null | undefined>) {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined

  const stop = () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  const secondsLeft = computed(() =>
    hasText(expiresAt.value) ? secondsUntil(expiresAt.value, now.value) : 0,
  )

  watch(
    expiresAt,
    (value) => {
      stop()
      now.value = Date.now()
      if (!hasText(value)) return
      timer = setInterval(() => {
        now.value = Date.now()
        if (secondsLeft.value === 0) stop()
      }, 1000)
    },
    { immediate: true },
  )
  onScopeDispose(stop)

  const expired = computed(() => hasText(expiresAt.value) && secondsLeft.value === 0)

  return { secondsLeft, expired }
}
