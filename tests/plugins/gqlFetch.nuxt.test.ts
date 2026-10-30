// $gqlFetch (plugins/gqlFetch.ts): the one GraphQL transport of the dashboard. POST /graphql with the language and the
// OIDC Bearer token, one silent renewal + retry after a 401 or an UNAUTHENTICATED error, GraphQL errors thrown as the
// raw `errors` array. The HTTP call ($fetch), the OIDC client and navigation are the boundaries, mocked; the real
// runtime config, cookies and localised paths of the Nuxt app are used.
// Run: `vp test run tests/plugins/gqlFetch.nuxt.test.ts`.
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useRuntimeConfig } from '#imports'
import { consumeReturnTo } from '~/utils/authReturn'
import { SilentRenewUnavailableError } from '~/utils/silentRenewError'
import { setFlags } from '../support/flags'

const oidc = vi.hoisted(() => ({
  getAccessToken: vi.fn<() => Promise<string | null>>(),
  silentRenew: vi.fn<() => Promise<unknown>>(),
}))
const navigateTo = vi.hoisted(() => vi.fn())
const $fetchMock = vi.hoisted(() => vi.fn())
const useRequestEvent = vi.hoisted(() => vi.fn())
// The visitor's language cookie (read through useCookie), the boundary to the browser's cookie jar.
const languageCookie = vi.hoisted(() => ({ value: undefined as string | undefined }))

vi.mock('~/composables/useOidc', () => ({ useOidc: () => oidc }))
mockNuxtImport('navigateTo', () => navigateTo)
mockNuxtImport('$fetch', () => $fetchMock)
mockNuxtImport('useRequestEvent', () => useRequestEvent)
mockNuxtImport('useCookie', () => () => ({
  get value() {
    return languageCookie.value
  },
}))

const { default: gqlFetchPlugin } = await import('~/plugins/gqlFetch')

type GqlFetch = <T = unknown>(
  query: string | object,
  options?: { variables?: Record<string, unknown>; signal?: AbortSignal },
) => Promise<T>

const install = (): GqlFetch =>
  (gqlFetchPlugin as unknown as (app: unknown) => { provide: { gqlFetch: GqlFetch } })({}).provide
    .gqlFetch

/** What ofetch throws for an HTTP error status. */
const httpError = (status: number) =>
  Object.assign(new Error(`${status} error`), { name: 'FetchError', status })

/** The language cookie, written where useCookie reads it (document.cookie). */
const setLanguageCookie = (value: string | null) => {
  languageCookie.value = value ?? undefined
}

/** The real localised path of the app (language prefix) with the "session expired" flag. */
const LOGIN_EXPIRED = expect.stringMatching(/^\/[a-z]{2}\/auth\/login\?session=expired$/u)

const QUERY = 'query OrderList { orders { id } }'
const ok = (data: unknown) => ({ data })
const unauthenticated = () => ({
  errors: [{ message: 'not signed in', extensions: { code: 'UNAUTHENTICATED' } }],
})

beforeEach(() => {
  sessionStorage.clear()
  vi.resetAllMocks()
  oidc.getAccessToken.mockResolvedValue('token-1')
  oidc.silentRenew.mockResolvedValue({ access_token: 'token-2' })
  setLanguageCookie(null)
})

describe('the plugin', () => {
  it('provides nuxtApp.$gqlFetch', () => {
    const provided = (gqlFetchPlugin as unknown as (app: unknown) => { provide: object })({})
    expect(Object.keys(provided.provide)).toEqual(['gqlFetch'])
  })
})

describe('the request (browser)', () => {
  it('POSTs the query with its variables to the configured GraphQL endpoint and returns `data`', async () => {
    $fetchMock.mockResolvedValue(ok({ orders: [{ id: 'o1' }] }))
    const { signal } = new AbortController()

    const data = await install()<{ orders: { id: string }[] }>(QUERY, {
      variables: { first: 5 },
      signal,
    })

    expect(data).toEqual({ orders: [{ id: 'o1' }] })
    expect($fetchMock).toHaveBeenCalledExactlyOnceWith(useRuntimeConfig().public.graphqlHttp, {
      method: 'POST',
      body: { query: QUERY, variables: { first: 5 } },
      credentials: 'omit',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': 'fr',
        Authorization: 'Bearer token-1',
      },
    })
  })

  it('sends empty variables when none are given', async () => {
    $fetchMock.mockResolvedValue(ok({}))
    await install()(`
      query OrderList {
        orders {
          id
        }
      }
    `)
    const [, { body }] = $fetchMock.mock.calls[0]!
    expect(body.variables).toEqual({})
    expect(body.query).toContain('query OrderList')
  })

  it('sends no Authorization header without a session', async () => {
    oidc.getAccessToken.mockResolvedValue(null)
    $fetchMock.mockResolvedValue(ok({}))
    await install()(QUERY)
    expect($fetchMock.mock.calls[0]![1].headers).toEqual({
      'Content-Type': 'application/json',
      'Accept-Language': 'fr',
    })
  })

  it('asks for the language of the i18n cookie, French by default', async () => {
    $fetchMock.mockResolvedValue(ok({}))
    const gqlFetch = install()
    setLanguageCookie('nl')
    await gqlFetch(QUERY)
    expect($fetchMock.mock.calls[0]![1].headers['Accept-Language']).toBe('nl')
    setLanguageCookie(null)
    await gqlFetch(QUERY)
    expect($fetchMock.mock.calls[1]![1].headers['Accept-Language']).toBe('fr')
  })

  it('returns undefined data as it is', async () => {
    $fetchMock.mockResolvedValue({})
    await expect(install()(QUERY)).resolves.toBeUndefined()
  })
})

