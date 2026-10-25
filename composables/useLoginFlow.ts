import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from '#imports'
import { useI18n } from 'vue-i18n'
import { useZitadelApi } from '~/composables/useZitadelApi'
import { isRecord } from '~/utils/guards'

type LoginStep = 'email' | 'code' | 'totp'

/** HTTP status of a failed `$fetch` call (`response.status` or `statusCode`). */
const httpStatus = (error: unknown): number | undefined => {
  if (!isRecord(error)) return undefined
  const fromResponse = isRecord(error.response) ? error.response.status : undefined
  if (typeof fromResponse === 'number' && fromResponse !== 0) return fromResponse
  return typeof error.statusCode === 'number' ? error.statusCode : undefined
}

/** The `error` code of the JSON body of a failed `$fetch` call. */
const errorCodeOf = (error: unknown): unknown =>
  isRecord(error) && isRecord(error.data) ? error.data.error : undefined

/** The backend refuses to finalize a staff login whose TOTP step was skipped. */
const isMfaRequired = (error: unknown): boolean =>
  httpStatus(error) === 403 && errorCodeOf(error) === 'mfa_required'

/**
 * State machine of the login page (pages/auth/login.vue): email -> OTP code -> (staff with an authenticator app) TOTP
 * code -> OIDC finalize. Each step calls tsb-service's Zitadel proxy (`useZitadelApi`); the final step hands over to
 * Zitadel by redirect.
 * Failures are mapped to a message of `login.*`; a request in flight blocks every other submit.
 */
