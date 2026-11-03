// Orders store: the live order board's state (list + which new orders the staff has seen), shared by the orders page,
// the tab bar badge and the "new order" alert.
// Run: `vp test run tests/stores/orders.test.ts`.
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { createPinia, setActivePinia } from 'pinia'
import { useOrdersStore } from '~/stores/orders'
import { makeOrder } from '../fixtures/dashboard'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('setOrders', () => {
  it('replaces the list and acknowledges every loaded order (only later arrivals are "new")', () => {
    const store = useOrdersStore()
    store.setOrders([makeOrder({ id: 'o-1' }), makeOrder({ id: 'o-2' })])
    expect(store.orders.map((o) => o.id)).toEqual(['o-1', 'o-2'])
    expect([...store.acknowledgedOrderIds]).toEqual(['o-1', 'o-2'])

    store.setOrders([makeOrder({ id: 'o-3' })])
    expect(store.orders.map((o) => o.id)).toEqual(['o-3'])
    // Acknowledgements of orders that left the list are kept: a reload never makes an old order "new" again.
    expect(store.acknowledgedOrderIds.has('o-1')).toBe(true)
    expect(store.acknowledgedOrderIds.has('o-3')).toBe(true)
  })
})

describe('addOrder', () => {
  it('puts a subscription order first and leaves it unacknowledged', () => {
    const store = useOrdersStore()
    store.setOrders([makeOrder({ id: 'o-1' })])
    store.addOrder(makeOrder({ id: 'o-2' }))
    expect(store.orders.map((o) => o.id)).toEqual(['o-2', 'o-1'])
    expect(store.acknowledgedOrderIds.has('o-2')).toBe(false)
  })
})

describe('updateOrder', () => {
  it('merges the given fields into the order with the same id, keeping the others', () => {
    const store = useOrdersStore()
    store.setOrders([makeOrder({ id: 'o-1', status: 'PENDING', totalPrice: '12.50' })])
    store.updateOrder({ id: 'o-1', status: 'PREPARING' })
    expect(store.orders[0]).toMatchObject({ id: 'o-1', status: 'PREPARING', totalPrice: '12.50' })
  })

  it('replaces the array entry (a new object), so watchers on the list see the change', () => {
    const store = useOrdersStore()
    store.setOrders([makeOrder({ id: 'o-1' })])
    const [before] = store.orders
    store.updateOrder({ id: 'o-1', status: 'PREPARING' })
    expect(store.orders[0]).not.toBe(before)
  })

  it('ignores an id that is not in the list', () => {
    const store = useOrdersStore()
    store.setOrders([makeOrder({ id: 'o-1', status: 'PENDING' })])
    store.updateOrder({ id: 'unknown', status: 'CANCELLED' })
    expect(store.orders).toHaveLength(1)
    expect(store.orders[0]?.status).toBe('PENDING')
  })

  it('only touches the matching order', () => {
    const store = useOrdersStore()
    store.setOrders([makeOrder({ id: 'o-1' }), makeOrder({ id: 'o-2' })])
    store.updateOrder({ id: 'o-2', status: 'CANCELLED' })
    expect(store.orders.map((o) => o.status)).toEqual(['PENDING', 'CANCELLED'])
  })
})

describe('acknowledgeOrder and unacknowledgedPendingCount', () => {
  it('counts the pending orders that arrived live and were not opened yet', () => {
    const store = useOrdersStore()
    store.setOrders([makeOrder({ id: 'old', status: 'PENDING' })])
    expect(store.unacknowledgedPendingCount).toBe(0)

    store.addOrder(makeOrder({ id: 'new-1', status: 'PENDING' }))
    store.addOrder(makeOrder({ id: 'new-2', status: 'PENDING' }))
    expect(store.unacknowledgedPendingCount).toBe(2)

    store.acknowledgeOrder('new-1')
    expect(store.unacknowledgedPendingCount).toBe(1)
  })

  it('does not count orders that are no longer pending', () => {
    const store = useOrdersStore()
    store.addOrder(makeOrder({ id: 'new-1', status: 'PENDING' }))
    store.addOrder(makeOrder({ id: 'new-2', status: 'PREPARING' }))
    expect(store.unacknowledgedPendingCount).toBe(1)

    store.updateOrder({ id: 'new-1', status: 'CANCELLED' })
    expect(store.unacknowledgedPendingCount).toBe(0)
  })

  it('acknowledging twice is harmless', () => {
    const store = useOrdersStore()
    store.addOrder(makeOrder({ id: 'new-1' }))
    store.acknowledgeOrder('new-1')
    store.acknowledgeOrder('new-1')
    expect(store.acknowledgedOrderIds.size).toBe(1)
    expect(store.unacknowledgedPendingCount).toBe(0)
  })
})
