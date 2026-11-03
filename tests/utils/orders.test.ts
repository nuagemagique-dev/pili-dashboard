// Order logic of the orders board: status machine, elapsed time and lateness, payment chips, the discount breakdown (in
// integer cents), the mobile cards and the kanban columns with their drag & drop rules.
import { describe, expect, it } from 'vite-plus/test'
import type { Order, OrderStatus, OrderType } from '~/types'
import {
  KANBAN_COLUMN_DEFS,
  LATE_AFTER_MS,
  MOBILE_TABS,
  ORDER_STATUS_CHIP_TONE,
  buildKanbanColumns,
  canDropOnColumn,
  cardMeta,
  getAllowedStatuses,
  getPaymentIconClass,
  getPaymentStatusColor,
  getStatusColor,
  getStatusIcon,
  getTimeSince,
  gqlErrorCodes,
  hasBreakdown,
  hoursSince,
  isActiveStatus,
  isLateOrder,
  isUnpaidCash,
  itemNames,
  itemsSubtotalCents,
  mobileCards,
  mobileTabOrders,
  nextActionOf,
  oldestLateOrder,
  paymentChip,
  resolveDrop,
  staleOrders,
  updateOrderErrorKey,
  statusActionLabelKey,
} from '~/utils/orders'
import { formatTimeOnly } from '~/utils/utils'
import { fakeT } from '../helpers/i18n'
import { makeAddress, makeOrder, makeOrderItem, makeProduct } from '../fixtures/dashboard'

const NOW = Date.parse('2026-10-04T12:00:00.000Z')
const MIN = 60_000
const ago = (minutes: number) => new Date(NOW - minutes * MIN).toISOString()
const column = (key: string) => KANBAN_COLUMN_DEFS.find((c) => c.key === key)!

const ALL_STATUSES: OrderStatus[] = [
  'PENDING',
  'PREPARING',
  'AWAITING_PICK_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'PICKED_UP',
  'CANCELLED',
  'FAILED',
]

describe('status machine', () => {
  it.each<[OrderStatus, OrderType, OrderStatus[]]>([
    ['PENDING', 'DELIVERY', ['PREPARING', 'CANCELLED']],
    ['PENDING', 'PICKUP', ['PREPARING', 'CANCELLED']],
    ['PREPARING', 'PICKUP', ['AWAITING_PICK_UP', 'CANCELLED']],
    ['AWAITING_PICK_UP', 'DELIVERY', ['OUT_FOR_DELIVERY', 'CANCELLED']],
    ['AWAITING_PICK_UP', 'PICKUP', ['PICKED_UP', 'FAILED', 'CANCELLED']],
    ['OUT_FOR_DELIVERY', 'DELIVERY', ['DELIVERED', 'FAILED', 'CANCELLED']],
    // NOTE (product question, left as is): a delivered / picked-up / failed order can still be cancelled.
    ['DELIVERED', 'DELIVERY', ['CANCELLED']],
    ['PICKED_UP', 'PICKUP', ['CANCELLED']],
    ['FAILED', 'DELIVERY', ['CANCELLED']],
    ['CANCELLED', 'PICKUP', []],
  ])('%s (%s) can move to %j', (status, type, allowed) => {
    expect(getAllowedStatuses(status, type)).toEqual(allowed)
  })

  it('has no forward move for a ready order of an unknown type, only the cancel', () => {
    expect(getAllowedStatuses('AWAITING_PICK_UP', 'DINE_IN' as OrderType)).toEqual(['CANCELLED'])
  })

  it('has a chip tone for every status', () => {
    for (const status of ALL_STATUSES) expect(ORDER_STATUS_CHIP_TONE[status]).toBeDefined()
    expect(ORDER_STATUS_CHIP_TONE.CANCELLED).toBe('danger')
  })

  it('treats pending and preparing as active', () => {
    expect(ALL_STATUSES.filter(isActiveStatus)).toEqual(['PENDING', 'PREPARING'])
  })

  it('labels accepting a pending order "Confirm" and any other move with its target status', () => {
    expect(statusActionLabelKey('PENDING', 'PREPARING')).toBe('orders.nextAction.preparing')
    expect(statusActionLabelKey('PREPARING', 'AWAITING_PICK_UP')).toBe(
      'orders.status.awaiting_pick_up',
    )
    expect(statusActionLabelKey('PENDING', 'CANCELLED')).toBe('orders.status.cancelled')
  })

  it('never offers the removed confirmation status anywhere in the workflow', () => {
    for (const status of ALL_STATUSES) {
      expect(getAllowedStatuses(status, 'DELIVERY')).not.toContain('CONFIRMED' as OrderStatus)
      expect(getAllowedStatuses(status, 'PICKUP')).not.toContain('CONFIRMED' as OrderStatus)
    }
  })

  it('advances to the first allowed status that is not a cancel or a failure', () => {
    expect(nextActionOf(makeOrder({ status: 'PENDING' }))).toBe('PREPARING')
    expect(nextActionOf(makeOrder({ status: 'AWAITING_PICK_UP', type: 'PICKUP' }))).toBe(
      'PICKED_UP',
    )
    expect(nextActionOf(makeOrder({ status: 'AWAITING_PICK_UP', type: 'DELIVERY' }))).toBe(
      'OUT_FOR_DELIVERY',
    )
    expect(nextActionOf(makeOrder({ status: 'DELIVERED' }))).toBeUndefined()
  })

  it('maps every status to an icon and a colour, with a neutral fallback', () => {
    expect(getStatusIcon('PENDING')).toBe('i-lucide-clock')
    expect(getStatusIcon('CANCELLED')).toBe('i-lucide-circle-x')
    expect(getStatusIcon('NOPE' as OrderStatus)).toBe('i-lucide-circle-help')
    expect(getStatusColor('PENDING')).toBe('warning')
    expect(getStatusColor('DELIVERED')).toBe('success')
    expect(getStatusColor('FAILED')).toBe('error')
    expect(getStatusColor('NOPE' as OrderStatus)).toBe('neutral')
  })
})

