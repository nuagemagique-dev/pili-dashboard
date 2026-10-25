// useLoginFlow: the state machine of the login page. Email -> OTP code -> (staff with an authenticator app) TOTP code ->
// OIDC finalize, with the in-flight guard, the cooldown of "resend", the mapping of failures to messages (429, mfa
// required, unverified email, bad code) and the last step (redirect to Zitadel's callback). The proxy calls (`useZitadelApi`), the OIDC client and the
// route are the boundaries; the refs, the timer and i18n keys are what is checked.
// Run: `vp test run tests/composables/useLoginFlow.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { setFlags } from '../support/flags'
import { mountComposable } from '../helpers/mountComposable'
import { settle } from '../helpers/settle'

const zitadel = vi.hoisted(() => ({
  requestOtpLogin: vi.fn(),
  verifyOtpLogin: vi.fn(),
  verifyTotpLogin: vi.fn(),
  resendOtpLogin: vi.fn(),
  finalizeOidcAuth: vi.fn(),
}))
const oidc = vi.hoisted(() => ({
  getAuthRequestId: vi.fn<() => Promise<string>>(),
  signIn: vi.fn(),
}))
const route = vi.hoisted(() => ({ query: {} as Record<string, unknown> }))

vi.mock('~/composables/useZitadelApi', () => ({ useZitadelApi: () => zitadel }))
vi.mock('~/composables/useOidc', () => ({ useOidc: () => oidc }))
mockNuxtImport('useRoute', () => () => route)
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

const { useLoginFlow } = await import('~/composables/useLoginFlow')

/** A failed `$fetch` call: ofetch puts the status on `response.status` and `statusCode`. */
const httpError = (status: number, error?: string) =>
  Object.assign(new Error(`HTTP ${status}`), {
    response: { status },
    statusCode: status,
    data: error ? { error } : undefined,
  })

