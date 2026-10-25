// useOidc: the OIDC (Authorization Code + PKCE) client of the dashboard on top of oidc-client-ts, on the web
// (UserManager keeps the session). Covers sign in/out, the callbacks, the access token and the silent renewal whose single
// in-flight promise protects Zitadel's rotating refresh token.
// oidc-client-ts's UserManager (which talks to Zitadel) and $fetch are the boundaries, replaced by a fake.
// Run: `vp test run tests/composables/useOidc.nuxt.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useRuntimeConfig } from '#imports'
import { ErrorResponse, fakeUserManagers } from '../helpers/fakeOidc'
import { isSilentRenewUnavailable } from '~/utils/silentRenewError'
import type { useOidc as useOidcType } from '~/composables/useOidc'

/** Zitadel's token endpoint refusing the refresh token (expired, revoked or already rotated). */
const refused = () => new ErrorResponse({ error: 'invalid_grant' })

interface FakeUser {
  access_token: string
  refresh_token?: string
  expired: boolean
}

const $fetchMock = vi.hoisted(() => vi.fn())

vi.mock('oidc-client-ts', async () => (await import('../helpers/fakeOidc')).oidcClientTsFake())
mockNuxtImport('$fetch', () => $fetchMock)

const NOW_MS = Date.UTC(2026, 9, 4, 12, 0, 0)

const user = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expired: false,
  ...overrides,
})

/** A fresh copy of the module (its user manager, token cache and in-flight renewal are module state). */
async function load() {
  vi.resetModules()
  const { useOidc } = await import('~/composables/useOidc')
  const oidc = useOidc()
  const manager = () => {
    const [created] = fakeUserManagers()
    if (!created) throw new Error('no user manager was created')
    return created
  }
  return { useOidc, oidc, manager }
}

const goTo = (path: string) => {
  window.history.replaceState({}, '', path)
}

beforeEach(() => {
  vi.resetAllMocks()
  fakeUserManagers().length = 0
  localStorage.clear()
  goTo('/fr/orders')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW_MS)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the user manager (web)', () => {
  it('is configured for Zitadel with the code flow, offline access and no background renewal', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    const { options } = manager()
    const config = useRuntimeConfig().public
    expect(options).toMatchObject({
      authority: config.zitadelAuthority,
      client_id: config.zitadelClientId,
      redirect_uri: `${config.dashboardBaseUrl}/fr/auth/callback`,
      post_logout_redirect_uri: `${config.dashboardBaseUrl}/fr`,
      response_type: 'code',
      automaticSilentRenew: false,
    })
    expect(String(options.scope).split(' ')).toEqual([
      'openid',
      'profile',
      'email',
      'offline_access',
      'urn:zitadel:iam:org:project:roles',
    ])
    // Tokens and the login state survive closing the browser: both stores are localStorage.
    expect(options.userStore).toMatchObject({ options: { store: localStorage } })
    expect(options.stateStore).toMatchObject({ options: { store: localStorage } })
  })

  it('returns to the callback page in the language of the page the staff member is on', async () => {
    goTo('/nl/orders')
    const { oidc, manager } = await load()
    await oidc.signIn()
    expect(manager().options.redirect_uri).toMatch(/\/nl\/auth\/callback$/u)
    expect(manager().options.post_logout_redirect_uri).toMatch(/\/nl$/u)
  })

  it('defaults to French on a path without a language', async () => {
    goTo('/')
    const { oidc, manager } = await load()
    await oidc.signIn()
    expect(manager().options.redirect_uri).toMatch(/\/fr\/auth\/callback$/u)
  })

  it('defaults to French where there is no window', async () => {
    const { oidc, manager } = await load()
    vi.stubGlobal('window', undefined)
    await oidc.signIn()
    vi.unstubAllGlobals()
    expect(manager().options.redirect_uri).toMatch(/\/fr\/auth\/callback$/u)
  })

  it('ignores trailing slashes of the configured base URL', async () => {
    const config = useRuntimeConfig().public
    const original = config.dashboardBaseUrl
    config.dashboardBaseUrl = 'https://dash.example///'
    try {
      const { oidc, manager } = await load()
      await oidc.signIn()
      expect(manager().options.redirect_uri).toBe('https://dash.example/fr/auth/callback')
      expect(manager().options.post_logout_redirect_uri).toBe('https://dash.example/fr')
    } finally {
      config.dashboardBaseUrl = original
    }
  })

  // NOTE: the manager is a singleton built on first use, so its redirect_uri keeps the language of the page where that
  // happened: switching language afterwards still comes back from Zitadel on the first language's callback page.
  it('NOTE: is built once; the language of the first page sticks to its redirect URI', async () => {
    goTo('/nl/orders')
    const { oidc, manager } = await load()
    await oidc.signIn()
    goTo('/en/orders')
    await oidc.signIn()
    expect(fakeUserManagers()).toHaveLength(1)
    expect(manager().options.redirect_uri).toMatch(/\/nl\/auth\/callback$/u)
  })

  it('is shared by every useOidc() call of the page', async () => {
    const { useOidc, oidc } = await load()
    await oidc.signIn()
    await useOidc().signIn()
    expect(fakeUserManagers()).toHaveLength(1)
  })
})