describe('getTimeSince', () => {
  it.each([
    [0, 'orders.timeSince.minutes{"count":0}', 'text-success', false],
    [4, 'orders.timeSince.minutes{"count":4}', 'text-success', false],
    [5, 'orders.timeSince.minutes{"count":5}', 'text-warning', false],
    [14, 'orders.timeSince.minutes{"count":14}', 'text-warning', false],
    [15, 'orders.timeSince.minutes{"count":15}', 'text-error', false],
    [59, 'orders.timeSince.minutes{"count":59}', 'text-error', false],
    [60, 'orders.timeSince.hours{"count":1}', 'text-error', false],
    [135, 'orders.timeSince.hours{"count":2}', 'text-error', false],
    [1439, 'orders.timeSince.hours{"count":23}', 'text-error', false],
    [1440, 'orders.timeSince.hours{"count":24}', 'text-error', true],
  ])('%d minutes old', (minutes, text, color, isStale) => {
    expect(getTimeSince(ago(minutes), NOW, fakeT)).toEqual({ text, color, isStale })
  })

  it('rounds down to whole minutes', () => {
    expect(getTimeSince(new Date(NOW - 4 * MIN - 59_000).toISOString(), NOW, fakeT).color).toBe(
      'text-success',
    )
  })

  it('counts a creation date in the future (clock skew) as 0 minutes', () => {
    expect(getTimeSince(ago(-10), NOW, fakeT)).toEqual({
      text: 'orders.timeSince.minutes{"count":0}',
      color: 'text-success',
      isStale: false,
    })
  })

  it('accepts a Date as well as a timestamp', () => {
    expect(getTimeSince(ago(7), new Date(NOW), fakeT).color).toBe('text-warning')
  })
})

