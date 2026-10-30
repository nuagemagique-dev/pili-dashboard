// pages/hubrise.vue: the connection, the feature switches, the options form, the outbox and the OAuth return, driven by
// the HubRise status the API serves. The GraphQL transport is the boundary (a fake HubRise API); the page, its
// composables and the shared status are real. The logic itself is tested in tests/utils/hubrise.test.ts.
// Run: `vp test run tests/pages/hubrise.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { clearNuxtState, useRouter } from '#imports'
import { gqlFailure, makeOutboxItem, makeStatus } from '../fixtures/hubrise'
import { hubriseApi } from '../helpers/hubriseApi'
import { settle } from '../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())
const toastAdd = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())
const mobile = vi.hoisted(() => ({ value: true }))

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
mockNuxtImport('useIsMobile', () => () => ref(mobile.value))
mockNuxtImport('useToast', () => () => ({ add: toastAdd }))
mockNuxtImport('navigateTo', () => navigate)
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

const api = hubriseApi(gqlFetch)

// Compiled once at load: the first mount would otherwise eat the test timeout.
const Page = (await import('~/pages/hubrise.vue')).default

const mountPage = async (route = '/fr/hubrise') => {
  const wrapper = await mountSuspended(Page, { route })
  await settle()
  await settle()
  return wrapper
}

const buttonByText = (wrapper: Awaited<ReturnType<typeof mountPage>>, text: string) =>
  wrapper.findAll('button').find((b) => b.text() === text)

const firstToast = () => toastAdd.mock.calls[0]![0]

beforeEach(() => {
  vi.resetAllMocks()
  mobile.value = true
  clearNuxtState('pili-hubrise-status')
  api.install()
  api.clear()
  api.answer('HubriseStatus', { hubriseStatus: makeStatus() })
  api.answer('HubriseOutbox', { hubriseOutbox: [] })
})

describe('what the page shows before the status', () => {
  it('says HubRise is not configured on this server', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ available: false }) })
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="hubrise-unavailable"]').text()).toBe('hubrise.notAvailable')
    expect(wrapper.text()).not.toContain('hubrise.connection.title')
  })

  it('says the status could not be loaded', async () => {
    api.answer('HubriseStatus', api.failWith(gqlFailure('FORBIDDEN')))
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('hubrise.loadFailed')
  })

  it('shows the desktop title outside the phone layout', async () => {
    mobile.value = false
    const wrapper = await mountPage()
    expect(wrapper.find('h1').text()).toBe('hubrise.title')
  })
})

