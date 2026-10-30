import {
  ErrorResponse,
  type User as OidcUser,
  UserManager,
  WebStorageStateStore,
} from 'oidc-client-ts'
import { SilentRenewUnavailableError, isSilentRenewUnavailable } from '~/utils/silentRenewError'
import { hasText, isRecord } from '~/utils/guards'
import { type Ref, ref } from 'vue'
import { useRuntimeConfig } from '#imports'

let userManager: UserManager | null = null
const oidcUser: Ref<OidcUser | null> = ref(null)

/*
 * Module-scope coalescer for silent renewal. Every caller (middleware, plugins,
 * getAccessToken, accessTokenExpired event) routes through the same in-flight
 * promise. Zitadel rotates the refresh token on first use, so two concurrent
 * renews would race and the loser would be logged out mid-session.
 */
let silentRenewPromise: Promise<RenewedSession | null> | null = null

/** What a renewal resolves with: the OIDC user. Callers read the token. */
interface RenewedSession {
  access_token: string
}

/** The part of oidc-client-ts's internal client that `getAuthRequestId` calls (not part of its public typings). */
interface SigninClient {
  createSigninRequest: (args: Record<string, never>) => Promise<{ url: string }>
}

const isSigninClient = (value: unknown): value is SigninClient =>
  isRecord(value) && typeof value.createSigninRequest === 'function'

/*
 * OAuth error codes of a token endpoint that say "try again later", not "this refresh token is no good".
 */
const TRANSIENT_OAUTH_ERRORS = new Set(['server_error', 'temporarily_unavailable'])

/** oidc-client-ts words a non-2xx answer without an OAuth body as `Error("<statusText> (<status>): <body>")`. */
const TRANSIENT_HTTP_STATUS = /\((?:408|429|5\d\d)\)/u

const isOffline = (): boolean => typeof navigator !== 'undefined' && !navigator.onLine

/*
 * Could not get an answer from Zitadel, or it said "later": the session is kept (the refresh token may well be good)
 * and the renewal is not attempted again before the cooldown below is over. ONLY these are transient: a dropped
 * connection (fetch rejects with a TypeError), oidc-client-ts's `ErrorTimeout`, HTTP 408/429/5xx, the OAuth
 * `server_error` / `temporarily_unavailable`, and any failure while the browser reports being offline. Everything else
 * is definitive, because it will fail the same way next time and keeping the session would leave the staff member
 * "signed in" for ever with every request failing: Zitadel's refusals (invalid_grant...), oidc-client-ts's validation
 * errors (sub mismatch...), "No silent_redirect_uri configured" (a user without refresh token), an invalid
 * Content-Type and a 4xx without an OAuth body (a WAF 403, a misrouted 404).
 */
const isTransient = (err: unknown): boolean => {
  if (isOffline()) return true
  if (err instanceof ErrorResponse) return TRANSIENT_OAUTH_ERRORS.has(String(err.error))
  if (err instanceof TypeError) return true
  if (!(err instanceof Error)) return false
  return err.name === 'ErrorTimeout' || TRANSIENT_HTTP_STATUS.test(err.message)
}

/*
 * Cooldown: after a transient failure no new renewal is attempted for this long. Every authenticated request renews
 * once on its token and once more on the 401 that follows, the assistant page polls every 2 s, so
 * during an outage they would hammer Zitadel and keep it from recovering. Requests fail fast with the
 * same "unavailable" error instead. Fixed 30 s (the same as tsb-core), ended early when the browser comes back online.
 */
const RENEW_COOLDOWN_MS = 30_000
let renewBlockedUntil = 0
// Why the last renewal could not be made, until a renewal succeeds or ends the session (NOT cleared by the cooldown).
let renewBlockedBy: unknown = null
let onlineListenerAdded = false

function blockRenewals(cause: unknown): SilentRenewUnavailableError {
  renewBlockedUntil = Date.now() + RENEW_COOLDOWN_MS
  renewBlockedBy = cause
  // The network is back: no reason to wait out the cooldown.
  if (!onlineListenerAdded && typeof window !== 'undefined') {
    onlineListenerAdded = true
    window.addEventListener('online', () => {
      renewBlockedUntil = 0
    })
  }
  return new SilentRenewUnavailableError({ cause })
}