describe('HTTP errors', () => {
  it('rethrows a non-401 error untouched, without renewing', async () => {
    const error = httpError(500)
    $fetchMock.mockRejectedValue(error)
    await expect(install()(QUERY)).rejects.toBe(error)
    expect(oidc.silentRenew).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it.each([
    ['a network failure without status', new TypeError('Failed to fetch')],
    ['a thrown string', 'boom'],
    ['null', null],
  ])('rethrows %s', async (_label, error) => {
    $fetchMock.mockRejectedValue(error)
    await expect(install()(QUERY)).rejects.toBe(error)
    expect(oidc.silentRenew).not.toHaveBeenCalled()
  })

  it('on a 401 renews the session once and replays the same request with the new token', async () => {
    $fetchMock.mockRejectedValueOnce(httpError(401)).mockResolvedValueOnce(ok({ orders: [] }))
    oidc.getAccessToken.mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2')
    const { signal } = new AbortController()

    await expect(install()(QUERY, { variables: { a: 1 }, signal })).resolves.toEqual({ orders: [] })

    expect(oidc.silentRenew).toHaveBeenCalledOnce()
    expect($fetchMock).toHaveBeenCalledTimes(2)
    expect($fetchMock.mock.calls[1]![1]).toMatchObject({
      body: { query: QUERY, variables: { a: 1 } },
      signal,
      headers: { Authorization: 'Bearer token-2' },
    })
  })

  it('sends the staff member to the login page, flagged as expired, when the session is over (renewal resolves null)', async () => {
    const error = httpError(401)
    $fetchMock.mockRejectedValue(error)
    oidc.silentRenew.mockResolvedValue(null)
    await expect(install()(QUERY)).rejects.toBe(error)
    expect($fetchMock).toHaveBeenCalledOnce()
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith(LOGIN_EXPIRED)
  })

  it('remembers the page the staff member was on, to come back to after logging in again', async () => {
    window.history.replaceState({}, '', '/fr/products?category=sushi')
    $fetchMock.mockRejectedValue(httpError(401))
    oidc.silentRenew.mockResolvedValue(null)
    await expect(install()(QUERY)).rejects.toBeDefined()
    expect(consumeReturnTo()).toBe('/fr/products?category=sushi')
  })

  it('does not remember anything when the session was renewed', async () => {
    window.history.replaceState({}, '', '/fr/products')
    $fetchMock.mockRejectedValueOnce(httpError(401)).mockResolvedValueOnce(ok({ a: 1 }))
    await install()(QUERY)
    expect(consumeReturnTo()).toBeNull()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('does not remember anything when Zitadel cannot be reached', async () => {
    window.history.replaceState({}, '', '/fr/products')
    $fetchMock.mockRejectedValue(httpError(401))
    oidc.silentRenew.mockRejectedValue(new SilentRenewUnavailableError())
    await expect(install()(QUERY)).rejects.toBeDefined()
    expect(consumeReturnTo()).toBeNull()
  })

  it('does not renew twice: a 401 on the replay is thrown as it is', async () => {
    const replay = httpError(401)
    $fetchMock.mockRejectedValueOnce(httpError(401)).mockRejectedValueOnce(replay)
    await expect(install()(QUERY)).rejects.toBe(replay)
    expect(oidc.silentRenew).toHaveBeenCalledOnce()
  })

  it('keeps the session and fails only this request when Zitadel cannot be reached (no login redirect)', async () => {
    const error = httpError(401)
    $fetchMock.mockRejectedValue(error)
    oidc.silentRenew.mockRejectedValue(new SilentRenewUnavailableError())
    await expect(install()(QUERY)).rejects.toBe(error)
    expect($fetchMock).toHaveBeenCalledOnce()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('sends the staff member to the login page, flagged as expired, when renewing itself blows up', async () => {
    const error = httpError(401)
    $fetchMock.mockRejectedValue(error)
    oidc.silentRenew.mockRejectedValue(new Error('iframe blocked'))
    await expect(install()(QUERY)).rejects.toBe(error)
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith(LOGIN_EXPIRED)
  })
})

describe('GraphQL errors', () => {
  it('throws the raw errors array, so callers can read extensions.code', async () => {
    const errors = [{ message: 'forbidden', extensions: { code: 'FORBIDDEN' } }]
    $fetchMock.mockResolvedValue({ data: null, errors })
    await expect(install()(QUERY)).rejects.toBe(errors)
    expect(oidc.silentRenew).not.toHaveBeenCalled()
  })

  it('treats an empty errors array as success', async () => {
    $fetchMock.mockResolvedValue({ data: { orders: [] }, errors: [] })
    await expect(install()(QUERY)).resolves.toEqual({ orders: [] })
  })

  it('renews and replays on UNAUTHENTICATED, even when it is not the first error', async () => {
    $fetchMock.mockResolvedValueOnce({
      errors: [{ message: 'other' }, ...unauthenticated().errors],
    })
    $fetchMock.mockResolvedValueOnce(ok({ orders: [{ id: 'o1' }] }))
    oidc.getAccessToken.mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2')

    await expect(install()(QUERY)).resolves.toEqual({ orders: [{ id: 'o1' }] })

    expect(oidc.silentRenew).toHaveBeenCalledOnce()
    expect($fetchMock.mock.calls[1]![1].headers.Authorization).toBe('Bearer token-2')
  })

  it('throws the errors of the replay when it fails too', async () => {
    const replayErrors = [{ message: 'forbidden', extensions: { code: 'FORBIDDEN' } }]
    $fetchMock
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce({ errors: replayErrors })
    await expect(install()(QUERY)).rejects.toBe(replayErrors)
    expect(oidc.silentRenew).toHaveBeenCalledOnce()
  })

  it('throws the original errors and sends the staff member to the login page, flagged as expired, when the session is over (renewal resolves null)', async () => {
    window.history.replaceState({}, '', '/fr/customers')
    const first = unauthenticated()
    $fetchMock.mockResolvedValue(first)
    oidc.silentRenew.mockResolvedValue(null)
    await expect(install()(QUERY)).rejects.toBe(first.errors)
    expect($fetchMock).toHaveBeenCalledOnce()
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith(LOGIN_EXPIRED)
    expect(consumeReturnTo()).toBe('/fr/customers')
  })

  it('keeps the session and throws the original errors when Zitadel cannot be reached (no login redirect)', async () => {
    const first = unauthenticated()
    $fetchMock.mockResolvedValue(first)
    oidc.silentRenew.mockRejectedValue(new SilentRenewUnavailableError())
    await expect(install()(QUERY)).rejects.toBe(first.errors)
    expect($fetchMock).toHaveBeenCalledOnce()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('goes to the login page, flagged as expired, when renewing blows up', async () => {
    const first = unauthenticated()
    $fetchMock.mockResolvedValue(first)
    oidc.silentRenew.mockRejectedValue(new Error('iframe blocked'))
    await expect(install()(QUERY)).rejects.toBe(first.errors)
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith(LOGIN_EXPIRED)
  })

  it('does not renew for UNAUTHENTICATED-like codes that are not the exact code', async () => {
    const errors = [{ message: 'x', extensions: { code: 'unauthenticated' } }]
    $fetchMock.mockResolvedValue({ errors })
    await expect(install()(QUERY)).rejects.toBe(errors)
    expect(oidc.silentRenew).not.toHaveBeenCalled()
  })
})

describe('during SSR', () => {
  beforeEach(() => {
    setFlags({ server: true })
  })

  it("forwards the visitor's cookies and never looks for an OIDC token", async () => {
    useRequestEvent.mockReturnValue({ node: { req: { headers: { cookie: 'a=b' } } } })
    $fetchMock.mockResolvedValue(ok({}))
    await install()(QUERY)
    expect($fetchMock.mock.calls[0]![1].headers).toEqual({
      'Content-Type': 'application/json',
      'Accept-Language': 'fr',
      cookie: 'a=b',
    })
    expect(oidc.getAccessToken).not.toHaveBeenCalled()
  })

  it('sends no cookie header when the request has none, or when there is no request event', async () => {
    $fetchMock.mockResolvedValue(ok({}))
    useRequestEvent.mockReturnValue({ node: { req: { headers: {} } } })
    await install()(QUERY)
    useRequestEvent.mockReturnValue(undefined)
    await install()(QUERY)
    for (const call of $fetchMock.mock.calls) expect(call[1].headers).not.toHaveProperty('cookie')
  })

  it('cannot renew a session on the server: a 401 and UNAUTHENTICATED are thrown as they are', async () => {
    const error = httpError(401)
    $fetchMock.mockRejectedValueOnce(error)
    await expect(install()(QUERY)).rejects.toBe(error)

    const first = unauthenticated()
    $fetchMock.mockResolvedValueOnce(first)
    await expect(install()(QUERY)).rejects.toBe(first.errors)

    expect(oidc.silentRenew).not.toHaveBeenCalled()
    expect(navigateTo).not.toHaveBeenCalled()
  })
})
