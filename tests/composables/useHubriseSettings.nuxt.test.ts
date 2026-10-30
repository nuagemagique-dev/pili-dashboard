// useHubriseSettings: the actions of the HubRise page that are not about the menu. The GraphQL transport and Nuxt's
// navigateTo are the boundaries; the shared status (useState) is real, so the test sees it refreshed.
// Run: `vp test run tests/composables/useHubriseSettings.nuxt.test.ts`.
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#imports'
import { gqlFailure, makeOutboxItem, makeStatus } from '../fixtures/hubrise'
import { mountComposable } from '../helpers/mountComposable'
import { settle } from '../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
mockNuxtImport('navigateTo', () => navigate)

const { useHubriseSettings, OUTBOX_PAGE_SIZE } = await import('~/composables/useHubriseSettings')
const { useHubriseStatusState } = await import('~/composables/useHubriseStatus')

/** Answers each operation by its name; the status read answers `current`. */
let current = makeStatus()
const answers: Record<string, unknown> = {}
const install = () => {
  gqlFetch.mockImplementation((query: string) => {
    const name = /(?:query|mutation) (\w+)/u.exec(query)?.[1] ?? ''
    if (name === 'HubriseStatus') return Promise.resolve({ hubriseStatus: current })
    if (name in answers) return Promise.resolve(answers[name])
    return Promise.reject(new Error(`unexpected ${name}`))
  })
}

const mountSettings = async () => {
  const mounted = mountComposable(() => ({ ...useHubriseSettings(), ...useHubriseStatusState() }))
  await settle()
  gqlFetch.mockClear()
  return mounted
}

const lastCall = (name: string) =>
  gqlFetch.mock.calls.find(([query]) => (query as string).includes(name))!

beforeEach(() => {
  vi.resetAllMocks()
  clearNuxtState('pili-hubrise-status')
  current = makeStatus()
  for (const key of Object.keys(answers)) delete answers[key] // oxlint-disable-line typescript/no-dynamic-delete
  install()
})

describe('updateSettings', () => {
  it('sends the input and shares the status the server answers', async () => {
    const next = makeStatus({ enabled: false, catalogLanguage: 'zh' })
    answers.UpdateHubriseSettings = { updateHubriseSettings: next }
    const { result } = await mountSettings()
    expect(await result.updateSettings({ enabled: false, catalogLanguage: 'zh' })).toEqual(next)
    expect(result.status.value).toEqual(next)
    const [query, options] = lastCall('updateHubriseSettings')
    expect(query).toContain('HubriseSettingsInput')
    expect(options).toEqual({ variables: { input: { enabled: false, catalogLanguage: 'zh' } } })
  })

  it('shows the action running and rejects with the raw errors', async () => {
    const failure = gqlFailure('HUBRISE_DIRECTION_CONFLICT')
    gqlFetch.mockRejectedValue(failure)
    const { result } = await mountSettings()
    const pending = result.updateSettings({ syncCatalog: true })
    expect(result.busy.value).toBe('settings')
    await expect(pending).rejects.toBe(failure)
    expect(result.busy.value).toBeNull()
  })
})

