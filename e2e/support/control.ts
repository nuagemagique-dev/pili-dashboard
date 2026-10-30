import type { Json, OperationFailure, OperationLog, OrderSeed, RestLog } from '../mock/state.ts'

export interface MockSnapshot {
  operations: OperationLog[]
  restCalls: RestLog[]
  gaps: string[]
  subscriptions: string[]
  orders: Json[]
  products: Json[]
  coupons: Json[]
  orderingEnabled: boolean
}

/*
 * Test-side handle on the mock's control API (mock/control.ts). The Playwright fixture resets the mock before every
 * test, so a spec only states what differs from the defaults.
 */
export class MockControl {
  readonly url: string

  constructor(url: string) {
    this.url = url.replace(/\/+$/u, '')
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.url}/__mock${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(`mock ${method} ${path}: ${response.status} ${await response.text()}`)
    }
    return (await response.json()) as T
  }

  state(): Promise<MockSnapshot> {
    return this.call('GET', '/state')
  }

  async reset(): Promise<void> {
    await this.call('POST', '/reset', {})
  }

  /** Makes a root query / mutation answer a GraphQL error with that code, or `null` to lift it. */
  async failOperation(operation: string, failure: OperationFailure | null): Promise<void> {
    await this.call('POST', '/scenario', { operationFailures: { [operation]: failure } })
  }

  /** `me` answers a user who is not an admin. */
  async nonAdmin(): Promise<void> {
    await this.call('POST', '/scenario', { nonAdmin: true })
  }

  /** A new order arrives: pushed to the open board as `orderCreated`. */
  async newOrder(seed: OrderSeed): Promise<void> {
    await this.call('POST', '/orders', seed)
  }

  /** The GraphQL calls of one operation, in order. */
  async operations(op: string): Promise<OperationLog[]> {
    return (await this.state()).operations.filter((entry) => entry.op === op)
  }

  /** Resolves once a page is subscribed to the topic (a push only reaches a page that has subscribed). */
  async waitForSubscription(topic: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if ((await this.state()).subscriptions.includes(topic)) return
      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })
    }
    throw new Error(`nobody subscribed to ${topic} within ${timeoutMs} ms`)
  }
}
