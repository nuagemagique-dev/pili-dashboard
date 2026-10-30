// useOrderActions: everything the staff does to an order from the board, the slideover or the mobile detail page:
// status transitions (allowed moves, quick advance, kanban drop with optimistic update and rollback), the estimated ready
// time slider, marking a payment as paid, the cancellation confirmation (with its delay). The GraphQL transport, the toasts and i18n are the boundaries; the orders store
// (real Pinia) is the state that is checked.
// Run: `vp test run tests/composables/useOrderActions.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createPinia, setActivePinia } from 'pinia'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { Order, OrderStatus, OrderType } from '~/types'
import { useOrdersStore } from '~/stores/orders'
import { orderDocument } from '~/utils/hubrise'
import { setFlags } from '../support/flags'
import { mountComposable } from '../helpers/mountComposable'
import { makeOrder } from '../fixtures/dashboard'
import { makeStatus } from '../fixtures/hubrise'

const gqlFetch = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ add: vi.fn() }))

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
mockNuxtImport('useToast', () => () => toast)
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

const { ORDER_BY_ID_QUERY, useOrderActions } = await import('~/composables/useOrderActions')
const { ORDER_STATUS_CHIP_TONE, getAllowedStatuses, isActiveStatus } =
  await import('~/utils/orders')

// Local wall-clock "now" so formatted times are the same in any timezone.
const NOW = new Date(2026, 9, 4, 12, 0, 0)
const inMinutes = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()

const ALL_STATUSES: OrderStatus[] = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'AWAITING_PICK_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'PICKED_UP',
  'CANCELLED',
  'FAILED',
]

/** What the server answers to `updateOrder`. */
const updated = (order: Partial<Order> & { id: string }) => ({ updateOrder: order })

function setup(options: { onDone?: (kind: string) => void } = {}) {
  const store = useOrdersStore()
  const mounted = mountComposable(() => useOrderActions(options as never))
  return { store, actions: mounted.result, unmount: mounted.unmount }
}

/** An order that is in the store and selected, as when a card is opened. */
function selected(
  overrides: Partial<Order> = {},
  options: { onDone?: (kind: string) => void } = {},
) {
  const order = makeOrder({ id: 'o-1', ...overrides })
  const harness = setup(options)
  harness.store.setOrders([order])
  harness.actions.selectOrder(harness.store.orders[0]!)
  return { ...harness, order: harness.store.orders[0]! }
}

const toasts = () => toast.add.mock.calls.map(([t]) => t)

/** A GraphQL failure as `$gqlFetch` throws it: the raw `errors` array, the code in `extensions.code`. */
const gqlFailure = (code: string, message = 'backend text, never shown') => [
  { message, extensions: { code } },
]

beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getAllowedStatuses: the order workflow', () => {
  it.each<[OrderStatus, OrderType, OrderStatus[]]>([
    ['PENDING', 'DELIVERY', ['CONFIRMED', 'PREPARING', 'CANCELLED']],
    ['PENDING', 'PICKUP', ['CONFIRMED', 'PREPARING', 'CANCELLED']],
    ['CONFIRMED', 'DELIVERY', ['PREPARING', 'CANCELLED']],
    ['PREPARING', 'PICKUP', ['AWAITING_PICK_UP', 'CANCELLED']],
    ['AWAITING_PICK_UP', 'DELIVERY', ['OUT_FOR_DELIVERY', 'CANCELLED']],
    ['AWAITING_PICK_UP', 'PICKUP', ['PICKED_UP', 'FAILED', 'CANCELLED']],
    ['OUT_FOR_DELIVERY', 'DELIVERY', ['DELIVERED', 'FAILED', 'CANCELLED']],
    ['DELIVERED', 'DELIVERY', ['CANCELLED']],
    ['PICKED_UP', 'PICKUP', ['CANCELLED']],
    ['FAILED', 'DELIVERY', ['CANCELLED']],
    ['CANCELLED', 'DELIVERY', []],
    ['CANCELLED', 'PICKUP', []],
  ])('%s (%s) can go to %j', (current, type, expected) => {
    expect(getAllowedStatuses(current, type)).toEqual(expected)
  })

  it('offers only cancellation for an order ready for pick-up whose type is unknown', () => {
    expect(getAllowedStatuses('AWAITING_PICK_UP', 'UNKNOWN' as OrderType)).toEqual(['CANCELLED'])
  })

  it('never offers to move to the status the order already has', () => {
    for (const status of ALL_STATUSES) {
      for (const type of ['DELIVERY', 'PICKUP'] as OrderType[]) {
        expect(getAllowedStatuses(status, type)).not.toContain(status)
      }
    }
  })

  it('returns a fresh list each time, so callers cannot corrupt the workflow', () => {
    const first = getAllowedStatuses('PENDING', 'PICKUP')
    first.push('FAILED')
    expect(getAllowedStatuses('PENDING', 'PICKUP')).toEqual(['CONFIRMED', 'PREPARING', 'CANCELLED'])
  })
})