export function useLoginFlow() {
  const { t } = useI18n()
  const route = useRoute()
  const { requestOtpLogin, verifyOtpLogin, verifyTotpLogin, resendOtpLogin, finalizeOidcAuth } =
    useZitadelApi()

  const step = ref<LoginStep>('email')
  const email = ref('')
  const code = ref('')
  const totpCode = ref('')
  const otpSessionId = ref('')
  const otpSessionToken = ref('')
  const errorMessage = ref('')
  const loading = ref(false)
  const initializing = ref(false)
  const resendCooldown = ref(0)
  let cooldownTimer: ReturnType<typeof setInterval> | null = null

  // Zitadel passes authRequestID when redirecting to custom login (URL query param)
  const authRequestIdParam = route.query.authRequestID
  const authRequestIdFromUrl = typeof authRequestIdParam === 'string' ? authRequestIdParam : ''
  // Fetched via authorize-proxy when no URL param (so we stay on dashboard domain)
  const fetchedAuthRequestId = ref('')

  const effectiveAuthRequestId = computed(() => authRequestIdFromUrl || fetchedAuthRequestId.value)

  // Show session expired message if redirected from auth middleware
  if (route.query.session === 'expired') {
    errorMessage.value = t('login.sessionExpired')
  }

  // Fetch authRequestId via authorize-proxy when navigated directly (no authRequestID in URL), so the user never
  // Leaves the dashboard domain. Also after a session expiry (?session=expired): that is the usual way in, and without
  // An authRequestId the last step would fall back to signIn(), i.e. to Zitadel's own login UI.
  onMounted(async () => {
    if (!authRequestIdFromUrl) {
      initializing.value = true
      try {
        const { useOidc } = await import('~/composables/useOidc')
        const { getAuthRequestId } = useOidc()
        fetchedAuthRequestId.value = await getAuthRequestId()
      } catch (error: unknown) {
        if (import.meta.dev) console.error('Failed to fetch authRequestId:', error)
      } finally {
        initializing.value = false
      }
    }
  })

  const stopCooldown = () => {
    if (cooldownTimer) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }

  const startCooldown = (seconds = 20) => {
    resendCooldown.value = seconds
    stopCooldown()
    cooldownTimer = setInterval(() => {
      resendCooldown.value--
      if (resendCooldown.value <= 0) stopCooldown()
    }, 1000)
  }

  onBeforeUnmount(stopCooldown)

  /*
   * Synchronous in-flight flags. The reactive `loading` ref drives the UI but
   * Vue's reactivity is async, a tight double-fire (form submit + click,
   * hydration remount, retry path) can sneak past `if (loading.value) return`.
   * These plain JS booleans flip atomically inside the handler, blocking the
   * duplicate before it ever reaches the network.
   */
  let requestInFlight = false
  let verifyInFlight = false

  const requestCode = async () => {
    if (requestInFlight || loading.value) return
    requestInFlight = true
    errorMessage.value = ''
    loading.value = true

    try {
      const session = await requestOtpLogin(email.value)
      otpSessionId.value = session.sessionId
      otpSessionToken.value = session.sessionToken
      step.value = 'code'
      startCooldown()
    } catch (error: unknown) {
      if (import.meta.dev) console.error('OTP request error:', error)
      const errorCode = errorCodeOf(error)
      if (httpStatus(error) === 429) {
        errorMessage.value = t('login.tooManyRequests')
      } else if (errorCode === 'email_not_verified') {
        errorMessage.value = t('login.emailNotVerified')
      } else {
        errorMessage.value = t('login.requestFailed')
      }
    } finally {
      requestInFlight = false
      loading.value = false
    }
  }

  const backToEmail = () => {
    step.value = 'email'
    code.value = ''
    totpCode.value = ''
    errorMessage.value = ''
    otpSessionId.value = ''
    otpSessionToken.value = ''
  }

  const resendCode = async () => {
    if (!otpSessionId.value || !otpSessionToken.value) return
    errorMessage.value = ''
    loading.value = true
    try {
      await resendOtpLogin(otpSessionId.value, otpSessionToken.value)
      startCooldown()
    } catch (error: unknown) {
      errorMessage.value =
        httpStatus(error) === 429 ? t('login.tooManyRequests') : t('login.requestFailed')
    } finally {
      loading.value = false
    }
  }

  /*
   * Completes the OIDC flow for a session that passed every required check.
   * Throws on failure; callers map the error to a message.
   */
  const finishLogin = async (sessionId: string, sessionToken: string) => {
    if (!effectiveAuthRequestId.value) {
      const { useOidc } = await import('~/composables/useOidc')
      const { signIn } = useOidc()
      await signIn({ login_hint: email.value })
      return
    }

    const result = await finalizeOidcAuth(effectiveAuthRequestId.value, sessionId, sessionToken)

    window.location.href = result.callbackUrl
  }

  const verifyCode = async () => {
    if (verifyInFlight || loading.value) return
    verifyInFlight = true
    errorMessage.value = ''
    loading.value = true

    try {
      const verified = await verifyOtpLogin(otpSessionId.value, otpSessionToken.value, code.value)
      otpSessionId.value = verified.sessionId
      otpSessionToken.value = verified.sessionToken

      if (verified.requiresTotp === true) {
        step.value = 'totp'
        loading.value = false
        return
      }

      await finishLogin(verified.sessionId, verified.sessionToken)
    } catch (error: unknown) {
      loading.value = false
      if (import.meta.dev) console.error('OTP verify error:', error)

      if (isMfaRequired(error)) {
        step.value = 'totp'
        return
      }

      errorMessage.value =
        httpStatus(error) === 429 ? t('login.tooManyRequests') : t('login.invalidCode')
    } finally {
      /*
       * Always release the in-flight flag so retries (after error or after a
       * not_admin outcome that keeps us on the page) can re-fire. The success
       * path triggers a navigation; clearing the flag there is a no-op.
       */
      verifyInFlight = false
    }
  }

  const verifyTotp = async () => {
    if (verifyInFlight || loading.value) return
    verifyInFlight = true
    errorMessage.value = ''
    loading.value = true

    try {
      const verified = await verifyTotpLogin(
        otpSessionId.value,
        otpSessionToken.value,
        totpCode.value,
      )
      otpSessionToken.value = verified.sessionToken
      await finishLogin(verified.sessionId, verified.sessionToken)
    } catch (error: unknown) {
      loading.value = false
      if (import.meta.dev) console.error('TOTP verify error:', error)
      totpCode.value = ''
      errorMessage.value =
        httpStatus(error) === 429 ? t('login.tooManyRequests') : t('login.invalidTotp')
    } finally {
      verifyInFlight = false
    }
  }

  return {
    step,
    email,
    code,
    totpCode,
    otpSessionId,
    otpSessionToken,
    errorMessage,
    loading,
    initializing,
    resendCooldown,
    requestCode,
    backToEmail,
    resendCode,
    verifyCode,
    verifyTotp,
  }
}