describe('connection', () => {
  it('offers to connect a shop that is not connected, and sends the browser to HubRise', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ connected: false, enabled: false }) })
    api.answer('StartHubriseConnection', {
      startHubriseConnection: 'https://manager.hubrise.com/oauth2/v1/authorize?x=1',
    })
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('hubrise.connection.notConnected')
    expect(wrapper.text()).not.toContain('hubrise.features.title')
    await buttonByText(wrapper, 'hubrise.connection.connect')!.trigger('click')
    await settle()
    expect(navigate).toHaveBeenCalledWith('https://manager.hubrise.com/oauth2/v1/authorize?x=1', {
      external: true,
    })
  })

  it('tells why connecting failed', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ connected: false }) })
    api.answer('StartHubriseConnection', api.failWith(gqlFailure('HUBRISE_NOT_CONFIGURED')))
    const wrapper = await mountPage()
    await buttonByText(wrapper, 'hubrise.connection.connect')!.trigger('click')
    await settle()
    expect(firstToast()).toEqual({ title: 'hubrise.errors.notConfigured', color: 'error' })
  })

  it('lists the names and the ids of the account, location, catalog and customer list', async () => {
    const wrapper = await mountPage()
    const ids = wrapper.find('[data-testid="hubrise-ids"]').text()
    for (const text of ['Tokyo Sushi', 'acc1', 'Liege', 'loc1', 'Menu', 'cat1', 'Clients', 'cl1']) {
      expect(ids).toContain(text)
    }
  })

  it('shows dashes for what HubRise did not give', async () => {
    api.answer('HubriseStatus', {
      hubriseStatus: makeStatus({
        customerListId: null,
        customerListName: null,
        lastEventAt: '2026-10-24T10:00:00Z',
        lastCatalogSyncAt: '2026-10-24T11:00:00Z',
        lastError: 'HubRise answered 500',
      }),
    })
    const wrapper = await mountPage()
    const ids = wrapper.find('[data-testid="hubrise-ids"]').text()
    expect(ids).toContain('-')
    expect(wrapper.text()).toContain('HubRise answered 500')
  })

  it('disconnects after a confirmation, keeping or forgetting the links', async () => {
    api.answer('DisconnectHubrise', (variables: Record<string, unknown>) => ({
      disconnectHubrise: makeStatus({
        connected: false,
        enabled: false,
        relinkRequired: false,
        ...variables,
      }),
    }))
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="hubrise-disconnect"]').exists()).toBe(false)
    await buttonByText(wrapper, 'hubrise.connection.disconnect')!.trigger('click')
    expect(wrapper.find('[data-testid="hubrise-disconnect"]').exists()).toBe(true)
    await buttonByText(wrapper, 'hubrise.connection.disconnectConfirm')!.trigger('click')
    await settle()
    expect(api.calls('DisconnectHubrise')).toEqual([{ forgetLinks: false }])
    expect(firstToast()).toEqual({ title: 'hubrise.connection.disconnected', color: 'success' })
    expect(wrapper.text()).toContain('hubrise.connection.notConnected')
  })

  it('forgets the links with the disconnect when asked to', async () => {
    api.answer('DisconnectHubrise', { disconnectHubrise: makeStatus({ connected: false }) })
    const wrapper = await mountPage()
    await buttonByText(wrapper, 'hubrise.connection.disconnect')!.trigger('click')
    const box = wrapper.find('[data-testid="hubrise-disconnect"] button[role="checkbox"]')
    await box.trigger('click')
    await buttonByText(wrapper, 'hubrise.connection.disconnectConfirm')!.trigger('click')
    await settle()
    expect(api.calls('DisconnectHubrise')).toEqual([{ forgetLinks: true }])
  })

  it('cancels the disconnect', async () => {
    const wrapper = await mountPage()
    await buttonByText(wrapper, 'hubrise.connection.disconnect')!.trigger('click')
    await buttonByText(wrapper, 'common.cancel')!.trigger('click')
    expect(wrapper.find('[data-testid="hubrise-disconnect"]').exists()).toBe(false)
    expect(api.calls('DisconnectHubrise')).toEqual([])
  })

  it('tells why a disconnect failed and stays on the confirmation', async () => {
    api.answer('DisconnectHubrise', api.failWith(gqlFailure('HUBRISE_UPSTREAM', { status: 502 })))
    const wrapper = await mountPage()
    await buttonByText(wrapper, 'hubrise.connection.disconnect')!.trigger('click')
    await buttonByText(wrapper, 'hubrise.connection.disconnectConfirm')!.trigger('click')
    await settle()
    expect(firstToast()).toEqual({ title: 'hubrise.errors.upstream{"status":502}', color: 'error' })
    expect(wrapper.find('[data-testid="hubrise-disconnect"]').exists()).toBe(true)
  })
})

