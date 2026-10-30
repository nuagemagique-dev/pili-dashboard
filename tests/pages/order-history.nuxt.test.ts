// pages/order-history.vue: the history lists the orders of the period; where the server has HubRise it asks for the
// HubRise state of each and badges it (push state, reason staff must look). The GraphQL transport is the boundary.
// Run: `vp test run tests/pages/order-history.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#imports'
import { makeOrderInfo, makeStatus } from '../fixtures/hubrise'
import { hubriseApi } from '../helpers/hubriseApi'
import { settle } from '../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())
const device = vi.hoisted(() => ({ mobile: false }))

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
mockNuxtImport('useIsMobile', () => () => ref(device.mobile))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

// Compiled once at load: the first mount would otherwise eat the test timeout.
const Page = (await import('~/pages/order-history.vue')).default

const api = hubriseApi(gqlFetch)

const historyOrder = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  createdAt: '2026-10-24T10:00:00Z',
  status: 'DELIVERED',
  type: 'PICKUP',
  totalPrice: '12.50',
  displayCustomerName: `Customer ${id}`,
  items: [{ quantity: 1 }],
  ...over,
})

const mountHistory = async (orders: unknown[]) => {
  api.answer('OrderHistory', {
    orderHistory: {
      summary: { totalOrders: orders.length, totalRevenue: '25.00', averageOrder: '12.50' },
      orders,
    },
  })
  const wrapper = await mountSuspended(Page)
  await settle()
  await settle()
  return wrapper
}

const historyQuery = () => api.names().includes('OrderHistory')

beforeEach(() => {
  gqlFetch.mockReset()
  api.install()
  api.clear()
  clearNuxtState('pili-hubrise-status')
  device.mobile = false
})

describe('order history: HubRise', () => {
  const sentQuery = () =>
    (gqlFetch.mock.calls.find(([query]) => (query as string).includes('orderHistory(')) ?? [
      '',
    ])[0] as string

  it('asks for nothing about HubRise where the server has none', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ available: false }) })
    await mountHistory([historyOrder('o-1')])
    expect(historyQuery()).toBe(true)
    expect(sentQuery()).not.toMatch(/hubrise/iu)
  })

  it('asks for the HubRise state when the server has HubRise', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus() })
    await mountHistory([historyOrder('o-1')])
    expect(sentQuery()).toMatch(/hubrise \{[\s\S]*needsAttention/u)
  })

  it('badges the rows of the table', async () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus() })
    const wrapper = await mountHistory([
      historyOrder('o-1', { hubrise: makeOrderInfo({ pushState: 'sent' }) }),
      historyOrder('o-2', {
        hubrise: makeOrderInfo({ pushState: 'parked', needsAttention: 'NOT_ACCEPTED' }),
      }),
      historyOrder('o-3'),
    ])
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.text()).toContain('orders.hubrise.push.sent')
    expect(rows[1]!.text()).toContain('orders.hubrise.needsAttention')
    expect(rows[2]!.find('[data-hubrise-badge]').exists()).toBe(false)
  })

  it('badges the rows of the phone list', async () => {
    device.mobile = true
    api.answer('HubriseStatus', { hubriseStatus: makeStatus() })
    const wrapper = await mountHistory([
      historyOrder('o-1', { hubrise: makeOrderInfo({ pushState: 'skipped' }) }),
    ])
    expect(wrapper.find('[data-hubrise-badge="push"]').text()).toBe('orders.hubrise.push.skipped')
  })
})