describe('lateness', () => {
  it('is late after more than 2 hours, not at exactly 2 hours', () => {
    const at = (age: number, status: OrderStatus = 'PENDING') =>
      makeOrder({ status, createdAt: new Date(NOW - age).toISOString() })
    expect(isLateOrder(at(LATE_AFTER_MS), NOW)).toBe(false)
    expect(isLateOrder(at(LATE_AFTER_MS + 1), NOW)).toBe(true)
    expect(isLateOrder(at(LATE_AFTER_MS + 1), new Date(NOW))).toBe(true)
  })

  it('only counts active orders as late', () => {
    for (const status of ALL_STATUSES) {
      const old = makeOrder({ status, createdAt: ago(300) })
      expect(isLateOrder(old, NOW)).toBe(isActiveStatus(status))
    }
  })

  it('lists the late orders in list order and picks the one waiting longest', () => {
    const fresh = makeOrder({ id: 'fresh', createdAt: ago(10) })
    const late = makeOrder({ id: 'late', createdAt: ago(150) })
    const later = makeOrder({ id: 'later', status: 'PREPARING', createdAt: ago(400) })
    const doneOld = makeOrder({ id: 'done', status: 'DELIVERED', createdAt: ago(900) })
    const orders = [fresh, late, doneOld, later]
    expect(staleOrders(orders, NOW).map((o) => o.id)).toEqual(['late', 'later'])
    expect(oldestLateOrder(orders, NOW)?.id).toBe('later')
    expect(orders.map((o) => o.id)).toEqual(['fresh', 'late', 'done', 'later'])
  })

  it('has no oldest late order when nothing is late', () => {
    expect(oldestLateOrder([makeOrder({ createdAt: ago(5) })], NOW)).toBeNull()
    expect(oldestLateOrder([], NOW)).toBeNull()
  })

  it('counts whole hours waited', () => {
    expect(hoursSince(ago(59), NOW)).toBe(0)
    expect(hoursSince(ago(180), NOW)).toBe(3)
    expect(hoursSince(ago(239), new Date(NOW))).toBe(3)
  })
})

describe('payment', () => {
  const online = (status?: string) =>
    makeOrder({
      isOnlinePayment: true,
      payment: status ? { status } : null,
    } as Partial<Order>)
  const cash = (status?: string, orderStatus: OrderStatus = 'PENDING') =>
    makeOrder({
      isOnlinePayment: false,
      status: orderStatus,
      payment: status ? { status } : null,
    } as Partial<Order>)

  describe('isUnpaidCash', () => {
    it('is true for cash that is not paid yet', () => {
      expect(isUnpaidCash(cash())).toBe(true)
      expect(isUnpaidCash(cash('open'))).toBe(true)
    })
    it('is false once paid (any letter case), for online payments and for cancelled orders', () => {
      expect(isUnpaidCash(cash('PAID'))).toBe(false)
      expect(isUnpaidCash(online())).toBe(false)
      expect(isUnpaidCash(cash(undefined, 'CANCELLED'))).toBe(false)
    })
  })

  describe('getPaymentIconClass', () => {
    it('is red for a failed payment, online or not', () => {
      expect(getPaymentIconClass(online('failed'))).toBe('text-error')
      expect(getPaymentIconClass(cash('FAILED'))).toBe('text-error')
    })
    it('is amber for cash not yet collected', () => {
      expect(getPaymentIconClass(cash())).toBe('text-warning')
      expect(getPaymentIconClass(cash('open'))).toBe('text-warning')
    })
    it('is plain for paid cash and for online payments in any other state', () => {
      expect(getPaymentIconClass(cash('paid'))).toBe('')
      expect(getPaymentIconClass(online('paid'))).toBe('')
      expect(getPaymentIconClass(online('open'))).toBe('')
      expect(getPaymentIconClass(online())).toBe('')
    })
  })

  it('colours payment states', () => {
    expect(getPaymentStatusColor(undefined)).toBe('error')
    expect(getPaymentStatusColor('')).toBe('error')
    expect(getPaymentStatusColor('open')).toBe('warning')
    expect(getPaymentStatusColor('PAID')).toBe('success')
    expect(getPaymentStatusColor('failed')).toBe('error')
    expect(getPaymentStatusColor('canceled')).toBe('neutral')
    expect(getPaymentStatusColor('expired')).toBe('neutral')
    expect(getPaymentStatusColor('charged_back')).toBe('neutral')
  })

  describe('paymentChip', () => {
    it('shows paid online payments in green, hides paid cash unless detail is asked', () => {
      expect(paymentChip(online('paid'), fakeT)).toEqual({
        color: 'success',
        label: 'orders.payment.status.paid',
      })
      expect(paymentChip(cash('paid'), fakeT)).toBeNull()
      expect(paymentChip(cash('paid'), fakeT, true)).toEqual({
        color: 'success',
        label: 'orders.payment.status.paid',
      })
    })

    it('shows unpaid cash as "to collect" when there is no payment, or it is open or pending', () => {
      const toCollect = { color: 'warning', label: 'orders.toCollect' }
      expect(paymentChip(cash(), fakeT)).toEqual(toCollect)
      expect(paymentChip(cash('open'), fakeT)).toEqual(toCollect)
      expect(paymentChip(cash('pending'), fakeT)).toEqual(toCollect)
    })

    it('shows every other state with its own colour and label', () => {
      expect(paymentChip(online('failed'), fakeT)).toEqual({
        color: 'error',
        label: 'orders.payment.status.failed',
      })
      expect(paymentChip(online('Expired'), fakeT)).toEqual({
        color: 'neutral',
        label: 'orders.payment.status.expired',
      })
      expect(paymentChip(cash('failed'), fakeT)).toEqual({
        color: 'error',
        label: 'orders.payment.status.failed',
      })
    })

    it('shows an online order without any payment as not paid, in red', () => {
      expect(paymentChip(online(), fakeT)).toEqual({
        color: 'error',
        label: 'orders.payment.status.notPaid',
      })
      expect(paymentChip(online(), fakeT, true)).not.toBeNull()
    })
  })
})