describe('banners', () => {
  it('shows the refused token and reconnects from it', async () => {
    api.answer('HubriseStatus', {
      hubriseStatus: makeStatus({ authErrorAt: '2026-10-24T10:00:00Z' }),
    })
    api.answer('StartHubriseConnection', {
      startHubriseConnection: 'https://manager.hubrise.com/a',
    })
    const wrapper = await mountPage()
    const banner = wrapper.find('[data-banner="authError"]')
    expect(banner.exists()).toBe(true)
    await banner.find('button').trigger('click')
    await settle()
    expect(navigate).toHaveBeenCalledWith('https://manager.hubrise.com/a', { external: true })
  })

  it('forgets the links from the relink banner', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ relinkRequired: true }) })
    api.answer('ForgetHubriseLinks', { forgetHubriseLinks: 7 })
    const wrapper = await mountPage()
    await wrapper.find('[data-banner="relinkRequired"] button').trigger('click')
    await settle()
    expect(firstToast()).toEqual({
      title: 'hubrise.connection.linksForgotten{"count":7}',
      color: 'success',
    })
  })

  it('tells when forgetting the links failed', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ relinkRequired: true }) })
    api.answer('ForgetHubriseLinks', api.failWith(gqlFailure('HUBRISE_BUSY')))
    const wrapper = await mountPage()
    await wrapper.find('[data-banner="relinkRequired"] button').trigger('click')
    await settle()
    expect(firstToast()).toEqual({ title: 'hubrise.errors.busy', color: 'error' })
  })

  it('opens the catalog section from the pending review banner', async () => {
    api.answer('HubriseStatus', {
      hubriseStatus: makeStatus({ catalogDirection: 'IMPORT', catalogPendingReview: true }),
    })
    const wrapper = await mountPage()
    await wrapper.find('[data-banner="pendingReview"] button').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="hubrise-import"]').isVisible()).toBe(true)
  })

  it('opens the catalog section from the update available banner', async () => {
    api.answer('HubriseStatus', {
      hubriseStatus: makeStatus({ catalogDirection: 'IMPORT', catalogUpdateAvailable: true }),
    })
    const wrapper = await mountPage()
    await wrapper.find('[data-banner="updateAvailable"] button').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="hubrise-import"]').isVisible()).toBe(true)
  })

  it('shows the publish banners inside the publish panel, not twice', async () => {
    api.answer('HubriseStatus', {
      hubriseStatus: makeStatus({
        catalogDirection: 'PUBLISH',
        publish: { externalChangeAt: '2026-10-24T09:00:00Z' },
      }),
    })
    const wrapper = await mountPage()
    expect(wrapper.findAll('[data-banner="externalChange"]')).toHaveLength(1)
    expect(
      wrapper.find('[data-testid="hubrise-publish"] [data-banner="externalChange"]').exists(),
    ).toBe(true)
  })
})

