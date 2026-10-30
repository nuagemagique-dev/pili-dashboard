import { type Json, type OrderSeed, type Scenario, type MockState, orderOf } from './state.ts'

/*
 * The control API (`/__mock/*`) the specs use to arrange and inspect the mock; `MockControl` (support/control.ts) is its
 * typed test-side client. The fixture resets the mock before every test.
 */

export interface ControlResult {
  status: number
  body: unknown
}

export function handleControl(
  state: MockState,
  method: string,
  path: string,
  body: Json,
): ControlResult | null {
  if (path === '/__mock/health') return { status: 200, body: { ok: true } }

  if (path === '/__mock/state' && method === 'GET') {
    return {
      status: 200,
      body: {
        operations: state.operations,
        restCalls: state.restCalls,
        gaps: state.gaps,
        subscriptions: state.subscriptions(),
        orders: [...state.orders.values()],
        products: [...state.products.values()],
        coupons: [...state.coupons.values()],
        orderingEnabled: state.orderingEnabled,
      },
    }
  }

  if (path === '/__mock/reset' && method === 'POST') {
    state.reset()
    return { status: 200, body: { ok: true } }
  }

  if (path === '/__mock/scenario' && method === 'POST') {
    const patch = body as Partial<Scenario>
    const { operationFailures, ...rest } = patch
    Object.assign(state.scenario, rest)
    for (const [operation, failure] of Object.entries(operationFailures ?? {})) {
      state.scenario.operationFailures[operation] = failure ?? undefined
    }
    return { status: 200, body: { ok: true } }
  }

  // A new order arrives (the kitchen's bell): pushed to the open board as `orderCreated`.
  if (path === '/__mock/orders' && method === 'POST') {
    const seed = body as unknown as OrderSeed
    const order = orderOf(seed)
    state.orders.set(seed.id, order)
    state.publish('orderCreated', order)
    return { status: 200, body: { id: seed.id } }
  }

  return null
}