describe('status helpers', () => {
  it('isActiveStatus: only the orders still to prepare', () => {
    expect(ALL_STATUSES.filter(isActiveStatus)).toEqual(['PENDING', 'CONFIRMED', 'PREPARING'])
  })

  it('has a chip tone for every status', () => {
    expect(Object.keys(ORDER_STATUS_CHIP_TONE).sort()).toEqual([...ALL_STATUSES].sort())
    expect(ORDER_STATUS_CHIP_TONE.PENDING).toBe('warning')
    expect(ORDER_STATUS_CHIP_TONE.CANCELLED).toBe('danger')
    expect(ORDER_STATUS_CHIP_TONE.FAILED).toBe('danger')
  })

  it('the single-order query asks for what the board needs', () => {
    for (const field of [
      'status',
      'type',
      'totalPrice',
      'estimatedReadyTime',
      'displayAddress',
      'orderExtra',
      'translations',
      'choice',
      'payment',
    ]) {
      expect(ORDER_BY_ID_QUERY).toMatch(new RegExp(`\\b${field}\\b`, 'u'))
    }
    expect(ORDER_BY_ID_QUERY).toMatch(/query \(\$id: ID!\)/u)
  })

  it('asks for the HubRise state, which orderDocument takes out for a server without HubRise', () => {
    expect(ORDER_BY_ID_QUERY).toContain('hubrise {')
    expect(orderDocument(ORDER_BY_ID_QUERY, makeStatus())).toBe(ORDER_BY_ID_QUERY)
    const plain = orderDocument(ORDER_BY_ID_QUERY, makeStatus({ available: false }))
    expect(plain).not.toContain('hubrise')
    expect(plain).toContain('payment')
  })
})

describe('the selected order and its statuses', () => {
  it('has no statuses while nothing is selected', () => {
    const { actions } = setup()
    expect(actions.selectedOrder.value).toBeNull()
    expect(actions.availableStatuses.value).toEqual([])
    expect(actions.primaryStatuses.value).toEqual([])
    expect(actions.secondaryStatuses.value).toEqual([])
  })

  it('splits the moves into primary (forward) and secondary (cancel / fail)', () => {
    const { actions } = selected({ status: 'AWAITING_PICK_UP', type: 'PICKUP' })
    expect(actions.availableStatuses.value).toEqual(['PICKED_UP', 'FAILED', 'CANCELLED'])
    expect(actions.primaryStatuses.value).toEqual(['PICKED_UP'])
    expect(actions.secondaryStatuses.value).toEqual(['FAILED', 'CANCELLED'])
  })

  it('selecting an order marks it as seen, clears a staged status and sets up the time controls', () => {
    const { actions, store } = setup()
    store.addOrder(makeOrder({ id: 'o-new', status: 'PENDING' }))
    expect(store.unacknowledgedPendingCount).toBe(1)
    actions.handleStatusButton('CONFIRMED')

    actions.selectOrder(store.orders[0]!)

    expect(store.unacknowledgedPendingCount).toBe(0)
    expect(actions.selectedOrder.value?.id).toBe('o-new')
    expect(actions.stagedStatus.value).toBeUndefined()
    expect(actions.baseEstimatedTime.value).toEqual(NOW)
  })

  it('handleStatusButton stages a status, and un-stages it when pressed again', () => {
    const { actions } = setup()
    actions.handleStatusButton('CONFIRMED')
    expect(actions.stagedStatus.value).toBe('CONFIRMED')
    actions.handleStatusButton('PREPARING')
    expect(actions.stagedStatus.value).toBe('PREPARING')
    actions.handleStatusButton('PREPARING')
    expect(actions.stagedStatus.value).toBeUndefined()
  })
})

