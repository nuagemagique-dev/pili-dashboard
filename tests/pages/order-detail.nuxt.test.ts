// pages/orders/[id].vue (the phone's order page): the HubRise state of the order, the paid-order cancel banner and the
// query of an order opened by a direct link. The GraphQL transport is the boundary.
// Run: `vp test run tests/pages/order-detail.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#imports'
import { makeOrder } from '../fixtures/dashboard'
import { makeOrderInfo, makeStatus } from '../fixtures/hubrise'
import { hubriseApi } from '../helpers/hubriseApi'
import { settle } from '../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())
const current = vi.hoisted(() => ({ id: 'o-1' }))

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
// A bare mount has no /orders/:id route (and the auth middleware would redirect it): the page only reads the id.
mockNuxtImport('useRoute', () => () => ({
  params: { id: current.id },
  path: `/fr/orders/${current.id}`,
  query: {},
}))
mockNuxtImport('useIsMobile', () => () => ref(true))
mockNuxtImport('useTabBar', () => () => ({ hide: vi.fn(), show: vi.fn() }))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

// Compiled once at load: the first mount would otherwise eat the test timeout.
const Page = (await import('~/pages/orders/[id].vue')).default
const { useOrdersStore } = await import('~/stores/orders')
const { useHubriseStatusState } = await import('~/composables/useHubriseStatus')

const api = hubriseApi(gqlFetch)

const mountDetail = async (order: ReturnType<typeof makeOrder> | null) => {
  current.id = order?.id ?? 'o-direct'
  if (order) useOrdersStore().setOrders([order])
  const wrapper = await mountSuspended(Page)
  await settle()
  return wrapper
}

beforeEach(() => {
  useOrdersStore().setOrders([])
  gqlFetch.mockReset()
  api.install()
  api.clear()
  clearNuxtState('pili-hubrise-status')
  // The orders page (this page's parent) has read the status before this page starts.
  useHubriseStatusState().setStatus(makeStatus())
})

describe('order page: HubRise', () => {
  it('shows nothing for an order that never reached HubRise', async () => {
    const wrapper = await mountDetail(
      makeOrder({ id: 'o-1', status: 'PREPARING', displayCustomerName: 'Plain Customer' }),
    )
    expect(wrapper.text()).toContain('Plain Customer')
    expect(wrapper.find('[data-testid="order-hubrise"]').exists()).toBe(false)
  })

  it('shows the push state, the HubRise ids and the attention card', async () => {
    const wrapper = await mountDetail(
      makeOrder({
        id: 'o-1',
        status: 'PREPARING',
        hubrise: makeOrderInfo({ hubriseOrderId: 'HR-9', needsAttention: 'UNLINKED_ITEM' }),
      } as never),
    )
    expect(wrapper.find('[data-testid="order-hubrise-details"]').text()).toContain('HR-9')
    expect(wrapper.find('[data-testid="order-hubrise-attention"]').text()).toContain(
      'orders.hubrise.attention.unlinkedItem.title',
    )
  })

  it('puts the cancel banner first, and its button opens the usual cancel confirmation', async () => {
    const wrapper = await mountDetail(
      makeOrder({
        id: 'o-1',
        status: 'PREPARING',
        hubrise: makeOrderInfo({ needsAttention: 'REMOTE_CANCELLED_PAID' }),
      } as never),
    )
    expect(wrapper.find('[data-testid="order-hubrise-cancelled-paid"]').exists()).toBe(true)
    const button = wrapper
      .findAll('button')
      .find((b) => b.text() === 'orders.hubrise.cancelAndRefund')
    await button!.trigger('click')
    await settle()
    expect(document.body.textContent).toContain('orders.confirmCancelTitle')
  })

  it('asks for the HubRise state when it fetches an order opened by a direct link', async () => {
    gqlFetch.mockImplementation(() => Promise.resolve({ order: null }))
    await mountDetail(null)
    const orderQuery = gqlFetch.mock.calls
      .map(([query]) => query as string)
      .find((q) => q.includes('order(id'))
    expect(orderQuery).toMatch(/hubrise \{[\s\S]*needsAttention/u)
  })

  it('does not ask for it where the server has no HubRise', async () => {
    clearNuxtState('pili-hubrise-status')
    useHubriseStatusState().setStatus(makeStatus({ available: false }))
    gqlFetch.mockImplementation(() => Promise.resolve({ order: null }))
    await mountDetail(null)
    const orderQuery = gqlFetch.mock.calls
      .map(([query]) => query as string)
      .find((q) => q.includes('order(id'))
    expect(orderQuery).toBeDefined()
    expect(orderQuery).not.toMatch(/hubrise/iu)
  })

  it('adds a fetched order to the board', async () => {
    gqlFetch.mockImplementation(() =>
      Promise.resolve({
        order: makeOrder({
          id: 'o-direct',
          status: 'PENDING',
          hubrise: makeOrderInfo({ hubriseOrderId: 'HR-direct' }),
        }),
      }),
    )
    const wrapper = await mountDetail(null)
    expect(wrapper.find('[data-testid="order-hubrise-details"]').text()).toContain('HR-direct')
  })
})