describe('items and amounts', () => {
  it('names an item in French first and adds a Chinese name when it differs', () => {
    const item = makeOrderItem({
      product: makeProduct({
        name: 'Salmon nigiri',
        translations: [
          { language: 'zh', name: '三文鱼寿司', description: null },
          { language: 'fr', name: 'Nigiri saumon', description: null },
        ],
      }),
    })
    expect(itemNames(item)).toEqual({ main: 'Nigiri saumon', zh: '三文鱼寿司' })
  })

  it('falls back to the product name and hides a Chinese name equal to the main one', () => {
    expect(itemNames(makeOrderItem())).toEqual({ main: 'Salmon nigiri', zh: '' })
    const same = makeOrderItem({
      product: makeProduct({
        name: 'Ramen',
        translations: [{ language: 'zh', name: 'Ramen', description: null }],
      }),
    })
    expect(itemNames(same)).toEqual({ main: 'Ramen', zh: '' })
    const noTranslations = makeOrderItem({
      product: { ...makeProduct({ name: 'Cola' }), translations: undefined } as never,
    })
    expect(itemNames(noTranslations)).toEqual({ main: 'Cola', zh: '' })
  })

  it('sums the line totals in integer cents, without float drift', () => {
    const items = ['0.10', '0.20'].map((totalPrice) => makeOrderItem({ totalPrice }))
    expect(itemsSubtotalCents({ items })).toBe(30)
    // The float sum of the same strings is not exactly 0.3.
    expect(items.reduce((acc, i) => acc + parseFloat(i.totalPrice), 0)).not.toBe(0.3)
  })

  it('has a subtotal of 0 without an order, items or a readable price', () => {
    expect(itemsSubtotalCents(null)).toBe(0)
    expect(itemsSubtotalCents(undefined)).toBe(0)
    expect(itemsSubtotalCents({ items: [] })).toBe(0)
    expect(itemsSubtotalCents({ items: [makeOrderItem({ totalPrice: 'oops' })] })).toBe(0)
  })

  describe('hasBreakdown', () => {
    it.each([
      ['0.00', null, false],
      ['0.00', '0.00', false],
      ['0.00', '', false],
      ['2.50', null, true],
      ['0.00', '3.00', true],
      ['0.01', '0.00', true],
      ['n/a', 'n/a', false],
    ])('discount %s, delivery fee %s -> %s', (discountAmount, deliveryFee, expected) => {
      expect(hasBreakdown({ discountAmount, deliveryFee })).toBe(expected)
    })

    it('is false without an order', () => {
      expect(hasBreakdown(null)).toBe(false)
      expect(hasBreakdown(undefined)).toBe(false)
    })
  })
})