describe('the estimated ready time (initTime)', () => {
  it('starts a new (PENDING) order at "in 30 minutes" from now', () => {
    const { actions } = selected({ status: 'PENDING', estimatedReadyTime: null })
    expect(actions.baseEstimatedTime.value).toEqual(NOW)
    expect(actions.sliderDeltaMinutes.value).toBe(30)
    expect(actions.initialSliderValue.value).toBe(0)
    expect(actions.newEstimatedTime.value).toBe('12:30')
  })

  it('ignores any estimate on a PENDING order: staff always set it again', () => {
    const { actions } = selected({ status: 'PENDING', estimatedReadyTime: inMinutes(50) })
    expect(actions.sliderDeltaMinutes.value).toBe(30)
    expect(actions.initialSliderValue.value).toBe(0)
  })

  it('shows the time left until the estimate for a confirmed order, rounded to 5 minutes', () => {
    const { actions } = selected({ status: 'CONFIRMED', estimatedReadyTime: inMinutes(23) })
    expect(actions.baseEstimatedTime.value).toEqual(new Date(inMinutes(23)))
    expect(actions.sliderDeltaMinutes.value).toBe(25)
    expect(actions.initialSliderValue.value).toBe(25)
  })

  it('rounds half a step up', () => {
    const { actions } = selected({ status: 'PREPARING', estimatedReadyTime: inMinutes(17.5) })
    // 17.5 minutes rounds to 18, then to the nearest 5: 20.
    expect(actions.sliderDeltaMinutes.value).toBe(20)
  })

  it('is 0 when the estimate is already past (it never goes negative)', () => {
    const { actions } = selected({ status: 'PREPARING', estimatedReadyTime: inMinutes(-15) })
    expect(actions.sliderDeltaMinutes.value).toBe(0)
    expect(actions.initialSliderValue.value).toBe(0)
  })

  it('is 0 from now when there is no estimate', () => {
    const { actions } = selected({ status: 'PREPARING', estimatedReadyTime: null })
    expect(actions.baseEstimatedTime.value).toEqual(NOW)
    expect(actions.sliderDeltaMinutes.value).toBe(0)
    expect(actions.initialSliderValue.value).toBe(0)
  })

  it('falls back to "now, no delta" for an estimate that is not a date, logging in dev only', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { actions } = selected({ status: 'PREPARING', estimatedReadyTime: 'garbage' })
    expect(actions.baseEstimatedTime.value).toEqual(NOW)
    expect(actions.sliderDeltaMinutes.value).toBe(0)
    expect(error).not.toHaveBeenCalled()

    setFlags({ dev: true })
    actions.initTime(makeOrder({ status: 'PREPARING', estimatedReadyTime: 'garbage' }))
    expect(error).toHaveBeenCalledExactlyOnceWith('Error initializing time:', expect.any(Error))
  })

  it('shows nothing before an order is selected', () => {
    const { actions } = setup()
    expect(actions.newEstimatedTime.value).toBe('')
  })

  it('newEstimatedTime follows the slider relative to the estimate it started from', () => {
    const { actions } = selected({ status: 'CONFIRMED', estimatedReadyTime: inMinutes(20) })
    expect(actions.newEstimatedTime.value).toBe('12:20')
    actions.sliderDeltaMinutes.value = 35
    expect(actions.newEstimatedTime.value).toBe('12:35')
    actions.sliderDeltaMinutes.value = 10
    expect(actions.newEstimatedTime.value).toBe('12:10')
  })

  it('canSave is on when a status is staged or the slider moved, off otherwise', () => {
    const { actions } = selected({ status: 'CONFIRMED', estimatedReadyTime: inMinutes(20) })
    expect(actions.canSave.value).toBeFalsy()
    actions.sliderDeltaMinutes.value = 25
    expect(actions.canSave.value).toBe(true)
    actions.sliderDeltaMinutes.value = 20
    expect(actions.canSave.value).toBeFalsy()
    actions.handleStatusButton('PREPARING')
    expect(actions.canSave.value).toBeTruthy()
  })
})