describe('the manager events', () => {
  it('publishes the loaded user, and clears it when the user is unloaded', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    expect(oidc.oidcUser.value).toBeNull()

    const loaded = user()
    manager().listeners.loaded?.(loaded)
    expect(oidc.oidcUser.value).toEqual(loaded)

    manager().listeners.unloaded?.()
    expect(oidc.oidcUser.value).toBeNull()
  })

  it('renews silently when the access token expires', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    const renewed = user({ access_token: 'access-2' })
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockResolvedValue(renewed)

    await manager().listeners.expired?.()

    expect(manager().signinSilent).toHaveBeenCalledOnce()
    expect(oidc.oidcUser.value).toEqual(renewed)
  })

  it('keeps the session when the access token expires while Zitadel cannot be reached', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(manager().listeners.expired?.()).resolves.toBeUndefined()

    expect(manager().removeUser).not.toHaveBeenCalled()
  })

  it('does not swallow an unexpected failure of the renewal when the access token expires', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockRejectedValue(new Error('storage unreadable'))
    await expect(manager().listeners.expired?.()).rejects.toThrow('storage unreadable')
  })

  it('has no silent-renew-error handler: a lost refresh-token race must not wipe a session another caller renewed', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    expect(manager().events.addSilentRenewError).not.toHaveBeenCalled()
  })
})

describe('signIn', () => {
  it('starts the authorize redirect, without extra parameters by default', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    expect(manager().signinRedirect).toHaveBeenCalledExactlyOnceWith({
      extraQueryParams: undefined,
    })
  })

  it('passes extra query parameters (e.g. a login hint) to the authorize URL', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn({ login_hint: 'chef@example.com' })
    expect(manager().signinRedirect).toHaveBeenCalledExactlyOnceWith({
      extraQueryParams: { login_hint: 'chef@example.com' },
    })
  })

  it('surfaces a failure of the redirect', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().signinRedirect.mockRejectedValue(new Error('metadata unreachable'))
    await expect(oidc.signIn()).rejects.toThrow('metadata unreachable')
  })
})