describe('connect', () => {
  it('sends the browser to the HubRise authorization page', async () => {
    answers.StartHubriseConnection = {
      startHubriseConnection: 'https://manager.hubrise.com/oauth2/v1/authorize?client_id=x',
    }
    const { result } = await mountSettings()
    await result.connect()
    expect(navigate).toHaveBeenCalledWith(
      'https://manager.hubrise.com/oauth2/v1/authorize?client_id=x',
      { external: true },
    )
  })

  it('refuses an address that is not a web address', async () => {
    answers.StartHubriseConnection = { startHubriseConnection: 'file:///etc/passwd' }
    const { result } = await mountSettings()
    await expect(result.connect()).rejects.toThrow('not a web address')
    expect(navigate).not.toHaveBeenCalled()
    answers.StartHubriseConnection = { startHubriseConnection: 'not a url' }
    await expect(result.connect()).rejects.toThrow()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('also follows a plain http address (a local test HubRise)', async () => {
    answers.StartHubriseConnection = { startHubriseConnection: 'http://localhost:9000/authorize' }
    const { result } = await mountSettings()
    await result.connect()
    expect(navigate).toHaveBeenCalledWith('http://localhost:9000/authorize', { external: true })
  })
})

describe('disconnect', () => {
  it.each([true, false])(
    'disconnects (forget the links: %s) and shares the status',
    async (forget) => {
      const next = makeStatus({ connected: false, enabled: false })
      answers.DisconnectHubrise = { disconnectHubrise: next }
      const { result } = await mountSettings()
      expect(await result.disconnect(forget)).toEqual(next)
      expect(result.status.value).toEqual(next)
      expect(lastCall('disconnectHubrise')[1]).toEqual({ variables: { forgetLinks: forget } })
    },
  )
})

describe('actions that refresh the status', () => {
  it('forgets the links and reads the status again', async () => {
    answers.ForgetHubriseLinks = { forgetHubriseLinks: 12 }
    const { result } = await mountSettings()
    current = makeStatus({ relinkRequired: false, unlinkedProducts: 12 })
    expect(await result.forgetLinks()).toBe(12)
    expect(result.status.value?.unlinkedProducts).toBe(12)
  })

  it('syncs the inventory', async () => {
    answers.SyncHubriseInventory = { syncHubriseInventory: 4 }
    const { result } = await mountSettings()
    current = makeStatus({ attention: 2 })
    expect(await result.syncInventory()).toBe(4)
    expect(result.busy.value).toBeNull()
    expect(result.status.value?.attention).toBe(2)
  })

  it('links a product by hand, or unlinks it with no SKU', async () => {
    answers.LinkHubriseProduct = { linkHubriseProduct: true }
    const { result } = await mountSettings()
    expect(await result.linkProduct('p-1', 'RAMEN')).toBe(true)
    expect(lastCall('linkHubriseProduct')[1]).toEqual({
      variables: { productId: 'p-1', skuRef: 'RAMEN' },
    })
    await result.linkProduct('p-1', null)
    expect(
      gqlFetch.mock.calls.filter(([q]) => (q as string).includes('linkHubriseProduct'))[1]![1],
    ).toEqual({
      variables: { productId: 'p-1', skuRef: null },
    })
  })

  it('retries one chain or all the parked rows', async () => {
    answers.RetryHubriseOutbox = { retryHubriseOutbox: 3 }
    const { result } = await mountSettings()
    expect(await result.retryOutbox('ob-1')).toBe(3)
    expect(lastCall('retryHubriseOutbox')[1]).toEqual({ variables: { id: 'ob-1' } })
    await result.retryOutbox()
    const calls = gqlFetch.mock.calls.filter(([q]) => (q as string).includes('retryHubriseOutbox'))
    expect(calls[1]![1]).toEqual({ variables: { id: null } })
  })

  it('does not hide the failure of the action behind the refresh', async () => {
    const failure = gqlFailure('HUBRISE_NOT_ENABLED')
    gqlFetch.mockRejectedValue(failure)
    const { result } = await mountSettings()
    await expect(result.syncInventory()).rejects.toBe(failure)
    await expect(result.forgetLinks()).rejects.toBe(failure)
    await expect(result.linkProduct('p', 'x')).rejects.toBe(failure)
    await expect(result.retryOutbox()).rejects.toBe(failure)
    expect(result.busy.value).toBeNull()
  })
})

describe('outbox', () => {
  it('lists the rows, a page of them, filtered by state', async () => {
    const rows = [
      makeOutboxItem(),
      makeOutboxItem({ id: 'ob-2', state: 'PENDING', parkedAt: null }),
    ]
    answers.HubriseOutbox = { hubriseOutbox: rows }
    const { result } = await mountSettings()
    expect(await result.loadOutbox('PARKED')).toEqual(rows)
    expect(result.outbox.value).toEqual(rows)
    expect(lastCall('hubriseOutbox')[1]).toEqual({
      variables: { state: 'PARKED', first: OUTBOX_PAGE_SIZE },
    })
    await result.loadOutbox()
    const calls = gqlFetch.mock.calls.filter(([q]) => (q as string).includes('hubriseOutbox('))
    expect(calls[1]![1]).toEqual({ variables: { state: null, first: OUTBOX_PAGE_SIZE } })
  })
})
