// pages/orders.vue: the board still renders what the extracted order logic computes (columns, mobile cards, late banner,
// payment chips). The logic itself is tested in tests/utils/orders.test.ts; this proves the page is wired to it.
// Run: `vp test run tests/pages/orders.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { clearNuxtState } from '#imports'
import { makeOrder, makeOrderItem } from '../fixtures/dashboard'
import { makeOrderInfo, makeStatus } from '../fixtures/hubrise'
import { bodyButton, bodySelector, bodyText } from '../helpers/dom'
import { hubriseApi } from '../helpers/hubriseApi'
import { settle } from '../helpers/settle'

const gql = vi.hoisted(() => ({
  orders: [] as unknown[],
  queries: [] as string[],
  subscriptions: [] as string[],
  mobile: false,
}))
const gqlFetch = vi.hoisted(() => vi.fn())

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
mockNuxtImport('useGqlQuery', () => (query: string) => {
  gql.queries.push(query)
  return Promise.resolve({
    data: ref({ orders: gql.orders }),
    pending: ref(false),
  })
})
mockNuxtImport('useGqlSubscription', () => (query: string) => {
  gql.subscriptions.push(query)
  return { data: ref<unknown>(null) }
})
mockNuxtImport('useOrderingStatus', () => () => ({
  enabled: ref(true),
  updating: ref(false),
  setEnabled: vi.fn(),
}))
mockNuxtImport('useIsMobile', () => () => ref(gql.mobile))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

const NOW = new Date('2026-10-04T12:00:00.000Z')
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString()

const api = hubriseApi(gqlFetch)

beforeEach(() => {
  setActivePinia(createPinia())
  gqlFetch.mockReset()
  api.install()
  api.clear()
  clearNuxtState('pili-hubrise-status')
  gql.queries.length = 0
  gql.subscriptions.length = 0
  gql.mobile = false
  document.body.innerHTML = ''
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  gql.orders = [
    makeOrder({
      id: 'o-new',
      status: 'PENDING',
      displayCustomerName: 'Fresh Customer',
      createdAt: ago(3),
      items: [makeOrderItem({ totalPrice: '12.50' })],
      totalPrice: '12.50',
    }),
    makeOrder({
      id: 'o-late',
      status: 'PREPARING',
      displayCustomerName: 'Late Customer',
      createdAt: ago(200),
    }),
    makeOrder({
      id: 'o-ready',
      status: 'AWAITING_PICK_UP',
      displayCustomerName: 'Ready Customer',
      createdAt: ago(30),
    }),
  ]
})

afterEach(() => {
  vi.useRealTimers()
})

describe('orders page', () => {
  it('puts every order in its kanban column and counts the late ones', async () => {
    const Page = (await import('~/pages/orders.vue')).default
    const wrapper = await mountSuspended(Page)
    await settle()

    const column = (key: string) => wrapper.get(`[data-column-key="${key}"]`).text()
    expect(column('NEW')).toContain('Fresh Customer')
    expect(column('NEW')).toContain('12,50')
    expect(column('PREPARING')).toContain('Late Customer')
    expect(column('AWAITING_PICK_UP')).toContain('Ready Customer')
    expect(column('OUT_FOR_DELIVERY')).not.toContain('Customer')
    // The 200-minute-old active order raises the stale banner, with the count of late orders.
    const banners = wrapper.findAll('div.bg-warning.text-inverted, button.bg-warning.text-inverted')
    expect(banners.length).toBeGreaterThan(0)
    expect(banners[0]!.find('.font-mono').text()).toBe('1')
  })

  it('shows no stale banner when no active order has waited for more than 2 hours', async () => {
    gql.orders = [makeOrder({ id: 'o-1', status: 'PENDING', createdAt: ago(119) })]
    const Page = (await import('~/pages/orders.vue')).default
    const wrapper = await mountSuspended(Page)
    await settle()
    expect(
      wrapper.findAll('div.bg-warning.text-inverted, button.bg-warning.text-inverted'),
    ).toHaveLength(0)
  })

  it('shows the elapsed time of a card and the cash "to collect" chip', async () => {
    const Page = (await import('~/pages/orders.vue')).default
    const wrapper = await mountSuspended(Page)
    await settle()

    const fresh = wrapper.get('[data-column-key="NEW"]').text()
    expect(fresh).toContain('orders.timeSince.minutes')
    expect(fresh).toContain('orders.toCollect')
  })
})