describe('getAuthRequestId (in-app login)', () => {
  it('turns the authorize URL into a Zitadel auth request id through the backend proxy', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager()._client.createSigninRequest.mockResolvedValue({
      url: 'https://auth.test/authorize?x=1',
    })
    $fetchMock.mockResolvedValue({ authRequestId: 'V2_123' })

    await expect(oidc.getAuthRequestId()).resolves.toBe('V2_123')

    expect(manager()._client.createSigninRequest).toHaveBeenCalledExactlyOnceWith({})
    expect($fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${useRuntimeConfig().public.api}/auth/authorize-proxy`,
      { method: 'POST', body: { authorizeUrl: 'https://auth.test/authorize?x=1' } },
    )
  })

  it('fails when the proxy did not find a request id', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager()._client.createSigninRequest.mockResolvedValue({ url: 'https://auth.test/authorize' })
    $fetchMock.mockResolvedValue({})
    await expect(oidc.getAuthRequestId()).rejects.toThrow(
      'Failed to obtain authRequestID from Zitadel',
    )
  })

  it('fails when the manager has no signin client', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager()._client = {} as never
    await expect(oidc.getAuthRequestId()).rejects.toThrow('oidc-client-ts has no signin client')
    expect($fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a proxy failure', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager()._client.createSigninRequest.mockResolvedValue({ url: 'https://auth.test/authorize' })
    $fetchMock.mockRejectedValue(new Error('502'))
    await expect(oidc.getAuthRequestId()).rejects.toThrow('502')
  })
})

describe('the callback', () => {
  it('handleCallback completes the redirect login and publishes the user', async () => {
    const { oidc, manager } = await load()
    const signedIn = user()
    await oidc.signIn()
    manager().signinRedirectCallback.mockResolvedValue(signedIn)

    await expect(oidc.handleCallback()).resolves.toBe(signedIn)

    expect(manager().signinRedirectCallback).toHaveBeenCalledExactlyOnceWith()
    expect(oidc.oidcUser.value).toEqual(signedIn)
  })

  it('surface a rejected callback and publish no user', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().signinRedirectCallback.mockRejectedValue(new Error('No matching state found'))
    await expect(oidc.handleCallback()).rejects.toThrow('No matching state found')
    expect(oidc.oidcUser.value).toBeNull()
  })
})

describe('getAccessToken (web)', () => {
  it('returns the token of a valid session', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ access_token: 'access-7' }))
    await expect(oidc.getAccessToken()).resolves.toBe('access-7')
    expect(manager().signinSilent).not.toHaveBeenCalled()
  })

  it('is null without a session, and does not try to renew one that does not exist', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(null)
    await expect(oidc.getAccessToken()).resolves.toBeNull()
    expect(manager().signinSilent).not.toHaveBeenCalled()
  })

  it('renews an expired session and returns the fresh token', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ access_token: 'old', expired: true }))
    manager().signinSilent.mockResolvedValue(user({ access_token: 'access-8' }))
    await expect(oidc.getAccessToken()).resolves.toBe('access-8')
  })

  it('is null when the renewal is refused (the session is over)', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockRejectedValue(refused())
    await expect(oidc.getAccessToken()).resolves.toBeNull()
    expect(manager().removeUser).toHaveBeenCalledOnce()
  })

  it('is null for this request, and keeps the session, when Zitadel cannot be reached (offline)', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(oidc.getAccessToken()).resolves.toBeNull()
    expect(manager().removeUser).not.toHaveBeenCalled()
  })

  it('does not hide an unexpected failure of the renewal', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValueOnce(user({ expired: true }))
    manager().getUser.mockRejectedValueOnce(new Error('storage unreadable'))
    await expect(oidc.getAccessToken()).rejects.toThrow('storage unreadable')
  })
})

describe('silentRenew (web)', () => {
  it('renews with the refresh token and publishes the new user', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    const renewed = user({ access_token: 'access-2' })
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockResolvedValue(renewed)

    await expect(oidc.silentRenew()).resolves.toBe(renewed)
    expect(oidc.oidcUser.value).toEqual(renewed)
  })

  it('does nothing without a session', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(null)
    await expect(oidc.silentRenew()).resolves.toBeNull()
    expect(manager().signinSilent).not.toHaveBeenCalled()
  })

  it('wipes the stale session when Zitadel refuses, so nothing keeps retrying', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockRejectedValue(refused())
    manager().listeners.loaded?.(user())

    await expect(oidc.silentRenew()).resolves.toBeNull()

    expect(manager().removeUser).toHaveBeenCalledOnce()
    expect(oidc.oidcUser.value).toBeNull()
  })

  it.each([
    ['no network', new TypeError('Failed to fetch')],
    ['a timeout', Object.assign(new Error('Network timed out'), { name: 'ErrorTimeout' })],
    ['a request timeout', new Error('Request Timeout (408)')],
    ['a rate limit', new Error('Too Many Requests (429)')],
    ['a server error', new Error('Bad Gateway (502)')],
    ['Zitadel answering server_error', new ErrorResponse({ error: 'server_error' })],
    [
      'Zitadel answering temporarily_unavailable',
      new ErrorResponse({ error: 'temporarily_unavailable' }),
    ],
  ])(
    'keeps the session and rejects as "unavailable" when Zitadel cannot be reached (%s)',
    async (_name, failure) => {
      const { oidc, manager } = await load()
      await oidc.signIn()
      manager().getUser.mockResolvedValue(user({ expired: true }))
      manager().signinSilent.mockRejectedValue(failure)
      manager().listeners.loaded?.(user())

      const outcome = await oidc.silentRenew().catch((err: unknown) => err)

      expect(isSilentRenewUnavailable(outcome)).toBe(true)
      expect((outcome as Error).cause).toBe(failure)
      expect(manager().removeUser).not.toHaveBeenCalled()
      expect(oidc.oidcUser.value).not.toBeNull()
    },
  )

  // oidc-client-ts throws plain Errors for many definitive failures: keeping the session on them would leave the
  // staff member "signed in" for ever with every request failing, and every request re-hitting Zitadel.
  it.each([
    ['a 4xx with a non-OAuth body', new Error('Unauthorized (401)')],
    ['a 403 of a proxy', new Error('Forbidden (403): <html>blocked</html>')],
    [
      'a user without refresh token reaching the iframe path',
      new Error('No silent_redirect_uri configured'),
    ],
    [
      'an invalid Content-Type',
      new Error('Invalid response Content-Type: text/html; charset=utf-8, from URL: x'),
    ],
    ['an id_token validation error', new Error('sub in id_token does not match current sub')],
    ['something that is not an Error', 'boom'],
  ])('ends the session on %s', async (_name, failure) => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockRejectedValue(failure)
    manager().listeners.loaded?.(user())

    await expect(oidc.silentRenew()).resolves.toBeNull()

    expect(manager().removeUser).toHaveBeenCalledOnce()
    expect(oidc.oidcUser.value).toBeNull()
  })

  it('treats any failure as transient while the browser reports being offline', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockRejectedValue(new Error('Unauthorized (401)'))
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    await expect(oidc.silentRenew()).rejects.toSatisfy(isSilentRenewUnavailable)
    expect(manager().removeUser).not.toHaveBeenCalled()
  })

  it('ends the session at once when the stored user has no refresh token (no call to Zitadel)', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ expired: true, refresh_token: undefined }))
    await expect(oidc.silentRenew()).resolves.toBeNull()
    expect(manager().signinSilent).not.toHaveBeenCalled()
    expect(manager().removeUser).toHaveBeenCalledOnce()
  })

  it.each(['invalid_grant', 'login_required', 'invalid_client'])(
    'ends the session when Zitadel answers %s',
    async (error) => {
      const { oidc, manager } = await load()
      await oidc.signIn()
      manager().getUser.mockResolvedValue(user({ expired: true }))
      manager().signinSilent.mockRejectedValue(new ErrorResponse({ error }))
      await expect(oidc.silentRenew()).resolves.toBeNull()
      expect(manager().removeUser).toHaveBeenCalledOnce()
    },
  )

  it('still reports the end of the session when the cleanup itself fails', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockRejectedValue(refused())
    manager().removeUser.mockRejectedValue(new Error('storage full'))
    manager().listeners.loaded?.(user())

    await expect(oidc.silentRenew()).resolves.toBeNull()
    expect(oidc.oidcUser.value).toBeNull()
  })

  it('shares ONE renewal between concurrent callers (Zitadel rotates the refresh token on first use)', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    const renewed = user({ access_token: 'access-2' })
    let finish: (value: FakeUser) => void = () => {}
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockReturnValue(
      new Promise<FakeUser>((resolve) => {
        finish = resolve
      }),
    )

    const first = oidc.silentRenew()
    const second = oidc.silentRenew()
    const event = manager().listeners.expired?.()
    expect(second).toBe(first)

    finish(renewed)
    await expect(first).resolves.toBe(renewed)
    await event
    expect(manager().signinSilent).toHaveBeenCalledOnce()
  })

  it('shares the renewal across separate useOidc() instances', async () => {
    const { useOidc, oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockResolvedValue(user())
    const first = oidc.silentRenew()
    const second = useOidc().silentRenew()
    expect(second).toBe(first)
    await first
    expect(manager().signinSilent).toHaveBeenCalledOnce()
  })

  it('allows a new renewal once the previous one has finished (also after a failure)', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    manager().signinSilent.mockResolvedValueOnce(user({ access_token: 'access-3' }))

    await expect(oidc.silentRenew()).rejects.toSatisfy(isSilentRenewUnavailable)
    window.dispatchEvent(new Event('online')) // the cooldown after a failure is over once the browser is online
    await expect(oidc.silentRenew()).resolves.toMatchObject({ access_token: 'access-3' })
    expect(manager().signinSilent).toHaveBeenCalledTimes(2)
  })
})

// After a transient failure nothing calls Zitadel / the backend for 30 s, or until the browser is online: N requests, the
// assistant page's 2 s poll must not hammer a service that is down.
describe('the cooldown after a transient failure of the renewal', () => {
  const COOLDOWN_MS = 30_000

  const failWeb = async () => {
    const loaded = await load()
    await loaded.oidc.signIn()
    loaded.manager().getUser.mockResolvedValue(user({ expired: true }))
    loaded.manager().signinSilent.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(loaded.oidc.silentRenew()).rejects.toSatisfy(isSilentRenewUnavailable)
    return loaded
  }

  it('rejects at once, without a call, while it lasts (web), with the original failure as cause', async () => {
    const { oidc, manager } = await failWeb()
    expect(manager().signinSilent).toHaveBeenCalledOnce()

    vi.setSystemTime(NOW_MS + COOLDOWN_MS - 1)
    const outcome = await oidc.silentRenew().catch((err: unknown) => err)

    expect(isSilentRenewUnavailable(outcome)).toBe(true)
    expect((outcome as Error).cause).toBeInstanceOf(TypeError)
    await expect(oidc.getAccessToken()).resolves.toBeNull()
    expect(manager().signinSilent).toHaveBeenCalledOnce()
    expect(manager().removeUser).not.toHaveBeenCalled()
  })

  it('tries again once the cooldown is over, and a new failure starts a new window', async () => {
    const { oidc, manager } = await failWeb()
    vi.setSystemTime(NOW_MS + COOLDOWN_MS)
    await expect(oidc.silentRenew()).rejects.toSatisfy(isSilentRenewUnavailable)
    expect(manager().signinSilent).toHaveBeenCalledTimes(2)

    await expect(oidc.silentRenew()).rejects.toSatisfy(isSilentRenewUnavailable)
    expect(manager().signinSilent).toHaveBeenCalledTimes(2)
  })

  it('ends when the browser comes back online', async () => {
    const { oidc, manager } = await failWeb()
    manager().signinSilent.mockResolvedValue(user({ access_token: 'access-2' }))

    window.dispatchEvent(new Event('online'))

    await expect(oidc.silentRenew()).resolves.toMatchObject({ access_token: 'access-2' })
  })

  it('does not apply to a session without refresh token: it is wiped, cooldown or not', async () => {
    const { oidc, manager } = await failWeb()
    manager().getUser.mockResolvedValue(user({ expired: true, refresh_token: undefined }))
    await expect(oidc.silentRenew()).resolves.toBeNull()
    expect(manager().removeUser).toHaveBeenCalledOnce()
  })

  it('does not follow a definitive refusal: a refused session is wiped, nothing is blocked', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(user({ expired: true }))
    manager().signinSilent.mockRejectedValueOnce(refused())
    await expect(oidc.silentRenew()).resolves.toBeNull()

    manager().signinSilent.mockResolvedValueOnce(user({ access_token: 'access-9' }))
    await expect(oidc.silentRenew()).resolves.toMatchObject({ access_token: 'access-9' })
  })
})

// The live-updates WebSocket asks it when it has no token: "the session is kept, Zitadel is down" (keep retrying) versus
// "the session is over" (stop).
describe('isRenewalUnavailable', () => {
  const failWeb = async () => {
    const loaded = await load()
    await loaded.oidc.signIn()
    loaded.manager().getUser.mockResolvedValue(user({ expired: true }))
    loaded.manager().signinSilent.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(loaded.oidc.silentRenew()).rejects.toSatisfy(isSilentRenewUnavailable)
    return loaded
  }

  it('is false before anything went wrong', async () => {
    const { oidc } = await load()
    expect(oidc.isRenewalUnavailable()).toBe(false)
  })

  it('is true after a transient failure, also once the cooldown or an online event is over', async () => {
    const { oidc } = await failWeb()
    expect(oidc.isRenewalUnavailable()).toBe(true)
    window.dispatchEvent(new Event('online'))
    vi.setSystemTime(NOW_MS + 60_000)
    expect(oidc.isRenewalUnavailable()).toBe(true)
  })

  it('is true while the cooldown rejects requests, and false once a renewal succeeds', async () => {
    const { oidc, manager } = await failWeb()
    await expect(oidc.getAccessToken()).resolves.toBeNull()
    expect(oidc.isRenewalUnavailable()).toBe(true)

    window.dispatchEvent(new Event('online'))
    manager().signinSilent.mockResolvedValue(user({ access_token: 'access-2' }))
    await oidc.silentRenew()
    expect(oidc.isRenewalUnavailable()).toBe(false)
  })

  it('is false when the session ended (refused), so that the live updates stop', async () => {
    const { oidc, manager } = await failWeb()
    window.dispatchEvent(new Event('online'))
    manager().signinSilent.mockRejectedValue(refused())
    await expect(oidc.silentRenew()).resolves.toBeNull()
    expect(oidc.isRenewalUnavailable()).toBe(false)
  })

  it.each([
    ['signing out', (o: ReturnType<typeof useOidcType>) => o.signOut()],
    ['removing the user', (o: ReturnType<typeof useOidcType>) => o.removeUser()],
  ])('is false after %s', async (_name, end) => {
    const { oidc } = await failWeb()
    await end(oidc)
    expect(oidc.isRenewalUnavailable()).toBe(false)
  })

  it('is false after a new sign-in (handleCallback), and the cooldown of the old session does not apply', async () => {
    const { oidc, manager } = await failWeb()
    manager().signinRedirectCallback.mockResolvedValue(user())
    await oidc.handleCallback()
    expect(oidc.isRenewalUnavailable()).toBe(false)
    manager().signinSilent.mockResolvedValue(user({ access_token: 'access-2' }))
    await expect(oidc.silentRenew()).resolves.toMatchObject({ access_token: 'access-2' })
  })
})

describe('signOut', () => {
  it('redirects to the OIDC end-session endpoint', async () => {
    const { oidc, manager } = await load()
    await oidc.signOut()
    expect(manager().signoutRedirect).toHaveBeenCalledOnce()
  })
})

describe('isAuthenticated', () => {
  it('web: true for a live session, false for none or an expired one', async () => {
    const { oidc, manager } = await load()
    await oidc.signIn()
    manager().getUser.mockResolvedValueOnce(user())
    await expect(oidc.isAuthenticated()).resolves.toBe(true)
    manager().getUser.mockResolvedValueOnce(user({ expired: true }))
    await expect(oidc.isAuthenticated()).resolves.toBe(false)
    manager().getUser.mockResolvedValueOnce(null)
    await expect(oidc.isAuthenticated()).resolves.toBe(false)
  })
})

describe('getUser and removeUser', () => {
  it('getUser answers with the manager’s user', async () => {
    const { oidc, manager } = await load()
    const current = user()
    await oidc.signIn()
    manager().getUser.mockResolvedValue(current)
    await expect(oidc.getUser()).resolves.toBe(current)
  })

  it('removeUser clears the stored OIDC session', async () => {
    const { oidc, manager } = await load()
    await oidc.removeUser()
    expect(manager().removeUser).toHaveBeenCalledOnce()
  })
})