/** A promise a test settles by hand, to hold a call "in flight". */
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const location = { href: '' }
beforeEach(() => {
  vi.resetAllMocks()
  route.query = { authRequestID: 'auth-req-1' }
  location.href = ''
  vi.stubGlobal('location', location)
  zitadel.requestOtpLogin.mockResolvedValue({ sessionId: 's-1', sessionToken: 'tok-1' })
  zitadel.verifyOtpLogin.mockResolvedValue({ sessionId: 's-2', sessionToken: 'tok-2' })
  zitadel.verifyTotpLogin.mockResolvedValue({ sessionId: 's-3', sessionToken: 'tok-3' })
  zitadel.resendOtpLogin.mockResolvedValue({ success: true })
  zitadel.finalizeOidcAuth.mockResolvedValue({
    callbackUrl: 'https://zitadel.test/callback?code=abc&state=xyz',
  })
  oidc.getAuthRequestId.mockResolvedValue('fetched-req')
  oidc.signIn.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

const mountFlow = async () => {
  const mounted = mountComposable(() => useLoginFlow())
  await settle()
  return { ...mounted, flow: mounted.result }
}

/** A flow past the email step, holding the session of `requestOtpLogin`. */
const flowAtCodeStep = async () => {
  const mounted = await mountFlow()
  mounted.flow.email.value = 'chef@example.com'
  await mounted.flow.requestCode()
  mounted.flow.code.value = '123456'
  return mounted
}

describe('start', () => {
  it('starts on the email step, without a message', async () => {
    const { flow } = await mountFlow()
    expect(flow.step.value).toBe('email')
    expect(flow.errorMessage.value).toBe('')
    expect(flow.loading.value).toBe(false)
    expect(flow.resendCooldown.value).toBe(0)
  })

  it('shows the "session expired" message when the auth middleware sent the user here', async () => {
    route.query = { session: 'expired' }
    const { flow } = await mountFlow()
    expect(flow.errorMessage.value).toBe('login.sessionExpired')
  })

  it('does not fetch an authRequestId when Zitadel passed one', async () => {
    await mountFlow()
    expect(oidc.getAuthRequestId).not.toHaveBeenCalled()
  })

  it('still fetches an authRequestId when the session just expired, and finalizes through it', async () => {
    route.query = { session: 'expired' }
    oidc.getAuthRequestId.mockResolvedValue('fetched-req')
    const { flow } = await mountFlow()
    await settle()
    expect(oidc.getAuthRequestId).toHaveBeenCalledOnce()
    expect(flow.errorMessage.value).toBe('login.sessionExpired')

    flow.email.value = 'chef@example.com'
    await flow.requestCode()
    flow.code.value = '123456'
    await flow.verifyCode()
    expect(zitadel.finalizeOidcAuth).toHaveBeenCalledWith('fetched-req', 's-2', 'tok-2')
    expect(oidc.signIn).not.toHaveBeenCalled()
  })

  it('fetches the authRequestId through the proxy when the page was opened directly', async () => {
    route.query = {}
    const pending = deferred<string>()
    oidc.getAuthRequestId.mockReturnValue(pending.promise)
    const { flow } = await mountFlow()
    expect(flow.initializing.value).toBe(true)
    pending.resolve('fetched-req')
    await settle()
    expect(flow.initializing.value).toBe(false)

    // The fetched id is what the last step finalizes with.
    flow.email.value = 'chef@example.com'
    await flow.requestCode()
    flow.code.value = '123456'
    await flow.verifyCode()
    expect(zitadel.finalizeOidcAuth).toHaveBeenCalledWith('fetched-req', 's-2', 'tok-2')
  })

  it('stays usable when the authRequestId cannot be fetched (the last step then starts a plain sign-in)', async () => {
    route.query = {}
    oidc.getAuthRequestId.mockRejectedValue(new Error('offline'))
    const { flow } = await mountFlow()
    expect(flow.initializing.value).toBe(false)
    expect(flow.errorMessage.value).toBe('')

    flow.email.value = 'chef@example.com'
    await flow.requestCode()
    flow.code.value = '123456'
    await flow.verifyCode()
    expect(zitadel.finalizeOidcAuth).not.toHaveBeenCalled()
    expect(oidc.signIn).toHaveBeenCalledExactlyOnceWith({ login_hint: 'chef@example.com' })
  })

  it('logs the failure to fetch the authRequestId in development only', async () => {
    route.query = {}
    oidc.getAuthRequestId.mockRejectedValue(new Error('offline'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await mountFlow()
    expect(log).not.toHaveBeenCalled()
    setFlags({ dev: true })
    await mountFlow()
    expect(log).toHaveBeenCalledWith('Failed to fetch authRequestId:', expect.any(Error))
  })
})

describe('requestCode', () => {
  it('asks for a code by email, moves to the code step and starts the resend cooldown', async () => {
    const { flow } = await mountFlow()
    flow.email.value = 'chef@example.com'
    flow.errorMessage.value = 'old error'

    await flow.requestCode()

    expect(zitadel.requestOtpLogin).toHaveBeenCalledExactlyOnceWith('chef@example.com')
    expect(flow.step.value).toBe('code')
    expect(flow.otpSessionId.value).toBe('s-1')
    expect(flow.otpSessionToken.value).toBe('tok-1')
    expect(flow.errorMessage.value).toBe('')
    expect(flow.loading.value).toBe(false)
    expect(flow.resendCooldown.value).toBe(20)
  })

  it.each([
    ['too many requests (response.status)', httpError(429), 'login.tooManyRequests'],
    [
      'too many requests (statusCode only)',
      Object.assign(new Error('x'), { statusCode: 429 }),
      'login.tooManyRequests',
    ],
    ['email not verified', httpError(403, 'email_not_verified'), 'login.emailNotVerified'],
    ['any other failure', httpError(500), 'login.requestFailed'],
    ['a network error', new TypeError('Failed to fetch'), 'login.requestFailed'],
    ['a failure without a value', undefined, 'login.requestFailed'],
  ])('maps %s to %s', async (_name, error, message) => {
    zitadel.requestOtpLogin.mockRejectedValue(error)
    const { flow } = await mountFlow()
    await flow.requestCode()
    expect(flow.errorMessage.value).toBe(message)
    expect(flow.step.value).toBe('email')
    expect(flow.loading.value).toBe(false)
    expect(flow.resendCooldown.value).toBe(0)
  })

  it('lets the user retry after a failure', async () => {
    zitadel.requestOtpLogin.mockRejectedValueOnce(httpError(500))
    const { flow } = await mountFlow()
    await flow.requestCode()
    await flow.requestCode()
    expect(zitadel.requestOtpLogin).toHaveBeenCalledTimes(2)
    expect(flow.step.value).toBe('code')
    expect(flow.errorMessage.value).toBe('')
  })

  it('sends one request when submitted twice at once (form submit + click)', async () => {
    const pending = deferred<{ sessionId: string; sessionToken: string }>()
    zitadel.requestOtpLogin.mockReturnValue(pending.promise)
    const { flow } = await mountFlow()

    const first = flow.requestCode()
    const second = flow.requestCode()
    pending.resolve({ sessionId: 's-1', sessionToken: 'tok-1' })
    await Promise.all([first, second])

    expect(zitadel.requestOtpLogin).toHaveBeenCalledTimes(1)
  })

  it('does nothing while another call (loading) is running', async () => {
    const { flow } = await mountFlow()
    flow.loading.value = true
    await flow.requestCode()
    expect(zitadel.requestOtpLogin).not.toHaveBeenCalled()
  })

  it('logs the failure in development only', async () => {
    zitadel.requestOtpLogin.mockRejectedValue(httpError(500))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { flow } = await mountFlow()
    await flow.requestCode()
    expect(log).not.toHaveBeenCalled()
    setFlags({ dev: true })
    await flow.requestCode()
    expect(log).toHaveBeenCalledWith('OTP request error:', expect.any(Error))
  })
})

describe('resend cooldown', () => {
  it('counts down every second and stops at 0', async () => {
    vi.useFakeTimers()
    const { flow } = await flowAtCodeStep()
    expect(flow.resendCooldown.value).toBe(20)
    vi.advanceTimersByTime(1000)
    expect(flow.resendCooldown.value).toBe(19)
    vi.advanceTimersByTime(18_000)
    expect(flow.resendCooldown.value).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(flow.resendCooldown.value).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(flow.resendCooldown.value).toBe(0)
  })

  it('restarts from 20 on a resend, with a single timer', async () => {
    vi.useFakeTimers()
    const { flow } = await flowAtCodeStep()
    vi.advanceTimersByTime(8000)
    expect(flow.resendCooldown.value).toBe(12)

    await flow.resendCode()
    expect(flow.resendCooldown.value).toBe(20)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(flow.resendCooldown.value).toBe(19)
  })

  it('stops the timer when the page goes away', async () => {
    vi.useFakeTimers()
    const { unmount } = await flowAtCodeStep()
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('resendCode', () => {
  it('does nothing without a session', async () => {
    const { flow } = await mountFlow()
    await flow.resendCode()
    expect(zitadel.resendOtpLogin).not.toHaveBeenCalled()
  })

  it('does nothing when the session token is missing', async () => {
    const { flow } = await mountFlow()
    flow.otpSessionId.value = 's-1'
    await flow.resendCode()
    expect(zitadel.resendOtpLogin).not.toHaveBeenCalled()
  })

  it('asks for a new code for the same session', async () => {
    const { flow } = await flowAtCodeStep()
    flow.errorMessage.value = 'old error'
    await flow.resendCode()
    expect(zitadel.resendOtpLogin).toHaveBeenCalledExactlyOnceWith('s-1', 'tok-1')
    expect(flow.errorMessage.value).toBe('')
    expect(flow.loading.value).toBe(false)
  })

  it.each([
    [httpError(429), 'login.tooManyRequests'],
    [httpError(500), 'login.requestFailed'],
    [undefined, 'login.requestFailed'],
  ])('maps a failure (%s) to %s and keeps the cooldown at 0', async (error, message) => {
    const { flow } = await flowAtCodeStep()
    flow.resendCooldown.value = 0
    zitadel.resendOtpLogin.mockRejectedValue(error)
    await flow.resendCode()
    expect(flow.errorMessage.value).toBe(message)
    expect(flow.loading.value).toBe(false)
    expect(flow.resendCooldown.value).toBe(0)
  })
})

describe('backToEmail', () => {
  it('goes back to the email step and forgets the session, the codes and the message', async () => {
    const { flow } = await flowAtCodeStep()
    flow.totpCode.value = '654321'
    flow.errorMessage.value = 'oops'
    flow.backToEmail()
    expect(flow.step.value).toBe('email')
    expect(flow.code.value).toBe('')
    expect(flow.totpCode.value).toBe('')
    expect(flow.errorMessage.value).toBe('')
    expect(flow.otpSessionId.value).toBe('')
    expect(flow.otpSessionToken.value).toBe('')
    // The typed email stays.
    expect(flow.email.value).toBe('chef@example.com')
  })
})

describe('verifyCode: the last step on the web', () => {
  it('checks the code against the session, then finalizes with the new session and sends the browser to the callback', async () => {
    const { flow } = await flowAtCodeStep()

    await flow.verifyCode()

    expect(zitadel.verifyOtpLogin).toHaveBeenCalledExactlyOnceWith('s-1', 'tok-1', '123456')
    expect(flow.otpSessionId.value).toBe('s-2')
    expect(flow.otpSessionToken.value).toBe('tok-2')
    expect(zitadel.finalizeOidcAuth).toHaveBeenCalledExactlyOnceWith('auth-req-1', 's-2', 'tok-2')
    expect(location.href).toBe('https://zitadel.test/callback?code=abc&state=xyz')
    expect(flow.errorMessage.value).toBe('')
  })

  it('asks for the authenticator code when the account has one, without finalizing yet', async () => {
    zitadel.verifyOtpLogin.mockResolvedValue({
      sessionId: 's-2',
      sessionToken: 'tok-2',
      requiresTotp: true,
    })
    const { flow } = await flowAtCodeStep()

    await flow.verifyCode()

    expect(flow.step.value).toBe('totp')
    expect(flow.loading.value).toBe(false)
    expect(flow.errorMessage.value).toBe('')
    expect(zitadel.finalizeOidcAuth).not.toHaveBeenCalled()
    expect(location.href).toBe('')
  })

  it('without any authRequestId, starts a plain OIDC sign-in with the email as hint', async () => {
    route.query = {}
    oidc.getAuthRequestId.mockRejectedValue(new Error('offline'))
    const { flow } = await mountFlow()
    flow.email.value = 'chef@example.com'
    await flow.requestCode()
    flow.code.value = '123456'

    await flow.verifyCode()

    expect(zitadel.finalizeOidcAuth).not.toHaveBeenCalled()
    expect(oidc.signIn).toHaveBeenCalledExactlyOnceWith({ login_hint: 'chef@example.com' })
  })

  it('goes back to the TOTP step when the backend answers 403 mfa_required', async () => {
    zitadel.finalizeOidcAuth.mockRejectedValue(httpError(403, 'mfa_required'))
    const { flow } = await flowAtCodeStep()

    await flow.verifyCode()

    expect(flow.step.value).toBe('totp')
    expect(flow.errorMessage.value).toBe('')
    expect(flow.loading.value).toBe(false)
  })

  it('does not take another 403 for a missing TOTP step', async () => {
    zitadel.finalizeOidcAuth.mockRejectedValue(httpError(403, 'forbidden'))
    const { flow } = await flowAtCodeStep()
    await flow.verifyCode()
    expect(flow.step.value).toBe('code')
    expect(flow.errorMessage.value).toBe('login.invalidCode')
  })

  it.each([
    ['a wrong code (401)', httpError(401), 'login.invalidCode'],
    ['a rate limit (429)', httpError(429), 'login.tooManyRequests'],
    ['a server error', httpError(500), 'login.invalidCode'],
    ['a network error', new TypeError('Failed to fetch'), 'login.invalidCode'],
  ])('maps %s to %s and stays on the code step', async (_name, error, message) => {
    zitadel.verifyOtpLogin.mockRejectedValue(error)
    const { flow } = await flowAtCodeStep()

    await flow.verifyCode()

    expect(flow.errorMessage.value).toBe(message)
    expect(flow.step.value).toBe('code')
    expect(flow.loading.value).toBe(false)
    expect(zitadel.finalizeOidcAuth).not.toHaveBeenCalled()
  })

  it('does not refresh the authRequestId on the web after a failure', async () => {
    zitadel.verifyOtpLogin.mockRejectedValue(httpError(401))
    const { flow } = await flowAtCodeStep()
    await flow.verifyCode()
    expect(oidc.getAuthRequestId).not.toHaveBeenCalled()
  })

  it('can be retried after a failure (the in-flight flag is released)', async () => {
    zitadel.verifyOtpLogin.mockRejectedValueOnce(httpError(401))
    const { flow } = await flowAtCodeStep()
    await flow.verifyCode()
    await flow.verifyCode()
    expect(zitadel.verifyOtpLogin).toHaveBeenCalledTimes(2)
    expect(location.href).toContain('https://zitadel.test/callback')
  })

  it('verifies once when submitted twice at once', async () => {
    const pending = deferred<{ sessionId: string; sessionToken: string }>()
    zitadel.verifyOtpLogin.mockReturnValue(pending.promise)
    const { flow } = await flowAtCodeStep()

    const first = flow.verifyCode()
    const second = flow.verifyCode()
    pending.resolve({ sessionId: 's-2', sessionToken: 'tok-2' })
    await Promise.all([first, second])

    expect(zitadel.verifyOtpLogin).toHaveBeenCalledTimes(1)
    expect(zitadel.finalizeOidcAuth).toHaveBeenCalledTimes(1)
  })

  it('does nothing while another call (loading) is running', async () => {
    const { flow } = await flowAtCodeStep()
    flow.loading.value = true
    await flow.verifyCode()
    expect(zitadel.verifyOtpLogin).not.toHaveBeenCalled()
  })

  it('logs the failure in development only', async () => {
    zitadel.verifyOtpLogin.mockRejectedValue(httpError(401))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { flow } = await flowAtCodeStep()
    await flow.verifyCode()
    expect(log).not.toHaveBeenCalled()
    setFlags({ dev: true })
    await flow.verifyCode()
    expect(log).toHaveBeenCalledWith('OTP verify error:', expect.any(Error))
  })
})

describe('verifyCode: without an authRequestID from Zitadel', () => {
  it('after a session expiry (?session=expired) it finishes through the fetched authRequestId', async () => {
    route.query = { session: 'expired' }
    oidc.getAuthRequestId.mockResolvedValue('fetched-req')
    const { flow } = await mountFlow()
    await settle()
    flow.email.value = 'chef@example.com'
    await flow.requestCode()
    flow.code.value = '123456'

    await flow.verifyCode()

    expect(zitadel.finalizeOidcAuth).toHaveBeenCalledExactlyOnceWith('fetched-req', 's-2', 'tok-2')
    expect(location.href).toBe('https://zitadel.test/callback?code=abc&state=xyz')
    expect(oidc.signIn).not.toHaveBeenCalled()
  })
})

describe('verifyTotp', () => {
  const flowAtTotpStep = async () => {
    zitadel.verifyOtpLogin.mockResolvedValue({
      sessionId: 's-2',
      sessionToken: 'tok-2',
      requiresTotp: true,
    })
    const mounted = await flowAtCodeStep()
    await mounted.flow.verifyCode()
    mounted.flow.totpCode.value = '654321'
    return mounted
  }

  it('adds the TOTP check to the session, then finalizes with the session it returns', async () => {
    const { flow } = await flowAtTotpStep()

    await flow.verifyTotp()

    expect(zitadel.verifyTotpLogin).toHaveBeenCalledExactlyOnceWith('s-2', 'tok-2', '654321')
    expect(flow.otpSessionToken.value).toBe('tok-3')
    expect(zitadel.finalizeOidcAuth).toHaveBeenCalledExactlyOnceWith('auth-req-1', 's-3', 'tok-3')
    expect(location.href).toBe('https://zitadel.test/callback?code=abc&state=xyz')
    expect(flow.errorMessage.value).toBe('')
  })

  it.each([
    ['a wrong code', httpError(401), 'login.invalidTotp'],
    ['a rate limit', httpError(429), 'login.tooManyRequests'],
    ['a server error', httpError(500), 'login.invalidTotp'],
  ])('maps %s to %s and clears the typed code', async (_name, error, message) => {
    const { flow } = await flowAtTotpStep()
    zitadel.verifyTotpLogin.mockRejectedValue(error)

    await flow.verifyTotp()

    expect(flow.errorMessage.value).toBe(message)
    expect(flow.totpCode.value).toBe('')
    expect(flow.step.value).toBe('totp')
    expect(flow.loading.value).toBe(false)
    expect(zitadel.finalizeOidcAuth).not.toHaveBeenCalled()
  })

  it('can be retried after a failure (the in-flight flag is released)', async () => {
    const { flow } = await flowAtTotpStep()
    zitadel.verifyTotpLogin.mockRejectedValueOnce(httpError(401))
    await flow.verifyTotp()
    flow.totpCode.value = '111111'
    await flow.verifyTotp()
    expect(zitadel.verifyTotpLogin).toHaveBeenCalledTimes(2)
    expect(location.href).toContain('https://zitadel.test/callback')
  })

  it('verifies once when submitted twice at once', async () => {
    const { flow } = await flowAtTotpStep()
    const pending = deferred<{ sessionId: string; sessionToken: string }>()
    zitadel.verifyTotpLogin.mockReturnValue(pending.promise)

    const first = flow.verifyTotp()
    const second = flow.verifyTotp()
    pending.resolve({ sessionId: 's-3', sessionToken: 'tok-3' })
    await Promise.all([first, second])

    expect(zitadel.verifyTotpLogin).toHaveBeenCalledTimes(1)
  })

  it('does not run while the code check is still in flight (one guard for both steps)', async () => {
    const pending = deferred<{ sessionId: string; sessionToken: string }>()
    zitadel.verifyOtpLogin.mockReturnValue(pending.promise)
    const { flow } = await flowAtCodeStep()

    const verifying = flow.verifyCode()
    await flow.verifyTotp()
    expect(zitadel.verifyTotpLogin).not.toHaveBeenCalled()
    pending.resolve({ sessionId: 's-2', sessionToken: 'tok-2' })
    await verifying
  })

  it('does nothing while another call (loading) is running', async () => {
    const { flow } = await flowAtTotpStep()
    flow.loading.value = true
    await flow.verifyTotp()
    expect(zitadel.verifyTotpLogin).not.toHaveBeenCalled()
  })

  it('logs the failure in development only', async () => {
    const { flow } = await flowAtTotpStep()
    zitadel.verifyTotpLogin.mockRejectedValue(httpError(401))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await flow.verifyTotp()
    expect(log).not.toHaveBeenCalled()
    setFlags({ dev: true })
    await flow.verifyTotp()
    expect(log).toHaveBeenCalledWith('TOTP verify error:', expect.any(Error))
  })
})