describe('quickStatusAdvance (slideover primary buttons)', () => {
  it('does nothing without a selected order', async () => {
    const { actions } = setup()
    await actions.quickStatusAdvance('CONFIRMED')
    expect(gqlFetch).not.toHaveBeenCalled()
  })

  it('saves the new status, updates the board, closes the panel and confirms with a toast', async () => {
    const onDone = vi.fn()
    const { actions, store } = selected(
      { status: 'CONFIRMED', estimatedReadyTime: inMinutes(20) },
      { onDone },
    )
    gqlFetch.mockResolvedValue(
      updated({ id: 'o-1', status: 'PREPARING', updatedAt: 'server-time' }),
    )

    await actions.quickStatusAdvance('PREPARING')

    expect(gqlFetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('updateOrder'), {
      variables: { id: 'o-1', input: { status: 'PREPARING', estimatedReadyTime: undefined } },
    })
    expect(store.orders[0]).toMatchObject({ status: 'PREPARING', updatedAt: 'server-time' })
    expect(onDone).toHaveBeenCalledExactlyOnceWith('advance')
    expect(toasts()).toEqual([{ title: 'orders.statusAdvanced', color: 'success' }])
    expect(actions.quickActionLoading.value).toBe(false)
  })

  it('sends the adjusted ready time (as the shop-local time today) along with the status', async () => {
    const { actions } = selected({ status: 'CONFIRMED', estimatedReadyTime: inMinutes(20) })
    actions.sliderDeltaMinutes.value = 35
    gqlFetch.mockResolvedValue(updated({ id: 'o-1', status: 'PREPARING' }))

    await actions.quickStatusAdvance('PREPARING')

    const { input } = gqlFetch.mock.calls[0]![1].variables
    expect(input.status).toBe('PREPARING')
    expect(input.estimatedReadyTime).toMatch(/^2026-10-04T12:35:00[+-]\d\d:\d\d$/u)
  })

  it('always sends a ready time when confirming a new order (the 30 minute default is part of the save)', async () => {
    const { actions } = selected({ status: 'PENDING' })
    gqlFetch.mockResolvedValue(updated({ id: 'o-1', status: 'CONFIRMED' }))
    await actions.quickStatusAdvance('CONFIRMED')
    expect(gqlFetch.mock.calls[0]![1].variables.input.estimatedReadyTime).toMatch(
      /^2026-10-04T12:30:00[+-]\d\d:\d\d$/u,
    )
  })

  it('opens the cancellation dialog instead of cancelling right away', async () => {
    const { actions } = selected({ status: 'PENDING' })
    await actions.quickStatusAdvance('CANCELLED')
    expect(actions.showCancelDialog.value).toBe(true)
    expect(gqlFetch).not.toHaveBeenCalled()
  })

  it('shows an error toast and leaves the board and the panel alone when the save fails', async () => {
    const onDone = vi.fn()
    const { actions, store } = selected({ status: 'CONFIRMED' }, { onDone })
    gqlFetch.mockRejectedValue(new Error('network'))

    await actions.quickStatusAdvance('PREPARING')

    expect(toasts()).toEqual([{ title: 'orders.errors.updateFailed', color: 'error' }])
    expect(store.orders[0]?.status).toBe('CONFIRMED')
    expect(onDone).not.toHaveBeenCalled()
    expect(actions.quickActionLoading.value).toBe(false)
  })

  it('ignores a second tap while the first is saving (no double transition)', async () => {
    const { actions } = selected({ status: 'CONFIRMED' })
    let answer: (value: unknown) => void = () => {}
    gqlFetch.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )

    const first = actions.quickStatusAdvance('PREPARING')
    expect(actions.quickActionLoading.value).toBe(true)
    await actions.quickStatusAdvance('PREPARING')
    expect(gqlFetch).toHaveBeenCalledOnce()

    answer(updated({ id: 'o-1', status: 'PREPARING' }))
    await first
    expect(actions.quickActionLoading.value).toBe(false)
  })

  it('works without an onDone callback', async () => {
    const { actions } = selected({ status: 'CONFIRMED' })
    gqlFetch.mockResolvedValue(updated({ id: 'o-1', status: 'PREPARING' }))
    await expect(actions.quickStatusAdvance('PREPARING')).resolves.toBeUndefined()
  })
})

describe('quickAdvanceStatus (one tap on a card)', () => {
  it('moves the order to its next status right away, then takes the server answer', async () => {
    const { actions, store } = setup()
    store.setOrders([makeOrder({ id: 'o-1', status: 'PENDING', updatedAt: 'before' })])
    let answer: (value: unknown) => void = () => {}
    gqlFetch.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )

    const pending = actions.quickAdvanceStatus(store.orders[0]!)
    // Optimistic: the card has already moved while the request is in flight.
    expect(store.orders[0]?.status).toBe('CONFIRMED')
    expect(store.orders[0]?.updatedAt).toBe(NOW.toISOString())

    answer(updated({ id: 'o-1', status: 'CONFIRMED', updatedAt: 'server' }))
    await pending

    expect(gqlFetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('updateOrder'), {
      variables: { id: 'o-1', input: { status: 'CONFIRMED' } },
    })
    expect(store.orders[0]).toMatchObject({ status: 'CONFIRMED', updatedAt: 'server' })
    expect(toasts()).toEqual([{ title: 'orders.statusAdvanced', color: 'success' }])
  })

  it('picks the next forward status of the order type: pick-up goes to picked up, delivery to out for delivery', async () => {
    const { actions, store } = setup()
    store.setOrders([
      makeOrder({ id: 'pickup', status: 'AWAITING_PICK_UP', type: 'PICKUP' }),
      makeOrder({ id: 'delivery', status: 'AWAITING_PICK_UP', type: 'DELIVERY' }),
    ])
    gqlFetch.mockImplementation(
      (_q: string, { variables }: { variables: { id: string; input: { status: string } } }) =>
        Promise.resolve(
          updated({ id: variables.id, status: variables.input.status as OrderStatus }),
        ),
    )

    await actions.quickAdvanceStatus(store.orders[0]!)
    await actions.quickAdvanceStatus(store.orders[1]!)

    expect(store.orders.map((o) => o.status)).toEqual(['PICKED_UP', 'OUT_FOR_DELIVERY'])
  })

  it('does nothing for an order that only has cancel / fail left', async () => {
    const { actions, store } = setup()
    store.setOrders([makeOrder({ id: 'o-1', status: 'DELIVERED' })])
    await actions.quickAdvanceStatus(store.orders[0]!)
    expect(gqlFetch).not.toHaveBeenCalled()
    expect(store.orders[0]?.status).toBe('DELIVERED')
    expect(toast.add).not.toHaveBeenCalled()
  })

  it('puts the card back as it was, and says so, when the save fails', async () => {
    const { actions, store } = setup()
    store.setOrders([makeOrder({ id: 'o-1', status: 'PENDING', updatedAt: 'before' })])
    gqlFetch.mockRejectedValue(new Error('network'))

    await actions.quickAdvanceStatus(store.orders[0]!)

    expect(store.orders[0]).toMatchObject({ status: 'PENDING', updatedAt: 'before' })
    expect(toasts()).toEqual([{ title: 'orders.errors.updateFailed', color: 'error' }])
  })
})