describe('cardMeta', () => {
  const fr = 'fr'
  const clock = (iso: string) => formatTimeOnly(iso, fr)

  it('shows the article count (plural-aware) alone for a pickup without a time', () => {
    expect(cardMeta(makeOrder({ items: [makeOrderItem(), makeOrderItem()] }), fakeT, fr)).toBe(
      'orders.articles{"count":2}#2',
    )
  })

  it('prefers the estimated ready time over the wanted time', () => {
    const order = makeOrder({
      estimatedReadyTime: '2026-10-04T17:30:00.000Z',
      preferredReadyTime: '2026-10-04T18:00:00.000Z',
    })
    expect(cardMeta(order, fakeT, fr)).toBe(
      `orders.articles{"count":1}#1 · orders.readyAround${JSON.stringify({ time: clock(order.estimatedReadyTime!) })}`,
    )
  })

  it('shows the wanted time when there is no estimate', () => {
    const order = makeOrder({ preferredReadyTime: '2026-10-04T18:00:00.000Z' })
    expect(cardMeta(order, fakeT, fr)).toContain(
      `orders.wantedAt${JSON.stringify({ time: clock(order.preferredReadyTime!) })}`,
    )
  })

  it('adds the street and number of a delivery', () => {
    const order = makeOrder({ type: 'DELIVERY', address: makeAddress() })
    expect(cardMeta(order, fakeT, fr)).toBe('orders.articles{"count":1}#1 · Rue Saint-Gilles 12')
  })

  it('falls back to the first part of the display address when there is no structured address', () => {
    const order = makeOrder({ type: 'DELIVERY', displayAddress: 'Rue Vivegnis 5, 4000 Liège' })
    expect(cardMeta(order, fakeT, fr)).toBe('orders.articles{"count":1}#1 · Rue Vivegnis 5')
  })

  it('shows no street for a delivery without any address, nor for a pickup that has one', () => {
    expect(cardMeta(makeOrder({ type: 'DELIVERY' }), fakeT, fr)).toBe(
      'orders.articles{"count":1}#1',
    )
    const pickup = makeOrder({ type: 'PICKUP', address: makeAddress() })
    expect(cardMeta(pickup, fakeT, fr)).toBe('orders.articles{"count":1}#1')
    const noAddress = makeOrder({ type: 'DELIVERY', displayAddress: undefined as never })
    expect(cardMeta(noAddress, fakeT, fr)).toBe('orders.articles{"count":1}#1')
  })
})