describe('orders page: HubRise', () => {
  const available = () => {
    api.answer('HubriseStatus', { hubriseStatus: makeStatus() })
  }
  const ordersQuery = () => gql.queries.find((q) => q.includes('orders {')) ?? ''

  const mountBoard = async () => {
    const Page = (await import('~/pages/orders.vue')).default
    const wrapper = await mountSuspended(Page)
    await settle()
    return wrapper
  }

  it('asks for nothing about HubRise where the server has none, or an older one', async () => {
    await mountBoard() // no answer set for HubriseStatus: the read fails
    expect(ordersQuery()).toContain('orders {')
    expect(ordersQuery()).not.toMatch(/hubrise/iu)
    clearNuxtState('pili-hubrise-status')
    gql.queries.length = 0
    api.answer('HubriseStatus', { hubriseStatus: makeStatus({ available: false }) })
    await mountBoard()
    expect(ordersQuery()).not.toMatch(/hubrise/iu)
  })

  it('asks for the HubRise state in the list and the live subscriptions when HubRise is there', async () => {
    available()
    await mountBoard()
    expect(ordersQuery()).toMatch(/hubrise \{[\s\S]*needsAttention/u)
    expect(gql.subscriptions).toHaveLength(2)
    for (const subscription of gql.subscriptions) expect(subscription).toContain('hubrise {')
  })

  it('badges the cards with the push state and the reason staff must look; none for an order that never got there', async () => {
    available()
    gql.orders = [
      makeOrder({
        id: 'o-sent',
        status: 'PENDING',
        displayCustomerName: 'Sent Customer',
        hubrise: makeOrderInfo({ pushState: 'sent' }),
      } as never),
      makeOrder({
        id: 'o-stuck',
        status: 'PREPARING',
        displayCustomerName: 'Stuck Customer',
        hubrise: makeOrderInfo({ pushState: 'parked', needsAttention: 'NOT_ACCEPTED' }),
      } as never),
      makeOrder({
        id: 'o-none',
        status: 'AWAITING_PICK_UP',
        displayCustomerName: 'Plain Customer',
      }),
    ]
    const wrapper = await mountBoard()
    const column = (key: string) => wrapper.get(`[data-column-key="${key}"]`)
    expect(column('NEW').text()).toContain('orders.hubrise.push.sent')
    expect(column('PREPARING').text()).toContain('orders.hubrise.push.parked')
    expect(column('PREPARING').text()).toContain('orders.hubrise.needsAttention')
    expect(column('AWAITING_PICK_UP').find('[data-testid="kanban-hubrise"]').exists()).toBe(false)
  })

  it('badges the cards of the phone list too', async () => {
    available()
    gql.mobile = true
    gql.orders = [
      makeOrder({
        id: 'o-1',
        status: 'PENDING',
        hubrise: makeOrderInfo({ pushState: 'pending' }),
      } as never),
    ]
    const wrapper = await mountBoard()
    expect(wrapper.find('[data-hubrise-badge="push"]').text()).toBe('orders.hubrise.push.pending')
  })

  describe('the order details', () => {
    const open = async (hubrise: unknown, status = 'PREPARING') => {
      available()
      gql.orders = [
        makeOrder({
          id: 'o-1',
          status,
          displayCustomerName: 'Detail Customer',
          hubrise,
        } as never),
      ]
      const wrapper = await mountBoard()
      await wrapper
        .get('[data-column-key] .cursor-pointer, [data-column-key] [role="button"]')
        .trigger('click')
      await settle()
      return wrapper
    }

    it('shows nothing for an order that never reached HubRise', async () => {
      await open(null)
      expect(bodyText()).toContain('Detail Customer')
      expect(bodySelector('[data-testid="order-hubrise"]')).toBeNull()
    })

    it('shows the HubRise ids, status and total', async () => {
      await open(
        makeOrderInfo({ hubriseOrderId: 'HR-42', remoteStatus: 'accepted', remoteTotal: '12.50' }),
      )
      const details = bodySelector('[data-testid="order-hubrise-details"]')!.textContent
      expect(details).toContain('HR-42')
      expect(details).toContain('accepted')
      expect(details).toContain('12,50')
    })

    it('explains the attention code of the order', async () => {
      await open(makeOrderInfo({ needsAttention: 'TOTAL_MISMATCH' }))
      const card = bodySelector('[data-testid="order-hubrise-attention"]')!
      expect(card.getAttribute('data-attention')).toBe('TOTAL_MISMATCH')
      expect(card.textContent).toContain('orders.hubrise.attention.totalMismatch.title')
      expect(bodySelector('[data-testid="order-hubrise-cancelled-paid"]')).toBeNull()
    })

    it('asks staff to cancel a paid order cancelled at the EPOS, through the usual cancel confirmation', async () => {
      await open(makeOrderInfo({ needsAttention: 'REMOTE_CANCELLED_PAID' }))
      const banner = bodySelector('[data-testid="order-hubrise-cancelled-paid"]')!
      expect(banner.textContent).toContain('orders.hubrise.attention.remoteCancelledPaid.title')
      expect(bodySelector('[data-testid="order-hubrise-attention"]')).toBeNull()
      expect(bodyText()).not.toContain('orders.confirmCancelTitle')
      bodyButton('orders.hubrise.cancelAndRefund')!.click()
      await settle()
      expect(bodyText()).toContain('orders.confirmCancelTitle')
    })

    it('explains the paid cancel only as a card once the order is cancelled here too', async () => {
      await open(makeOrderInfo({ needsAttention: 'REMOTE_CANCELLED_PAID' }), 'CANCELLED')
      expect(bodySelector('[data-testid="order-hubrise-cancelled-paid"]')).toBeNull()
      expect(
        bodySelector('[data-testid="order-hubrise-attention"]')!.getAttribute('data-attention'),
      ).toBe('REMOTE_CANCELLED_PAID')
    })
  })
})