describe('dropOrderStatus (kanban drop)', () => {
  it('moves the card to the dropped column immediately, then takes the server answer (no toast on success)', async () => {
    const { actions, store } = setup()
    store.setOrders([makeOrder({ id: 'o-1', status: 'PENDING', updatedAt: 'before' })])
    let answer: (value: unknown) => void = () => {}
    gqlFetch.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )

    const pending = actions.dropOrderStatus(store.orders[0]!, 'PREPARING')
    expect(store.orders[0]).toMatchObject({ status: 'PREPARING', updatedAt: NOW.toISOString() })

    answer(updated({ id: 'o-1', status: 'PREPARING', updatedAt: 'server' }))
    await pending

    expect(gqlFetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('updateOrder'), {
      variables: { id: 'o-1', input: { status: 'PREPARING' } },
    })
    expect(store.orders[0]).toMatchObject({ status: 'PREPARING', updatedAt: 'server' })
    expect(toast.add).not.toHaveBeenCalled()
  })

  it('reverts the card to its previous column and time, and tells the staff, when the server refuses', async () => {
    const { actions, store } = setup()
    store.setOrders([makeOrder({ id: 'o-1', status: 'PENDING', updatedAt: 'before' })])
    gqlFetch.mockRejectedValue([{ message: 'invalid transition' }])

    await actions.dropOrderStatus(store.orders[0]!, 'DELIVERED')

    expect(store.orders[0]).toMatchObject({ status: 'PENDING', updatedAt: 'before' })
    expect(toasts()).toEqual([{ title: 'orders.errors.updateFailed', color: 'error' }])
  })
})

describe('updateOrder (save from the slideover)', () => {
  it('does nothing without a selected order', async () => {
    const { actions } = setup()
    await actions.updateOrder('CONFIRMED')
    expect(gqlFetch).not.toHaveBeenCalled()
  })

  it('saves the status, updates the board and reports "save" to the caller', async () => {
    const onDone = vi.fn()
    const { actions, store } = selected(
      { status: 'CONFIRMED', estimatedReadyTime: inMinutes(20) },
      { onDone },
    )
    gqlFetch.mockResolvedValue(updated({ id: 'o-1', status: 'PREPARING' }))

    await actions.updateOrder('PREPARING')

    expect(gqlFetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('updateOrder'), {
      variables: { id: 'o-1', input: { status: 'PREPARING', estimatedReadyTime: undefined } },
    })
    expect(store.orders[0]?.status).toBe('PREPARING')
    expect(onDone).toHaveBeenCalledExactlyOnceWith('save')
    expect(toast.add).not.toHaveBeenCalled()
  })

  it('can save only a new ready time (no status)', async () => {
    const { actions } = selected({ status: 'CONFIRMED', estimatedReadyTime: inMinutes(20) })
    actions.sliderDeltaMinutes.value = 40
    gqlFetch.mockResolvedValue(updated({ id: 'o-1' }))

    await actions.updateOrder()

    const { input } = gqlFetch.mock.calls[0]![1].variables
    expect(input.status).toBeUndefined()
    expect(input.estimatedReadyTime).toMatch(/^2026-10-04T12:40:00[+-]\d\d:\d\d$/u)
  })

  it('opens the cancellation dialog for CANCELLED instead of saving', async () => {
    const { actions } = selected({ status: 'PENDING' })
    await actions.updateOrder('CANCELLED')
    expect(actions.showCancelDialog.value).toBe(true)
    expect(gqlFetch).not.toHaveBeenCalled()
  })

  it('shows an error toast, logging in dev, and does not close the panel when the save fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onDone = vi.fn()
    const { actions } = selected({ status: 'CONFIRMED' }, { onDone })
    gqlFetch.mockRejectedValue(new Error('network'))

    await actions.updateOrder('PREPARING')
    expect(toasts()).toEqual([{ title: 'orders.errors.updateFailed', color: 'error' }])
    expect(onDone).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()

    setFlags({ dev: true })
    await actions.updateOrder('PREPARING')
    expect(error).toHaveBeenCalledExactlyOnceWith('Update failed:', expect.any(Error))
  })
})