describe('kanban board', () => {
  // 3 Oct 22:30 UTC is already 4 Oct 00:30 in Brussels.
  const DAY = '2026-10-04'
  const orders = [
    makeOrder({ id: 'pending', status: 'PENDING' }),
    makeOrder({ id: 'preparing', status: 'PREPARING' }),
    makeOrder({ id: 'ready', status: 'AWAITING_PICK_UP' }),
    makeOrder({ id: 'out', status: 'OUT_FOR_DELIVERY', type: 'DELIVERY' }),
    makeOrder({ id: 'done-today', status: 'DELIVERED', updatedAt: '2026-10-03T22:30:00.000Z' }),
    makeOrder({ id: 'done-yesterday', status: 'PICKED_UP', updatedAt: '2026-10-03T21:30:00.000Z' }),
    makeOrder({
      id: 'cancelled-today',
      status: 'CANCELLED',
      updatedAt: '2026-10-04T10:00:00.000Z',
    }),
    makeOrder({ id: 'done-no-date', status: 'DELIVERED', updatedAt: '' }),
  ]

  it('groups orders by status and labels the columns', () => {
    const columns = buildKanbanColumns(orders, DAY, fakeT)
    expect(columns.map((c) => [c.key, c.label, c.orders.map((o) => o.id)])).toEqual([
      ['NEW', 'orders.statusShort.new', ['pending']],
      ['PREPARING', 'orders.status.preparing', ['preparing']],
      ['AWAITING_PICK_UP', 'orders.status.awaiting_pick_up', ['ready']],
      ['OUT_FOR_DELIVERY', 'orders.status.out_for_delivery', ['out']],
      ['COMPLETED', 'orders.statusShort.completed', ['done-today', 'cancelled-today']],
    ])
  })

  it('filters the completed column on the Brussels calendar day, not the UTC day', () => {
    const completed = (day: string) =>
      buildKanbanColumns(orders, day, fakeT)
        .find((c) => c.key === 'COMPLETED')!
        .orders.map((o) => o.id)
    expect(completed('2026-10-04')).toEqual(['done-today', 'cancelled-today'])
    expect(completed('2026-10-03')).toEqual(['done-yesterday'])
    expect(completed('2026-10-02')).toEqual([])
  })

  it('does not mutate the column definitions', () => {
    buildKanbanColumns(orders, DAY, fakeT)
    expect(column('COMPLETED')).not.toHaveProperty('orders')
  })

  describe('canDropOnColumn', () => {
    it('refuses the column the order is already in and columns that take no drops', () => {
      expect(canDropOnColumn('PREPARING', column('PREPARING'))).toBe(false)
      expect(canDropOnColumn('PENDING', column('NEW'))).toBe(false)
      expect(canDropOnColumn('PENDING', column('PREPARING'))).toBe(true)
      expect(canDropOnColumn('PREPARING', column('NEW'))).toBe(false)
      expect(canDropOnColumn('DELIVERED', column('COMPLETED'))).toBe(false)
    })
  })

  describe('resolveDrop', () => {
    it('ignores a drop on the column the order is in, and on the "new" column', () => {
      expect(resolveDrop(makeOrder({ status: 'PREPARING' }), column('PREPARING'))).toEqual({
        kind: 'ignore',
      })
      expect(resolveDrop(makeOrder({ status: 'PREPARING' }), column('NEW'))).toEqual({
        kind: 'ignore',
      })
      expect(resolveDrop(makeOrder({ status: 'PENDING' }), column('NEW'))).toEqual({
        kind: 'ignore',
      })
    })

    it('moves an order to the column status when the status machine allows it', () => {
      expect(resolveDrop(makeOrder({ status: 'PENDING' }), column('PREPARING'))).toEqual({
        kind: 'move',
        status: 'PREPARING',
      })
      expect(resolveDrop(makeOrder({ status: 'PREPARING' }), column('AWAITING_PICK_UP'))).toEqual({
        kind: 'move',
        status: 'AWAITING_PICK_UP',
      })
      expect(
        resolveDrop(
          makeOrder({ status: 'AWAITING_PICK_UP', type: 'DELIVERY' }),
          column('OUT_FOR_DELIVERY'),
        ),
      ).toEqual({ kind: 'move', status: 'OUT_FOR_DELIVERY' })
    })

    it('refuses a move the status machine does not allow', () => {
      expect(resolveDrop(makeOrder({ status: 'PENDING' }), column('AWAITING_PICK_UP'))).toEqual({
        kind: 'invalid',
      })
      // A pickup never goes out for delivery.
      expect(
        resolveDrop(
          makeOrder({ status: 'AWAITING_PICK_UP', type: 'PICKUP' }),
          column('OUT_FOR_DELIVERY'),
        ),
      ).toEqual({ kind: 'invalid' })
      expect(resolveDrop(makeOrder({ status: 'CANCELLED' }), column('PREPARING'))).toEqual({
        kind: 'invalid',
      })
    })

    it('resolves the completed column by order type: pickup -> PICKED_UP, delivery -> DELIVERED', () => {
      expect(
        resolveDrop(makeOrder({ status: 'AWAITING_PICK_UP', type: 'PICKUP' }), column('COMPLETED')),
      ).toEqual({ kind: 'move', status: 'PICKED_UP' })
      expect(
        resolveDrop(
          makeOrder({ status: 'OUT_FOR_DELIVERY', type: 'DELIVERY' }),
          column('COMPLETED'),
        ),
      ).toEqual({ kind: 'move', status: 'DELIVERED' })
    })

    it('refuses to complete an order that is not ready yet', () => {
      expect(
        resolveDrop(makeOrder({ status: 'PREPARING', type: 'PICKUP' }), column('COMPLETED')),
      ).toEqual({ kind: 'invalid' })
      expect(
        resolveDrop(
          makeOrder({ status: 'AWAITING_PICK_UP', type: 'DELIVERY' }),
          column('COMPLETED'),
        ),
      ).toEqual({ kind: 'invalid' })
    })
  })
})

