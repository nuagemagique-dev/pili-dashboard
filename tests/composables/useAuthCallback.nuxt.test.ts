// useAuthCallback: the steps after a successful login (the callback page): load the signed-in
// user, let only admins in, remember them, go to the orders board. The GraphQL transport, the OIDC client and
// navigation are the boundaries; the auth store (real Pinia) and the localised path are real.
// Run: `vp test run tests/composables/useAuthCallback.nuxt.test.ts`.
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { useLocalePath } from '#imports'
import { useAuthStore } from '~/stores/auth'
import { makeUser } from '../fixtures/dashboard'

const oidc = vi.hoisted(() => ({ getAccessToken: vi.fn<() => Promise<string | null>>() }))
const gqlFetch = vi.hoisted(() => vi.fn())
const navigateTo = vi.hoisted(() => vi.fn())

vi.mock('~/composables/useOidc', () => ({ useOidc: () => oidc }))
mockNuxtImport('navigateTo', () => navigateTo)
mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})

const { useAuthCallback } = await import('~/composables/useAuthCallback')

beforeEach(() => {
  sessionStorage.clear()
  vi.resetAllMocks()
  setActivePinia(createPinia())
  oidc.getAccessToken.mockResolvedValue('token-1')
})

describe('processCallback', () => {
  it('stores the admin, goes to the orders board and reports success', async () => {
    const admin = makeUser({ isAdmin: true })
    gqlFetch.mockResolvedValue({ me: admin })

    const result = await useAuthCallback().processCallback()

    expect(result).toEqual({ ok: true })
    expect(useAuthStore().user).toEqual(admin)
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith(useLocalePath()('orders'))
    expect(useLocalePath()('orders')).toMatch(/\/orders$/u)
  })

  it('goes back to the page the session ended on instead of the orders board', async () => {
    gqlFetch.mockResolvedValue({ me: makeUser({ isAdmin: true }) })
    sessionStorage.setItem('oidc_return_to', '/fr/products?category=sushi')

    await expect(useAuthCallback().processCallback()).resolves.toEqual({ ok: true })

    expect(navigateTo).toHaveBeenCalledExactlyOnceWith('/fr/products?category=sushi')
    expect(sessionStorage.getItem('oidc_return_to')).toBeNull()
  })

  it('ignores a remembered page that is not a safe path', async () => {
    gqlFetch.mockResolvedValue({ me: makeUser({ isAdmin: true }) })
    sessionStorage.setItem('oidc_return_to', 'https://evil.example/orders')

    await useAuthCallback().processCallback()

    expect(navigateTo).toHaveBeenCalledExactlyOnceWith(useLocalePath()('orders'))
  })

  it('forgets the remembered page when the user is not an admin, so it does not leak into the next login', async () => {
    gqlFetch.mockResolvedValue({ me: makeUser({ isAdmin: false }) })
    sessionStorage.setItem('oidc_return_to', '/fr/products')

    await expect(useAuthCallback().processCallback()).resolves.toEqual({
      ok: false,
      reason: 'not_admin',
    })

    expect(navigateTo).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('oidc_return_to')).toBeNull()
  })

  it('keeps the remembered page when the me query fails, so that the retry still lands there', async () => {
    sessionStorage.setItem('oidc_return_to', '/fr/products')
    gqlFetch.mockRejectedValueOnce(new Error('Failed to fetch'))
    await expect(useAuthCallback().processCallback()).rejects.toThrow('Failed to fetch')
    expect(sessionStorage.getItem('oidc_return_to')).toBe('/fr/products')

    gqlFetch.mockResolvedValueOnce({ me: makeUser({ isAdmin: true }) })
    await expect(useAuthCallback().processCallback()).resolves.toEqual({ ok: true })
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith('/fr/products')
  })

  it('keeps the remembered page when me answers without a user', async () => {
    sessionStorage.setItem('oidc_return_to', '/fr/products')
    gqlFetch.mockResolvedValue({ me: null })
    await expect(useAuthCallback().processCallback()).resolves.toEqual({ ok: false })
    expect(sessionStorage.getItem('oidc_return_to')).toBe('/fr/products')
  })

  it('loads the access token BEFORE asking the API who is signed in', async () => {
    gqlFetch.mockResolvedValue({ me: makeUser() })
    await useAuthCallback().processCallback()
    expect(oidc.getAccessToken.mock.invocationCallOrder[0]).toBeLessThan(
      gqlFetch.mock.invocationCallOrder[0]!,
    )
  })

  it('asks for the profile fields the dashboard needs, including the admin flag', async () => {
    gqlFetch.mockResolvedValue({ me: makeUser() })
    await useAuthCallback().processCallback()
    const [query] = gqlFetch.mock.calls[0]!
    expect(query).toEqual(expect.stringContaining('me {'))
    for (const field of [
      'id',
      'email',
      'firstName',
      'lastName',
      'phoneNumber',
      'isAdmin',
      'address',
    ]) {
      expect(query).toMatch(new RegExp(`\\b${field}\\b`, 'u'))
    }
  })

  it('refuses a non-admin: forgets any stored user, does not navigate, says why', async () => {
    useAuthStore().setUser(makeUser({ id: 'previous' }))
    gqlFetch.mockResolvedValue({ me: makeUser({ isAdmin: false }) })

    const result = await useAuthCallback().processCallback()

    expect(result).toEqual({ ok: false, reason: 'not_admin' })
    expect(useAuthStore().user).toBeNull()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it.each([
    ['me is null', { me: null }],
    ['the response is empty', null],
    ['the response is undefined', undefined],
  ])('fails without a reason when %s, leaving the store untouched', async (_label, response) => {
    const existing = makeUser({ id: 'existing' })
    useAuthStore().setUser(existing)
    gqlFetch.mockResolvedValue(response)

    const result = await useAuthCallback().processCallback()

    expect(result).toEqual({ ok: false })
    expect(useAuthStore().user).toEqual(existing)
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('surfaces an API failure to the caller, storing and navigating nothing', async () => {
    gqlFetch.mockRejectedValue(new Error('network down'))
    await expect(useAuthCallback().processCallback()).rejects.toThrow('network down')
    expect(useAuthStore().user).toBeNull()
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('surfaces a token failure before any API call', async () => {
    oidc.getAccessToken.mockRejectedValue(new Error('storage unavailable'))
    await expect(useAuthCallback().processCallback()).rejects.toThrow('storage unavailable')
    expect(gqlFetch).not.toHaveBeenCalled()
  })
})