describe('updateOrder: why a save fails', () => {
  it.each([
    ['PAYMENT_SETTLEMENT_FAILED', 'orders.errors.paymentSettlementFailed'],
    ['PAYMENT_NOT_REFUNDABLE', 'orders.errors.paymentNotRefundable'],
    ['INTERNAL_ERROR', 'orders.errors.updateFailed'],
    ['USER_ERROR', 'orders.errors.updateFailed'],
  ])('a %s answer shows %s (the slideover save)', async (code, key) => {
    const { actions } = selected({ status: 'CONFIRMED' })
    gqlFetch.mockRejectedValue(gqlFailure(code))
    await actions.updateOrder('PREPARING')
    expect(toasts()).toEqual([{ title: key, color: 'error' }])
  })

  it('shows the message of the code in every path that updates an order', async () => {
    const failure = gqlFailure('PAYMENT_SETTLEMENT_FAILED')
    const { actions, store } = selected({ status: 'CONFIRMED' })

    gqlFetch.mockRejectedValue(failure)
    await actions.quickStatusAdvance('PREPARING')
    await actions.quickAdvanceStatus(store.orders[0]!)
    await actions.dropOrderStatus(store.orders[0]!, 'PREPARING')

    expect(toasts()).toEqual([
      { title: 'orders.errors.paymentSettlementFailed', color: 'error' },
      { title: 'orders.errors.paymentSettlementFailed', color: 'error' },
      { title: 'orders.errors.paymentSettlementFailed', color: 'error' },
    ])
    expect(store.orders[0]?.status).toBe('CONFIRMED')
  })

  it('says a refunded order cannot be reopened when the backend refuses to move a cancelled order (USER_ERROR)', async () => {
    const { actions, store } = selected({ status: 'CANCELLED' })
    gqlFetch.mockRejectedValue(
      gqlFailure(
        'USER_ERROR',
        'this order was cancelled and its payment refunded or cancelled, so it cannot be reopened; create a new order instead',
      ),
    )

    await actions.updateOrder('PREPARING')
    await actions.dropOrderStatus(store.orders[0]!, 'PREPARING')

    expect(toasts()).toEqual([
      { title: 'orders.errors.refundedNotReopenable', color: 'error' },
      { title: 'orders.errors.refundedNotReopenable', color: 'error' },
    ])
  })

  it('keeps the generic message for a USER_ERROR on any other order, and for a time-only save of a cancelled one', async () => {
    gqlFetch.mockRejectedValue(gqlFailure('USER_ERROR'))
    const open = selected({ status: 'CONFIRMED' })
    await open.actions.updateOrder('PREPARING')
    const cancelled = selected({ status: 'CANCELLED', id: 'o-2' })
    cancelled.actions.sliderDeltaMinutes.value = 45
    await cancelled.actions.updateOrder()
    expect(toasts()).toEqual([
      { title: 'orders.errors.updateFailed', color: 'error' },
      { title: 'orders.errors.updateFailed', color: 'error' },
    ])
  })

  it('keeps the generic message when the failure is not a GraphQL error at all (network, abort)', async () => {
    const { actions } = selected({ status: 'CONFIRMED' })
    gqlFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await actions.updateOrder('PREPARING')
    expect(toasts()).toEqual([{ title: 'orders.errors.updateFailed', color: 'error' }])
  })

  it('is "saving" while the request is in flight: a second save is ignored', async () => {
    const onDone = vi.fn()
    const { actions } = selected({ status: 'CONFIRMED' }, { onDone })
    let answer: (value: unknown) => void = () => {}
    gqlFetch.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )

    const first = actions.updateOrder('PREPARING')
    expect(actions.isSaving.value).toBe(true)
    await actions.updateOrder('PREPARING')
    expect(gqlFetch).toHaveBeenCalledOnce()

    answer(updated({ id: 'o-1', status: 'PREPARING' }))
    await first
    expect(actions.isSaving.value).toBe(false)
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('can save again after a failure', async () => {
    const { actions } = selected({ status: 'CONFIRMED' })
    gqlFetch.mockRejectedValueOnce(new Error('network'))
    await actions.updateOrder('PREPARING')
    expect(actions.isSaving.value).toBe(false)
    gqlFetch.mockResolvedValueOnce(updated({ id: 'o-1', status: 'PREPARING' }))
    await actions.updateOrder('PREPARING')
    expect(gqlFetch).toHaveBeenCalledTimes(2)
  })
})

describe('markAsPaid', () => {
  it('does nothing without a selected order', async () => {
    const { actions } = setup()
    await actions.markAsPaid()
    expect(gqlFetch).not.toHaveBeenCalled()
  })

  it('marks the payment paid, on the open order and on the board', async () => {
    const payment = { id: 'pay-1', status: 'open', paidAt: null }
    const { actions, store } = selected({ payment: payment as never })
    gqlFetch.mockResolvedValue({ updatePaymentStatus: { id: 'pay-1', status: 'paid' } })

    await actions.markAsPaid()

    expect(gqlFetch).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('updatePaymentStatus'),
      {
        variables: { orderId: 'o-1', status: 'paid' },
      },
    )
    expect(actions.selectedOrder.value?.payment?.status).toBe('paid')
    expect(store.orders[0]?.payment).toMatchObject({ id: 'pay-1', status: 'paid' })
    expect(actions.isUpdatingPayment.value).toBe(false)
  })

  it('handles an order without a payment record (cash on the spot)', async () => {
    const { actions, store } = selected({ payment: null })
    gqlFetch.mockResolvedValue({ updatePaymentStatus: { id: 'pay-new', status: 'paid' } })

    await actions.markAsPaid()

    expect(store.orders[0]?.payment).toBeNull()
    expect(toast.add).not.toHaveBeenCalled()
  })

  it('is "updating" while in flight', async () => {
    const { actions } = selected({ payment: { id: 'pay-1', status: 'open' } as never })
    let answer: (value: unknown) => void = () => {}
    gqlFetch.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const pending = actions.markAsPaid()
    expect(actions.isUpdatingPayment.value).toBe(true)
    answer({ updatePaymentStatus: { id: 'pay-1', status: 'paid' } })
    await pending
    expect(actions.isUpdatingPayment.value).toBe(false)
  })

  it('leaves the payment as it was and shows an error toast when it fails (logging in dev)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { actions, store } = selected({ payment: { id: 'pay-1', status: 'open' } as never })
    gqlFetch.mockRejectedValue(new Error('network'))

    await actions.markAsPaid()
    expect(toasts()).toEqual([{ title: 'orders.errors.paymentUpdateFailed', color: 'error' }])
    expect(store.orders[0]?.payment?.status).toBe('open')
    expect(actions.isUpdatingPayment.value).toBe(false)
    expect(error).not.toHaveBeenCalled()

    setFlags({ dev: true })
    await actions.markAsPaid()
    expect(error).toHaveBeenCalledExactlyOnceWith(
      'Failed to update payment status:',
      expect.any(Error),
    )
  })
})