describe('mobile tabs', () => {
  const DAY = '2026-10-04'
  const orders = [
    makeOrder({ id: 'new-b', status: 'PENDING', createdAt: ago(10) }),
    makeOrder({ id: 'new-a', status: 'PENDING', createdAt: ago(30) }),
    makeOrder({ id: 'kitchen', status: 'PREPARING', createdAt: ago(20) }),
    makeOrder({ id: 'ready', status: 'AWAITING_PICK_UP', createdAt: ago(25) }),
    makeOrder({ id: 'out', status: 'OUT_FOR_DELIVERY', createdAt: ago(15) }),
    makeOrder({
      id: 'done-old',
      status: 'DELIVERED',
      createdAt: ago(300),
      updatedAt: '2026-10-04T08:00:00.000Z',
    }),
    makeOrder({
      id: 'done-new',
      status: 'CANCELLED',
      createdAt: ago(200),
      updatedAt: '2026-10-04T09:00:00.000Z',
    }),
    makeOrder({
      id: 'done-other-day',
      status: 'PICKED_UP',
      createdAt: ago(1000),
      updatedAt: '2026-10-03T09:00:00.000Z',
    }),
  ]

  it('covers every status exactly once', () => {
    const covered = MOBILE_TABS.flatMap((tab) => tab.statuses).sort()
    expect(covered).toEqual([...ALL_STATUSES].filter((s) => s !== 'FAILED').sort())
  })

  it('lists the orders of a tab, in list order, and only the completed day in "done"', () => {
    const ids = (key: Parameters<typeof mobileTabOrders>[1]) =>
      mobileTabOrders(orders, key, DAY).map((o) => o.id)
    expect(ids('new')).toEqual(['new-b', 'new-a'])
    expect(ids('kitchen')).toEqual(['kitchen'])
    expect(ids('out')).toEqual(['ready', 'out'])
    expect(ids('done')).toEqual(['done-old', 'done-new'])
    expect(mobileTabOrders(orders, 'done', '2026-10-03').map((o) => o.id)).toEqual([
      'done-other-day',
    ])
  })

  it('sorts the active tabs oldest first and "done" newest first', () => {
    const ids = (key: Parameters<typeof mobileCards>[1]) =>
      mobileCards(orders, key, DAY).map((o) => o.id)
    expect(ids('new')).toEqual(['new-a', 'new-b'])
    expect(ids('out')).toEqual(['ready', 'out'])
    expect(ids('done')).toEqual(['done-new', 'done-old'])
  })

  it('does not reorder the source list', () => {
    const before = orders.map((o) => o.id)
    mobileCards(orders, 'new', DAY)
    mobileCards(orders, 'done', DAY)
    expect(orders.map((o) => o.id)).toEqual(before)
  })
})