describe('features', () => {
  it('lists the switches in rollout order with their hints', async () => {
    const wrapper = await mountPage()
    const ids = wrapper.findAll('[data-toggle]').map((el) => el.attributes('data-toggle'))
    expect(ids).toEqual([
      'pushOrders',
      'syncStatus',
      'syncCustomers',
      'syncInventory',
      'autoRefundOnCancel',
    ])
    expect(wrapper.text()).toContain('hubrise.hints.pushOrders')
  })

  it('switches a feature on and shares the status that comes back', async () => {
    api.answer('UpdateHubriseSettings', (variables: Record<string, unknown>) => ({
      updateHubriseSettings: makeStatus({
        features: { pushOrders: true },
        ...(variables.input as object),
      }),
    }))
    const wrapper = await mountPage()
    await wrapper.find('[data-toggle="pushOrders"] button[role="switch"]').trigger('click')
    await settle()
    expect(api.calls('UpdateHubriseSettings')).toEqual([{ input: { pushOrders: true } }])
  })

  it('pauses and resumes the integration', async () => {
    api.answer('UpdateHubriseSettings', { updateHubriseSettings: makeStatus({ enabled: false }) })
    const wrapper = await mountPage()
    await wrapper
      .find('button[role="switch"][aria-label="hubrise.features.enabled"]')
      .trigger('click')
    await settle()
    expect(api.calls('UpdateHubriseSettings')).toEqual([{ input: { enabled: false } }])
    expect(wrapper.text()).toContain('hubrise.features.pausedHint')
    expect(
      wrapper.find('[data-toggle="pushOrders"] button[role="switch"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('tells why a switch was refused', async () => {
    api.answer('UpdateHubriseSettings', api.failWith(gqlFailure('HUBRISE_RELINK_REQUIRED')))
    const wrapper = await mountPage()
    await wrapper.find('[data-toggle="syncStatus"] button[role="switch"]').trigger('click')
    await settle()
    expect(firstToast()).toEqual({ title: 'hubrise.errors.relinkRequired', color: 'error' })
  })

  it('explains the relink block under the enabled switch', async () => {
    api.answer('HubriseStatus', {
      hubriseStatus: makeStatus({ enabled: false, relinkRequired: true }),
    })
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('hubrise.features.enabledRelink')
  })

  it('syncs the inventory now', async () => {
    api.answer('HubriseStatus', {
      hubriseStatus: makeStatus({ features: { syncInventory: true } }),
    })
    api.answer('SyncHubriseInventory', { syncHubriseInventory: 5 })
    const wrapper = await mountPage()
    await buttonByText(wrapper, 'hubrise.features.syncInventoryNow')!.trigger('click')
    await settle()
    expect(firstToast()).toEqual({
      title: 'hubrise.features.inventorySynced{"count":5}',
      color: 'success',
    })
  })

  it('tells when the inventory sync failed', async () => {
    api.answer('HubriseStatus', {
      hubriseStatus: makeStatus({ features: { syncInventory: true } }),
    })
    api.answer('SyncHubriseInventory', api.failWith(gqlFailure('HUBRISE_NOT_ENABLED')))
    const wrapper = await mountPage()
    await buttonByText(wrapper, 'hubrise.features.syncInventoryNow')!.trigger('click')
    await settle()
    expect(firstToast().color).toBe('error')
  })

  it('links to the products without a SKU', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ unlinkedProducts: 3 }) })
    const wrapper = await mountPage()
    const link = wrapper.find('a[href$="/products"]')
    expect(link.text()).toContain('hubrise.features.unlinked{"count":3}')
  })

  it('shows the switches of the import mode and of the publish mode', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ catalogDirection: 'IMPORT' }) })
    let wrapper = await mountPage()
    expect(wrapper.find('[data-toggle="catalogAutoImport"]').exists()).toBe(true)
    clearNuxtState('pili-hubrise-status')
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ catalogDirection: 'PUBLISH' }) })
    wrapper = await mountPage()
    expect(wrapper.find('[data-toggle="catalogAutoImport"]').exists()).toBe(false)
  })
})

describe('options', () => {
  it('saves only what changed', async () => {
    api.answer('UpdateHubriseSettings', {
      updateHubriseSettings: makeStatus({ channelName: 'web' }),
    })
    const wrapper = await mountPage()
    expect(buttonByText(wrapper, 'common.save')).toBeUndefined()
    const vm = wrapper.vm as unknown as { form: Record<string, string> }
    vm.form.channelName = 'web'
    await settle()
    await buttonByText(wrapper, 'common.save')!.trigger('click')
    await settle()
    expect(api.calls('UpdateHubriseSettings')).toEqual([{ input: { channelName: 'web' } }])
    expect(buttonByText(wrapper, 'common.save')).toBeUndefined()
  })

  it('keeps what the admin typed when the status refreshes, and follows the server for the rest', async () => {
    const wrapper = await mountPage()
    const vm = wrapper.vm as unknown as { form: Record<string, string> }
    vm.form.channelName = 'draft'
    api.answer('HubriseStatus', {
      hubriseStatus: makeStatus({ catalogLanguage: 'nl', variantRef: 'big' }),
    })
    const { status } = await import('../../composables/useHubriseStatus').then((m) => ({
      status: m.useHubriseStatusState().status,
    }))
    status.value = makeStatus({ catalogLanguage: 'nl', variantRef: 'big' })
    await settle()
    expect(vm.form.channelName).toBe('draft')
    expect(vm.form.catalogLanguage).toBe('nl')
    expect(vm.form.variantRef).toBe('big')
  })
})