describe('the cancellation dialog', () => {
  it('opens locked, and unlocks the confirm button after 3 seconds', () => {
    const { actions } = selected({ status: 'PENDING' })
    actions.openCancelDialog()
    expect(actions.showCancelDialog.value).toBe(true)
    expect(actions.cancelDelay.value).toBe(3)
    expect(actions.confirmDisabled.value).toBe(true)

    vi.advanceTimersByTime(2000)
    expect(actions.cancelDelay.value).toBe(1)
    expect(actions.confirmDisabled.value).toBe(true)

    vi.advanceTimersByTime(1000)
    expect(actions.cancelDelay.value).toBe(0)
    expect(actions.confirmDisabled.value).toBe(false)
  })

  it('stops counting once it reaches zero (the timer cleans itself up)', () => {
    const { actions } = selected({ status: 'PENDING' })
    actions.openCancelDialog()
    vi.advanceTimersByTime(4000)
    expect(actions.cancelDelay.value).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(actions.cancelDelay.value).toBe(0)
  })

  it('re-locks each time it is opened', () => {
    const { actions } = selected({ status: 'PENDING' })
    actions.openCancelDialog()
    vi.advanceTimersByTime(4000)
    actions.cancelCancellation()
    actions.openCancelDialog()
    expect(actions.cancelDelay.value).toBe(3)
    expect(actions.confirmDisabled.value).toBe(true)
  })

  it('cancelCancellation closes the dialog and stops the countdown', () => {
    const { actions } = selected({ status: 'PENDING' })
    actions.openCancelDialog()
    actions.cancelCancellation()
    expect(actions.showCancelDialog.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancelCancellation without a running countdown is harmless', () => {
    const { actions } = selected({ status: 'PENDING' })
    expect(() => {
      actions.cancelCancellation()
    }).not.toThrow()
    expect(actions.showCancelDialog.value).toBe(false)
  })

  it('the countdown does not outlive the component', () => {
    const { actions, unmount } = selected({ status: 'PENDING' })
    actions.openCancelDialog()
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unmounting without a countdown is harmless', () => {
    const { unmount } = selected({ status: 'PENDING' })
    expect(() => {
      unmount()
    }).not.toThrow()
  })

  describe('confirmCancellation', () => {
    it('does nothing without a selected order', async () => {
      const { actions } = setup()
      await actions.confirmCancellation()
      expect(gqlFetch).not.toHaveBeenCalled()
    })

    it('cancels the order, closes the dialog, reports "cancel" and confirms with a toast', async () => {
      const onDone = vi.fn()
      const { actions, store } = selected({ status: 'PENDING' }, { onDone })
      actions.openCancelDialog()
      gqlFetch.mockResolvedValue(updated({ id: 'o-1', status: 'CANCELLED' }))

      await actions.confirmCancellation()

      expect(gqlFetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('updateOrder'), {
        variables: { id: 'o-1', input: { status: 'CANCELLED' } },
      })
      expect(store.orders[0]?.status).toBe('CANCELLED')
      expect(actions.showCancelDialog.value).toBe(false)
      expect(onDone).toHaveBeenCalledExactlyOnceWith('cancel')
      expect(toasts()).toEqual([{ title: 'orders.statusAdvanced', color: 'success' }])
    })

    it('says the payment could not be refunded or cancelled, and that the order is unchanged, then lets the staff try again', async () => {
      const { actions, store } = selected({ status: 'PENDING', isOnlinePayment: true })
      actions.openCancelDialog()
      gqlFetch.mockRejectedValueOnce(gqlFailure('PAYMENT_SETTLEMENT_FAILED'))

      await actions.confirmCancellation()

      expect(toasts()).toEqual([{ title: 'orders.errors.paymentSettlementFailed', color: 'error' }])
      expect(actions.showCancelDialog.value).toBe(true)
      expect(store.orders[0]?.status).toBe('PENDING')
      expect(actions.isCancelling.value).toBe(false)

      gqlFailure('x')
      gqlFetch.mockResolvedValueOnce(updated({ id: 'o-1', status: 'CANCELLED' }))
      await actions.confirmCancellation()
      expect(store.orders[0]?.status).toBe('CANCELLED')
      expect(actions.showCancelDialog.value).toBe(false)
    })

    it('says Mollie cannot refund this payment and the customer must be refunded by hand', async () => {
      const { actions, store } = selected({ status: 'PREPARING', isOnlinePayment: true })
      actions.openCancelDialog()
      gqlFetch.mockRejectedValue(gqlFailure('PAYMENT_NOT_REFUNDABLE'))

      await actions.confirmCancellation()

      expect(toasts()).toEqual([{ title: 'orders.errors.paymentNotRefundable', color: 'error' }])
      expect(actions.showCancelDialog.value).toBe(true)
      expect(store.orders[0]?.status).toBe('PREPARING')
    })

    it('is "cancelling" while the request is in flight: no second request, the dialog cannot be dismissed', async () => {
      const onDone = vi.fn()
      const { actions } = selected({ status: 'PENDING' }, { onDone })
      actions.openCancelDialog()
      let answer: (value: unknown) => void = () => {}
      gqlFetch.mockReturnValue(
        new Promise((resolve) => {
          answer = resolve
        }),
      )

      const first = actions.confirmCancellation()
      expect(actions.isCancelling.value).toBe(true)
      await actions.confirmCancellation()
      expect(gqlFetch).toHaveBeenCalledOnce()

      // "Back" and the sheet's dismissal do nothing while the cancellation is on its way.
      actions.cancelCancellation()
      expect(actions.showCancelDialog.value).toBe(true)

      answer(updated({ id: 'o-1', status: 'CANCELLED' }))
      await first
      expect(actions.isCancelling.value).toBe(false)
      expect(actions.showCancelDialog.value).toBe(false)
      expect(onDone).toHaveBeenCalledExactlyOnceWith('cancel')
    })

    it('is not "cancelling" any more after a failure, so the staff can go back or confirm again', async () => {
      const { actions } = selected({ status: 'PENDING' })
      actions.openCancelDialog()
      gqlFetch.mockRejectedValue(new Error('network'))
      await actions.confirmCancellation()
      expect(actions.isCancelling.value).toBe(false)
      actions.cancelCancellation()
      expect(actions.showCancelDialog.value).toBe(false)
    })

    it('keeps the dialog open and shows an error toast when the cancellation fails', async () => {
      const onDone = vi.fn()
      const { actions, store } = selected({ status: 'PENDING' }, { onDone })
      actions.openCancelDialog()
      gqlFetch.mockRejectedValue(new Error('network'))

      await actions.confirmCancellation()

      expect(actions.showCancelDialog.value).toBe(true)
      expect(store.orders[0]?.status).toBe('PENDING')
      expect(onDone).not.toHaveBeenCalled()
      expect(toasts()).toEqual([{ title: 'orders.errors.updateFailed', color: 'error' }])
    })
  })
})