describe('why an order update failed', () => {
  const failure = (...codes: string[]) =>
    codes.map((code) => ({ message: 'x', extensions: { code } }))

  describe('gqlErrorCodes', () => {
    it('reads the code of each GraphQL error', () => {
      expect(gqlErrorCodes(failure('A', 'B'))).toEqual(['A', 'B'])
    })

    it('reads a single error object and an object carrying an `errors` array', () => {
      expect(gqlErrorCodes({ message: 'x', extensions: { code: 'A' } })).toEqual(['A'])
      expect(gqlErrorCodes({ errors: failure('B') })).toEqual(['B'])
    })

    it('skips errors without a string code, and anything that is not an error', () => {
      expect(gqlErrorCodes([{ message: 'x' }, { extensions: { code: 5 } }, null, 'oops'])).toEqual(
        [],
      )
      expect(gqlErrorCodes(new Error('network'))).toEqual([])
      expect(gqlErrorCodes(null)).toEqual([])
      expect(gqlErrorCodes(undefined)).toEqual([])
    })
  })

  describe('updateOrderErrorKey', () => {
    it('has a message for a payment that could not be refunded or cancelled, and for one Mollie cannot refund', () => {
      expect(updateOrderErrorKey(failure('PAYMENT_SETTLEMENT_FAILED'))).toBe(
        'orders.errors.paymentSettlementFailed',
      )
      expect(updateOrderErrorKey(failure('PAYMENT_NOT_REFUNDABLE'))).toBe(
        'orders.errors.paymentNotRefundable',
      )
    })

    it('finds the code wherever it is in the list of errors', () => {
      expect(updateOrderErrorKey(failure('SOMETHING', 'PAYMENT_NOT_REFUNDABLE'))).toBe(
        'orders.errors.paymentNotRefundable',
      )
    })

    // What tsb-service sends (resolver refuseReopeningSettledOrder).
    const REOPEN_REFUSAL = [
      {
        message:
          'this order was cancelled and its payment refunded or cancelled, so it cannot be reopened; create a new order instead',
        extensions: { code: 'USER_ERROR' },
      },
    ]

    it('says a refunded order cannot be reopened when the backend refuses it, moving a cancelled order to another status', () => {
      const context = { currentStatus: 'CANCELLED', targetStatus: 'PREPARING' } as const
      expect(updateOrderErrorKey(REOPEN_REFUSAL, context)).toBe(
        'orders.errors.refundedNotReopenable',
      )
      expect(updateOrderErrorKey({ errors: REOPEN_REFUSAL }, context)).toBe(
        'orders.errors.refundedNotReopenable',
      )
    })

    it('keeps the generic message for any other USER_ERROR of that move (the message must say it cannot be reopened)', () => {
      const context = { currentStatus: 'CANCELLED', targetStatus: 'PREPARING' } as const
      expect(updateOrderErrorKey(failure('USER_ERROR'), context)).toBe('orders.errors.updateFailed')
      expect(
        updateOrderErrorKey(
          [{ message: 'cannot be reopened', extensions: { code: 'OTHER' } }],
          context,
        ),
      ).toBe('orders.errors.updateFailed')
      expect(
        updateOrderErrorKey([{ extensions: { code: 'USER_ERROR' } }, null, 'x'], context),
      ).toBe('orders.errors.updateFailed')
      expect(updateOrderErrorKey(null, context)).toBe('orders.errors.updateFailed')
    })

    it.each([
      ['cancelling a cancelled order', { currentStatus: 'CANCELLED', targetStatus: 'CANCELLED' }],
      ['a time-only save', { currentStatus: 'CANCELLED' }],
      ['another order', { currentStatus: 'PREPARING', targetStatus: 'AWAITING_PICK_UP' }],
      ['no context', {}],
    ] as const)('keeps the generic message for the reopen refusal on %s', (_name, context) => {
      expect(updateOrderErrorKey(REOPEN_REFUSAL, context)).toBe('orders.errors.updateFailed')
    })

    it('keeps the generic message for any other failure', () => {
      expect(updateOrderErrorKey(failure('INTERNAL_ERROR'))).toBe('orders.errors.updateFailed')
      expect(updateOrderErrorKey(new TypeError('Failed to fetch'))).toBe(
        'orders.errors.updateFailed',
      )
      expect(updateOrderErrorKey(undefined)).toBe('orders.errors.updateFailed')
    })

    it('does not let a USER_ERROR reopen message hide a payment code', () => {
      expect(
        updateOrderErrorKey([...REOPEN_REFUSAL, ...failure('PAYMENT_SETTLEMENT_FAILED')], {
          currentStatus: 'CANCELLED',
          targetStatus: 'PREPARING',
        }),
      ).toBe('orders.errors.paymentSettlementFailed')
    })
  })
})