/** A new session starts or the session was dropped on purpose: nothing from the previous one is held against it. */
function forgetRenewalFailure() {
  renewBlockedUntil = 0
  renewBlockedBy = null
}

function assertRenewalsAllowed() {
  if (Date.now() < renewBlockedUntil) {
    throw new SilentRenewUnavailableError({ cause: renewBlockedBy })
  }
}

/**
 * Provides OIDC Authorization Code + PKCE flow via oidc-client-ts.
 */
export function useOidc() {
  const config = useRuntimeConfig()

  function getUserManager(): UserManager {
    if (userManager) return userManager

    const localeSegment =
      typeof window === 'undefined' ? undefined : window.location.pathname.split('/')[1]
    const locale = hasText(localeSegment) ? localeSegment : 'fr'

    const baseUrl = (config.public.dashboardBaseUrl as string).replace(/\/+$/u, '')
    userManager = new UserManager({
      authority: config.public.zitadelAuthority as string,
      client_id: config.public.zitadelClientId as string,
      redirect_uri: `${baseUrl}/${locale}/auth/callback`,
      post_logout_redirect_uri: `${baseUrl}/${locale}`,
      response_type: 'code',
      scope: 'openid profile email offline_access urn:zitadel:iam:org:project:roles',
      // Off: the background renewal raced with middleware/plugin calls on the same refresh token; Zitadel's rotation logged the loser out mid-session. Renew lazily on navigation and on 401 instead.
      automaticSilentRenew: false,
      // Persist tokens across browser close; Zitadel enforces the 30-day idle / 90-day absolute refresh-token TTL.
      userStore: new WebStorageStateStore({ store: localStorage }),
      stateStore: new WebStorageStateStore({ store: localStorage }),
    })

    userManager.events.addUserLoaded((user) => {
      oidcUser.value = user
    })
    userManager.events.addUserUnloaded(() => {
      oidcUser.value = null
    })

    userManager.events.addAccessTokenExpired(async () => {
      /*
       * Route through the module-level coalescer so this event-driven
       * renewal cannot race with a concurrent silentRenew() call from
       * middleware/plugins on the same refresh token.
       */
      try {
        await silentRenew()
      } catch (err) {
        // No network right now: the session is kept, the next request renews it.
        if (!isSilentRenewUnavailable(err)) throw err
      }
    })

    /*
     * Note: addSilentRenewError intentionally has no handler. A losing race
     * (Zitadel rejected an already-rotated refresh token) would otherwise
     * call removeUser() and wipe a session another caller had just renewed.
     * Real session termination is handled by the callers checking the
     * silentRenew() return value.
     */

    return userManager
  }

  /** Start the OIDC authorize redirect. */
  async function signIn(extraParams?: Record<string, string>) {
    const mgr = getUserManager()
    await mgr.signinRedirect({ extraQueryParams: extraParams })
  }

  /**
   * Get authRequestID from Zitadel without navigating away.
   * Creates the OIDC authorize URL, sends it to the backend proxy which follows
   * the redirect and extracts the authRequestID.
   */
  async function getAuthRequestId(): Promise<string> {
    const mgr = getUserManager()
    // `_client` is internal to oidc-client-ts: read it by name and check its shape instead of casting.
    const client: unknown = Reflect.get(mgr, '_client')
    if (!isSigninClient(client)) throw new Error('oidc-client-ts has no signin client')
    const signinRequest = await client.createSigninRequest({})

    const apiUrl = config.public.api as string
    const response = await $fetch<{ authRequestId: string }>(`${apiUrl}/auth/authorize-proxy`, {
      method: 'POST',
      body: { authorizeUrl: signinRequest.url },
    })

    if (!response.authRequestId) {
      throw new Error('Failed to obtain authRequestID from Zitadel')
    }
    return response.authRequestId
  }

  /** Complete the OIDC callback: exchange the code for tokens. */
  async function handleCallback(): Promise<OidcUser> {
    const mgr = getUserManager()
    const user = await mgr.signinRedirectCallback()
    forgetRenewalFailure()
    oidcUser.value = user
    return user
  }

  /** Get the current access token (or null if not authenticated). */
  async function getAccessToken(): Promise<string | null> {
    try {
      const mgr = getUserManager()
      const user = await mgr.getUser()
      if (user && user.expired !== true) return user.access_token
      if (!user) return null // No session, nothing to renew

      /*
       * Token expired, so route through the coalesced silentRenew so concurrent
       * callers share one refresh-token use (Zitadel rotates on first use).
       */
      const renewed = await silentRenew()
      return renewed?.access_token ?? null
    } catch (err) {
      // The renewal could not be made now (offline): no token for this request, the session stays for the next one.
      if (isSilentRenewUnavailable(err)) return null
      throw err
    }
  }

  /**
   * Attempt silent token renewal. All callers (middleware, plugins, the
   * accessTokenExpired event, getAccessToken) share a single in-flight
   * promise so we never use the same refresh token twice in parallel,
   * Zitadel rotates on first use and would log the loser out.
   *
   * Resolves the renewed user, or `null` when the session is over (nothing to
   * renew, or Zitadel refused the refresh token: the stale user is wiped).
   * Rejects with `SilentRenewUnavailableError` when Zitadel could not be
   * reached (offline, timeout, 408/429/5xx): the session is NOT touched, the
   * caller keeps the staff member signed in and does not send them to the login page.
   * For 30 s after such a failure it rejects at once, without a call.
   */
  function silentRenew(): Promise<RenewedSession | null> {
    silentRenewPromise ??= doSilentRenew().finally(() => {
      silentRenewPromise = null
    })
    return silentRenewPromise
  }

  async function doSilentRenew(): Promise<RenewedSession | null> {
    const outcome = await attemptRenewal()
    // Renewed, or the session is over: whatever kept the renewal from being made is behind us.
    renewBlockedBy = null
    return outcome
  }

  /**
   * True while the session is kept but could not be renewed because Zitadel / the backend is unreachable (until a
   * renewal succeeds or ends the session). For callers that must tell "no token because the session is over" from "no
   * token right now" (the live-updates WebSocket keeps retrying in the second case only).
   */
  function isRenewalUnavailable(): boolean {
    return renewBlockedBy !== null
  }

  async function attemptRenewal(): Promise<RenewedSession | null> {
    const mgr = getUserManager()
    const existing = await mgr.getUser()
    if (!existing) return null // No session to renew
    // Without a refresh token oidc-client-ts would try a hidden iframe, which this app does not configure: no way back.
    if (!hasText(existing.refresh_token)) return endSession(mgr)
    assertRenewalsAllowed()
    try {
      const user = await mgr.signinSilent()
      oidcUser.value = user
      return user
    } catch (err) {
      if (isTransient(err)) throw blockRenewals(err)
      return endSession(mgr)
    }
  }

  /*
   * The session cannot be renewed any more: wipe the stale user so subsequent getAccessToken() calls return null
   * instead of triggering an iframe storm against Zitadel.
   */
  async function endSession(mgr: UserManager): Promise<null> {
    try {
      await mgr.removeUser()
    } catch {
      /* Best-effort cleanup */
    }
    oidcUser.value = null
    return null
  }

  /** Sign out via OIDC end-session endpoint. */
  async function signOut() {
    forgetRenewalFailure()
    const mgr = getUserManager()
    await mgr.signoutRedirect()
  }

  /** Check if the user has a valid (non-expired) session. */
  async function isAuthenticated(): Promise<boolean> {
    const mgr = getUserManager()
    const user = await mgr.getUser()
    return user !== null && user.expired !== true
  }

  /** Get the current OIDC user (from cache). */
  function getUser(): Promise<OidcUser | null> {
    const mgr = getUserManager()
    return mgr.getUser()
  }

  /** Clear stale OIDC session from storage (prevents automaticSilentRenew loops). */
  async function removeUser(): Promise<void> {
    forgetRenewalFailure()
    const mgr = getUserManager()
    await mgr.removeUser()
  }

  return {
    oidcUser,
    signIn,
    getAuthRequestId,
    handleCallback,
    getAccessToken,
    silentRenew,
    isRenewalUnavailable,
    signOut,
    isAuthenticated,
    getUser,
    removeUser,
  }
}