describe('platform prices', () => {
  const uber = { variantRef: 'uber', name: 'Uber Eats', markupPercent: 30, roundToCents: 10 }
  const publishing = (platformPrices: (typeof uber)[]) =>
    makeStatus({ catalogDirection: 'PUBLISH', platformPrices })
  const section = async (wrapper: Awaited<ReturnType<typeof mountPage>>) => {
    const vm = wrapper.vm as unknown as { openSections: Record<string, boolean> }
    vm.openSections.catalog = true
    await settle()
    return wrapper.find('[data-testid="hubrise-platform-prices"]')
  }

  it('is only offered while the dashboard owns the menu', async () => {
    const wrapper = await mountPage()
    expect((await section(wrapper)).exists()).toBe(false)
  })

  it('adds a platform and saves the whole list', async () => {
    api.answer('HubriseStatus', { hubriseStatus: publishing([]) })
    api.answer('UpdateHubriseSettings', { updateHubriseSettings: publishing([uber]) })
    const wrapper = await mountPage()
    const prices = await section(wrapper)
    expect(prices.html()).not.toContain('common.save')
    await buttonByText(wrapper, 'hubrise.platformPrices.add')!.trigger('click')
    const inputs = prices.findAll('input')
    await inputs[0]!.setValue(' Uber Eats ')
    await inputs[1]!.setValue('uber')
    await inputs[2]!.setValue('30')
    await prices
      .findAll('button')
      .find((b) => b.text() === 'common.save')!
      .trigger('click')
    await settle()
    expect(api.calls('UpdateHubriseSettings')).toEqual([{ input: { platformPrices: [uber] } }])
  })

  it('removes a platform', async () => {
    api.answer('HubriseStatus', { hubriseStatus: publishing([uber]) })
    api.answer('UpdateHubriseSettings', { updateHubriseSettings: publishing([]) })
    const wrapper = await mountPage()
    const prices = await section(wrapper)
    expect(prices.findAll('input')[0]!.element.value).toBe('Uber Eats')
    await buttonByText(wrapper, 'hubrise.platformPrices.remove')!.trigger('click')
    await prices
      .findAll('button')
      .find((b) => b.text() === 'common.save')!
      .trigger('click')
    await settle()
    expect(api.calls('UpdateHubriseSettings')).toEqual([{ input: { platformPrices: [] } }])
  })

  it('keeps what the admin typed when the status refreshes, and follows the server otherwise', async () => {
    api.answer('HubriseStatus', { hubriseStatus: publishing([uber]) })
    const wrapper = await mountPage()
    const prices = await section(wrapper)
    const { status } = await import('../../composables/useHubriseStatus').then((m) => ({
      status: m.useHubriseStatusState().status,
    }))
    status.value = publishing([{ ...uber, markupPercent: 25 }])
    await settle()
    expect(prices.findAll('input')[2]!.element.value).toBe('25')
    await prices.findAll('input')[0]!.setValue('Draft')
    status.value = publishing([{ ...uber, markupPercent: 20 }])
    await settle()
    expect(prices.findAll('input')[0]!.element.value).toBe('Draft')
  })
})

