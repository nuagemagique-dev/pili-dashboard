// Plugins: gqlFetch.ts: OIDC Bearer token authentication via Zitadel
import {
  defineNuxtPlugin,
  navigateTo,
  useCookie,
  useLocalePath,
  useRequestEvent,
  useRuntimeConfig,
} from '#imports'
import { rememberCurrentPage } from '~/utils/authReturn'
import { isSilentRenewUnavailable } from '~/utils/silentRenewError'
import { hasText, isRecord } from '~/utils/guards'

interface GqlOptions {
  variables?: Record<string, unknown>
  signal?: AbortSignal
}

interface GqlError {
  extensions?: { code?: string }
  message?: string
}

/** The body of a GraphQL answer; `data` is as typed as the caller says, like any `$fetch<T>`. */
interface GqlResponse<T> {
  data: T
  errors?: GqlError[]
}

/** Rejects with the raw GraphQL `errors` array: callers read it as such (`gqlErrorEntries`), it is not an Error. */
const rejectWith = (errors: GqlError[]): never => {
  // oxlint-disable-next-line typescript/only-throw-error -- the raw errors array is the documented rejection value
  throw errors
}

export default defineNuxtPlugin(() => {
  const cfg = useRuntimeConfig()
  const httpURL = cfg.public.graphqlHttp
  const localePath = useLocalePath()

  /** Get access token from OIDC client (client-side only: the callers only ask for it in the browser). */
  const getOidcToken = async (): Promise<string | null> => {
    const { useOidc } = await import('~/composables/useOidc')
    const { getAccessToken } = useOidc()
    return getAccessToken()
  }

  /** Typed helper: POST /graphql with Bearer token */
  const gqlFetch = async <T = unknown>(
    query: string,
    { variables = {}, signal }: GqlOptions = {},
  ): Promise<T> => {
    const body = {
      query,
      variables,
    }

    let res: GqlResponse<T>

    // 1) Try the HTTP-level fetch (and 401→refresh→retry)
    try {
      res = await doFetch<T>(body, signal)
    } catch (err: unknown) {
      if (isRecord(err) && err.status === 401) {
        const ok = await attemptRefresh()
        if (ok) {
          res = await doFetch<T>(body, signal)
        } else {
          throw err
        }
      } else {
        throw err
      }
    }

    // 2) Handle GraphQL-level errors
    const { errors } = res
    if (errors !== undefined && errors.length > 0) {
      const unauth = errors.find((e) => e.extensions?.code === 'UNAUTHENTICATED')
      if (unauth) {
        const ok = await attemptRefresh()
        if (ok) {
          res = await doFetch<T>(body, signal)
          const retryErrors = res.errors
          if (retryErrors !== undefined && retryErrors.length > 0) {
            return rejectWith(retryErrors)
          }
          return res.data
        }
      }
      return rejectWith(errors)
    }

    return res.data
  }

  /** Low-level POST that returns the raw { data, errors } */
  const doFetch = async <T>(
    body: { query: string; variables: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<GqlResponse<T>> => {
    const userLocale = useCookie('i18n_redirected').value ?? 'fr'
    return $fetch<GqlResponse<T>, string>(httpURL, {
      method: 'POST',
      body,
      credentials: 'omit',
      signal,
      headers: await buildHeaders(userLocale),
    })
  }

  /** Build the JSON headers + attach Bearer token or forward cookies for SSR */
  const buildHeaders = async (locale: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept-Language': locale,
    }
    if (import.meta.server) {
      // SSR: forward cookies if available (for Accept-Language, session context)
      const ev = useRequestEvent()
      const cook = ev?.node.req.headers.cookie
      if (hasText(cook)) headers.cookie = cook
    } else {
      // Client-side: attach OIDC Bearer token
      const token = await getOidcToken()
      if (hasText(token)) {
        headers.Authorization = `Bearer ${token}`
      }
    }
    return headers
  }

  /**
   * Attempt OIDC silent renewal (coalesced inside useOidc). `silentRenew` does not reject for a dead session: it wipes
   * it and resolves `null`, which is the usual way a session ends: the staff member is sent back to log in (as `$api`
   * does), the page they were on being kept as the return path. When Zitadel cannot be reached (offline) it rejects
   * with `SilentRenewUnavailableError` instead: the session is kept, the staff member stays where they are, this
   * request fails, and the next one renews again.
   */
  const attemptRefresh = async (): Promise<boolean> => {
    if (import.meta.server) return false
    try {
      const { useOidc } = await import('~/composables/useOidc')
      const { silentRenew } = useOidc()
      if (await silentRenew()) return true
    } catch (err: unknown) {
      if (isSilentRenewUnavailable(err)) return false
      // An unexpected failure of the renewal is treated as a dead session too.
    }
    rememberCurrentPage()
    void navigateTo(`${localePath('auth-login')}?session=expired`)
    return false
  }

  return { provide: { gqlFetch } }
})