describe('outbox', () => {
  const parked = makeOutboxItem()
  const pending = makeOutboxItem({
    id: 'ob-2',
    state: 'PENDING',
    parkedAt: null,
    lastError: null,
    orderId: null,
  })

  it('loads the parked rows when the section opens, and retries one', async () => {
    api.answer('HubriseStatus', {
      hubriseStatus: makeStatus({ backlog: { pending: 1, parked: 1 } }),
    })
    api.answer('HubriseOutbox', { hubriseOutbox: [parked] })
    api.answer('RetryHubriseOutbox', { retryHubriseOutbox: 2 })
    const wrapper = await mountPage()
    expect(api.calls('HubriseOutbox')).toEqual([])
    const vm = wrapper.vm as unknown as { openSections: Record<string, boolean> }
    vm.openSections.outbox = true
    await settle()
    expect(api.calls('HubriseOutbox')).toEqual([{ state: 'PARKED', first: 50 }])
    const list = wrapper.find('[data-testid="hubrise-outbox"]')
    expect(list.text()).toContain('hubrise.outbox.kinds.ORDER_CREATE')
    expect(list.text()).toContain('HubRise answered 422')
    expect(list.find('a').attributes('href')).toContain('/orders/o-1')
    await buttonByText(wrapper, 'hubrise.outbox.retry')!.trigger('click')
    await settle()
    expect(api.calls('RetryHubriseOutbox')).toEqual([{ id: 'ob-1' }])
    expect(firstToast()).toEqual({ title: 'hubrise.outbox.retried{"count":2}', color: 'success' })
  })

  it('retries all the parked rows', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ backlog: { parked: 2 } }) })
    api.answer('HubriseOutbox', { hubriseOutbox: [parked] })
    api.answer('RetryHubriseOutbox', { retryHubriseOutbox: 2 })
    const wrapper = await mountPage()
    await buttonByText(wrapper, 'hubrise.outbox.retryAll')!.trigger('click')
    await settle()
    expect(api.calls('RetryHubriseOutbox')).toEqual([{ id: null }])
  })

  it('switches to the pending rows, which have no retry', async () => {
    api.answer('HubriseOutbox', { hubriseOutbox: [pending] })
    const wrapper = await mountPage()
    await buttonByText(wrapper, 'hubrise.outbox.states.PENDING')!.trigger('click')
    await settle()
    expect(api.calls('HubriseOutbox')).toEqual([{ state: 'PENDING', first: 50 }])
    expect(buttonByText(wrapper, 'hubrise.outbox.retry')).toBeUndefined()
    expect(wrapper.find('[data-testid="hubrise-outbox"] a').exists()).toBe(false)
  })

  it('says the outbox is empty', async () => {
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('hubrise.outbox.empty')
  })

  it('tells when the rows cannot be loaded or retried', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ backlog: { parked: 1 } }) })
    api.answer('HubriseOutbox', api.failWith(gqlFailure('FORBIDDEN')))
    api.answer('RetryHubriseOutbox', api.failWith(gqlFailure('HUBRISE_BUSY')))
    const wrapper = await mountPage()
    await buttonByText(wrapper, 'hubrise.outbox.states.PENDING')!.trigger('click')
    await settle()
    expect(toastAdd).toHaveBeenCalledTimes(1)
    await buttonByText(wrapper, 'hubrise.outbox.retryAll')!.trigger('click')
    await settle()
    expect(toastAdd).toHaveBeenCalledTimes(2)
  })
})

describe('orders needing staff', () => {
  it('links the counter to the orders', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ attention: 2 }) })
    const wrapper = await mountPage()
    const link = wrapper.find('[data-testid="hubrise-attention"]')
    expect(link.text()).toContain('hubrise.attention{"count":2}#2')
    expect(link.attributes('href')).toContain('/orders')
  })

  it('shows no counter when nothing needs staff', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="hubrise-attention"]').exists()).toBe(false)
  })
})

describe('back from HubRise (?hubrise=<outcome>)', () => {
  it.each([
    ['connected', 'success'],
    ['relink_required', 'warning'],
    ['denied', 'warning'],
    ['invalid_state', 'error'],
    ['authorization_failed', 'error'],
    ['error', 'error'],
  ])('shows a toast for %s and cleans the address', async (outcome, color) => {
    const wrapper = await mountPage(`/fr/hubrise?hubrise=${outcome}&keep=1`)
    expect(toastAdd).toHaveBeenCalledWith({ title: `hubrise.oauth.${outcome}`, color })
    const { currentRoute } = useRouter()
    await vi.waitFor(() => {
      expect(currentRoute.value.query).toEqual({ keep: '1' })
    })
    expect(wrapper.exists()).toBe(true)
  })

  it('ignores an unknown outcome and a visit without one', async () => {
    await mountPage('/fr/hubrise?hubrise=whatever')
    await mountPage('/fr/hubrise')
    expect(toastAdd).not.toHaveBeenCalled()
  })
})
