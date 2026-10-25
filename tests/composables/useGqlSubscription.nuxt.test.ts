// useGqlSubscription: GraphQL subscriptions over ONE shared graphql-ws client (browser only) authenticated with the OIDC
// token, kept alive by a ping/pong watchdog and retried with backoff, restarted when the network comes back, and closed
// cleanly when the page goes away. The graphql-ws client (the WebSocket) and the OIDC client are the boundaries,
// replaced by fakes; window events are captured and fired by hand; timers are fake when a test is about time.
// Run: `vp test run tests/composables/useGqlSubscription.nuxt.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { effectScope } from 'vue'
import { useRuntimeConfig } from '#imports'
import { setFlags } from '../support/flags'
import { settle } from '../helpers/settle'

interface Sink {
  next: (message: { data?: unknown }) => void
  error: (error: unknown) => void
  complete: () => void
}
interface ClientEvents {
  connected: (socket: unknown) => void
  closed: () => void
  ping: (received: boolean) => void
  pong: (received: boolean) => void
}
interface ClientOptions {
  url: string
  connectionParams: () => Promise<Record<string, unknown>>
  keepAlive: number
  retryAttempts: number
  retryWait: (retries: number) => Promise<void>
  on: ClientEvents
}

class FakeClient {
  readonly subscriptions: {
    payload: { query: string; variables: unknown }
    sink: Sink
    unsubscribe: () => void
  }[] = []
  readonly dispose = vi.fn(() => Promise.resolve())
  constructor(readonly options: ClientOptions) {}
  subscribe = vi.fn((payload: { query: string; variables: unknown }, sink: Sink) => {
    const unsubscribe = vi.fn()
    this.subscriptions.push({ payload, sink, unsubscribe })
    return unsubscribe
  })
}

const h = vi.hoisted(() => ({
  clients: [] as unknown[],
  createClient: vi.fn(),
  getAccessToken: vi.fn<() => Promise<string | null>>(),
  isRenewalUnavailable: vi.fn<() => boolean>(),
}))
vi.mock('graphql-ws/client', () => ({ createClient: h.createClient }))
vi.mock('~/composables/useOidc', () => ({
  useOidc: () => ({
    getAccessToken: h.getAccessToken,
    isRenewalUnavailable: h.isRenewalUnavailable,
  }),
}))

const clients = () => h.clients as FakeClient[]

/** The window listeners the module registers, captured and fired by hand. */
const listeners: Record<string, (event?: unknown) => void> = {}
const added: string[] = []
const removed: string[] = []

/** A fresh copy of the module (the shared client and the one-time listener are module state). */
async function load() {
  vi.resetModules()
  const { useGqlSubscription } = await import('~/composables/useGqlSubscription')
  const scopes: ReturnType<typeof effectScope>[] = []
  const subscribe = <T = unknown>(
    ...args: Parameters<typeof useGqlSubscription>
  ): ReturnType<typeof useGqlSubscription<T>> => {
    const scope = effectScope()
    scopes.push(scope)
    return scope.run(() => useGqlSubscription<T>(...args))!
  }
  return { subscribe, scopes }
}

const SUB = 'subscription OrderCreated { orderCreated { id } }'

beforeEach(() => {
  vi.resetAllMocks()
  h.clients.length = 0
  for (const key of Object.keys(listeners)) delete listeners[key]
  added.length = 0
  removed.length = 0
  h.createClient.mockImplementation((options: ClientOptions) => {
    const client = new FakeClient(options)
    h.clients.push(client)
    return client
  })
  h.getAccessToken.mockResolvedValue('token-1')
  h.isRenewalUnavailable.mockReturnValue(false)
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: unknown) => {
    added.push(type)
    listeners[type] = listener as (event?: unknown) => void
  }) as typeof window.addEventListener)
  vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string) => {
    removed.push(type)
  }) as typeof window.removeEventListener)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('subscribing', () => {
  it('opens one client for the GraphQL WebSocket URL and subscribes with the document and variables', async () => {
    const { subscribe } = await load()
    subscribe(SUB, { restaurantId: 'r-1' })
    await settle()

    expect(h.createClient).toHaveBeenCalledOnce()
    expect(clients()[0]!.options.url).toBe(useRuntimeConfig().public.graphqlWs)
    expect(clients()[0]!.subscriptions).toHaveLength(1)
    expect(clients()[0]!.subscriptions[0]!.payload).toEqual({
      query: SUB,
      variables: { restaurantId: 'r-1' },
    })
  })

  it('shares ONE client between subscriptions, also when they start at the same time', async () => {
    const { subscribe } = await load()
    subscribe(SUB)
    subscribe('subscription Other { other { id } }')
    await settle()
    subscribe(SUB)
    await settle()

    expect(h.createClient).toHaveBeenCalledOnce()
    expect(clients()[0]!.subscriptions).toHaveLength(3)
  })

  it('exposes the latest message as `data`', async () => {
    const { subscribe } = await load()
    const { data } = subscribe<{ orderCreated: { id: string } }>(SUB)
    await settle()
    const { sink } = clients()[0]!.subscriptions[0]!

    sink.next({ data: { orderCreated: { id: 'o-1' } } })
    expect(data.value).toEqual({ orderCreated: { id: 'o-1' } })
    sink.next({ data: { orderCreated: { id: 'o-2' } } })
    expect(data.value).toEqual({ orderCreated: { id: 'o-2' } })
  })

  it('ignores a message without data (e.g. only errors) and keeps the last value', async () => {
    const { subscribe } = await load()
    const { data } = subscribe<{ n: number }>(SUB)
    await settle()
    const { sink } = clients()[0]!.subscriptions[0]!

    sink.next({ data: { n: 1 } })
    sink.next({})
    expect(data.value).toEqual({ n: 1 })
  })

  it('exposes a stream error as an Error, wrapping what is not one', async () => {
    const { subscribe } = await load()
    const { error } = subscribe(SUB)
    await settle()
    const { sink } = clients()[0]!.subscriptions[0]!

    const failure = new Error('boom')
    sink.error(failure)
    expect(error.value).toBe(failure)
  })

  it('surfaces the message of the first error when graphql-ws hands over an array of GraphQL errors', async () => {
    const { subscribe } = await load()
    const { error } = subscribe(SUB)
    await settle()
    const { sink } = clients()[0]!.subscriptions[0]!

    sink.error([{ message: 'resolver failed' }, { message: 'second' }])
    expect(error.value).toBeInstanceOf(Error)
    expect(error.value?.message).toBe('resolver failed')
  })

  it('keeps an Error that comes in an array as it is', async () => {
    const { subscribe } = await load()
    const { error } = subscribe(SUB)
    await settle()
    const failure = new Error('inside an array')
    clients()[0]!.subscriptions[0]!.sink.error([failure])
    expect(error.value).toBe(failure)
  })

  it('surfaces the message of a single error object', async () => {
    const { subscribe } = await load()
    const { error } = subscribe(SUB)
    await settle()
    clients()[0]!.subscriptions[0]!.sink.error({ message: 'not authorised' })
    expect(error.value?.message).toBe('not authorised')
  })

  it.each([
    [{ code: 4403, reason: 'Forbidden' }, 'Connection closed (4403): Forbidden'],
    [{ code: 1006, reason: '' }, 'Connection closed (1006)'],
    [{ code: 1006 }, 'Connection closed (1006)'],
  ])('describes a close event %j', async (event, message) => {
    const { subscribe } = await load()
    const { error } = subscribe(SUB)
    await settle()
    clients()[0]!.subscriptions[0]!.sink.error(event)
    expect(error.value?.message).toBe(message)
  })

  it.each([
    ['an empty array', [], ''],
    ['an object without a message', { foo: 1 }, '[object Object]'],
    ['an empty message', [{ message: '' }], '[object Object]'],
    ['a string', 'plain failure', 'plain failure'],
    ['null', null, 'null'],
  ])('still gives an Error for %s', async (_name, value, message) => {
    const { subscribe } = await load()
    const { error } = subscribe(SUB)
    await settle()
    clients()[0]!.subscriptions[0]!.sink.error(value)
    expect(error.value).toBeInstanceOf(Error)
    expect(error.value?.message).toBe(message)
  })

  it('treats completion as a no-op', async () => {
    const { subscribe } = await load()
    const { data, error } = subscribe(SUB)
    await settle()
    clients()[0]!.subscriptions[0]!.sink.complete()
    expect(data.value).toBeUndefined()
    expect(error.value).toBeNull()
  })

  it('exposes the failure to open the client (e.g. the module cannot load) as an Error', async () => {
    h.createClient.mockImplementation(() => {
      throw new Error('bad url')
    })
    const { subscribe } = await load()
    const { error } = subscribe(SUB)
    await settle()
    expect(error.value?.message).toBe('bad url')
  })

  it('wraps a non-Error failure to open the client', async () => {
    h.createClient.mockImplementation(() => {
      throw 'bad url' // oxlint-disable-line no-throw-literal, typescript/only-throw-error -- a non-Error rejection is what is tested
    })
    const { subscribe } = await load()
    const { error } = subscribe(SUB)
    await settle()
    expect(error.value).toBeInstanceOf(Error)
    expect(error.value?.message).toBe('bad url')
  })
})

describe('the client configuration', () => {
  it('authenticates each connection with the current OIDC token', async () => {
    const { subscribe } = await load()
    subscribe(SUB)
    await settle()
    const { connectionParams } = clients()[0]!.options

    await expect(connectionParams()).resolves.toEqual({ Authorization: 'Bearer token-1' })
    h.getAccessToken.mockResolvedValue('token-2')
    await expect(connectionParams()).resolves.toEqual({ Authorization: 'Bearer token-2' })
  })

  it('connects without credentials when there is no session', async () => {
    h.getAccessToken.mockResolvedValue(null)
    const { subscribe } = await load()
    subscribe(SUB)
    await settle()
    await expect(clients()[0]!.options.connectionParams()).resolves.toEqual({})
  })

  it('pings every 12 seconds and retries forever', async () => {
    const { subscribe } = await load()
    subscribe(SUB)
    await settle()
    expect(clients()[0]!.options).toMatchObject({ keepAlive: 12_000, retryAttempts: Infinity })
  })
})

describe('the pong watchdog', () => {
  /** A socket that records being closed. */
  const socket = (readyState: number) => ({ readyState, close: vi.fn() })

  async function connected(readyState: number = WebSocket.OPEN) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { subscribe } = await load()
    subscribe(SUB)
    await settle()
    const { on } = clients()[0]!.options
    const sock = socket(readyState)
    on.connected(sock)
    return { on, sock }
  }

  it('closes a socket that does not answer a ping within 5 seconds (4408 Pong timeout)', async () => {
    const { on, sock } = await connected()
    on.ping(false)
    await vi.advanceTimersByTimeAsync(4999)
    expect(sock.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(sock.close).toHaveBeenCalledExactlyOnceWith(4408, 'Pong timeout')
  })

  it('is satisfied by a pong from the server', async () => {
    const { on, sock } = await connected()
    on.ping(false)
    on.pong(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sock.close).not.toHaveBeenCalled()
  })

  it('is not fooled by a pong we sent ourselves', async () => {
    const { on, sock } = await connected()
    on.ping(false)
    on.pong(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(sock.close).toHaveBeenCalledOnce()
  })

  it('ignores pings that come from the server (those are answered by the library)', async () => {
    const { on, sock } = await connected()
    on.ping(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sock.close).not.toHaveBeenCalled()
  })

  it('restarts the countdown on each ping we send', async () => {
    const { on, sock } = await connected()
    on.ping(false)
    await vi.advanceTimersByTimeAsync(3000)
    on.ping(false)
    await vi.advanceTimersByTimeAsync(3000)
    expect(sock.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(sock.close).toHaveBeenCalledOnce()
  })

  it('does not watch a connection that is not a socket', async () => {
    const { on, sock } = await connected()
    on.connected(null)
    on.ping(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(sock.close).not.toHaveBeenCalled()
  })

  it('does not close a socket that is no longer open', async () => {
    const { on, sock } = await connected(WebSocket.CLOSING)
    on.ping(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(sock.close).not.toHaveBeenCalled()
  })

  it('stops watching when the connection closes', async () => {
    const { on, sock } = await connected()
    on.ping(false)
    on.closed()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sock.close).not.toHaveBeenCalled()
  })

  it('has nothing to cancel on a close without a pending ping, and no socket to close after it', async () => {
    const { on, sock } = await connected()
    on.closed()
    on.ping(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(sock.close).not.toHaveBeenCalled()
  })

  it('a pong with nothing pending is harmless', async () => {
    const { on } = await connected()
    expect(() => {
      on.pong(true)
    }).not.toThrow()
  })
})

describe('reconnecting', () => {
  async function retry() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { subscribe } = await load()
    subscribe(SUB)
    await settle()
    return clients()[0]!.options.retryWait
  }

  it.each([
    [0, 1000],
    [1, 2000],
    [3, 8000],
    [4, 16_000],
    [5, 30_000],
    [12, 30_000],
  ])('waits 2^n seconds, at most 30: retry %i after %i ms', async (retries, delay) => {
    const retryWait = await retry()
    let done = false
    const waiting = retryWait(retries).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(delay - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(done).toBe(true)
  })

  it('refreshes the token after the wait and carries on while the session is valid', async () => {
    const retryWait = await retry()
    const waiting = retryWait(0)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(waiting).resolves.toBeUndefined()
    expect(h.getAccessToken).toHaveBeenCalled()
  })

  it('keeps retrying, and says so, while the session is kept but cannot be renewed right now', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const retryWait = await retry()
    h.getAccessToken.mockResolvedValue(null)
    h.isRenewalUnavailable.mockReturnValue(true)
    const waiting = retryWait(0)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(waiting).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toContain('Live updates paused')
  })

  it('stops retrying when no valid token is left (the session is over)', async () => {
    const retryWait = await retry()
    h.getAccessToken.mockResolvedValue(null)
    const waiting = retryWait(0)
    const outcome = expect(waiting).rejects.toThrow('No valid auth token')
    await vi.advanceTimersByTimeAsync(1000)
    await outcome
  })
})

describe('page and network lifecycle', () => {
  it('registers the pagehide listener once for all subscriptions', async () => {
    const { subscribe } = await load()
    subscribe(SUB)
    subscribe(SUB)
    await settle()
    expect(added.filter((type) => type === 'pagehide')).toHaveLength(1)
  })

  it('closes the shared client cleanly when the page is hidden, and a later subscription opens a new one', async () => {
    const { subscribe } = await load()
    subscribe(SUB)
    await settle()
    const [first] = clients()

    listeners.pagehide!()
    expect(first!.dispose).toHaveBeenCalledOnce()

    subscribe(SUB)
    await settle()
    expect(clients()).toHaveLength(2)
    expect(clients()[1]!.subscriptions).toHaveLength(1)
  })

  it('pagehide before any client exists is harmless', async () => {
    const { subscribe } = await load()
    subscribe(SUB)
    // The listener is bound synchronously; the client is still being created.
    expect(() => {
      listeners.pagehide!()
    }).not.toThrow()
    await settle()
  })

  it('shows "Lost internet connection" when the browser goes offline', async () => {
    const { subscribe } = await load()
    const { error } = subscribe(SUB)
    await settle()
    listeners.offline!()
    expect(error.value?.message).toBe('Lost internet connection')
  })

  it('re-subscribes when the browser comes back online after having been offline, clearing the error', async () => {
    const { subscribe } = await load()
    const { error } = subscribe(SUB, { a: 1 })
    await settle()
    const [client] = clients()
    const previous = client!.subscriptions[0]!

    listeners.offline!()
    listeners.online!()
    await settle()

    expect(error.value).toBeNull()
    expect(previous.unsubscribe).toHaveBeenCalledOnce()
    expect(client!.subscriptions).toHaveLength(2)
    expect(client!.subscriptions[1]!.payload).toEqual({ query: SUB, variables: { a: 1 } })
    expect(h.createClient).toHaveBeenCalledOnce()
  })

  it('ignores an online event when it never went offline', async () => {
    const { subscribe } = await load()
    const { error } = subscribe(SUB)
    await settle()
    const [client] = clients()
    error.value = new Error('something else')

    listeners.online!()
    await settle()

    expect(client!.subscriptions).toHaveLength(1)
    expect(error.value?.message).toBe('something else')
  })

  it('re-subscribes only once per offline period', async () => {
    const { subscribe } = await load()
    subscribe(SUB)
    await settle()
    listeners.offline!()
    listeners.online!()
    listeners.online!()
    await settle()
    expect(clients()[0]!.subscriptions).toHaveLength(2)
  })

  it('unsubscribes and stops listening when its scope ends', async () => {
    const { subscribe, scopes } = await load()
    subscribe(SUB)
    await settle()
    const { unsubscribe } = clients()[0]!.subscriptions[0]!

    scopes[0]!.stop()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(removed.sort()).toEqual(['offline', 'online'])
  })

  it('a scope that ends before the client is ready must not leave a live subscription behind', async () => {
    const { subscribe, scopes } = await load()
    subscribe(SUB)
    scopes[0]!.stop() // the component is gone before the WebSocket client resolved
    await settle()
    const { subscriptions } = clients()[0]!
    // Either it never subscribed, or whatever it subscribed was unsubscribed.
    for (const s of subscriptions) expect(s.unsubscribe).toHaveBeenCalledOnce()
  })

  it('returns a stop() that really unsubscribes', async () => {
    const { subscribe } = await load()
    const { stop } = subscribe(SUB)
    await settle()
    stop()
    expect(clients()[0]!.subscriptions[0]!.unsubscribe).toHaveBeenCalledOnce()
  })

  it('closeAll disposes the shared client; the next subscription opens a new one', async () => {
    const { subscribe } = await load()
    const { closeAll } = subscribe(SUB)
    await settle()
    const [first] = clients()

    closeAll()
    expect(first!.dispose).toHaveBeenCalledOnce()

    subscribe(SUB)
    await settle()
    expect(clients()).toHaveLength(2)
  })

  it('closeAll with no client open does nothing', async () => {
    const { subscribe } = await load()
    const { closeAll } = subscribe(SUB)
    expect(() => {
      closeAll()
    }).not.toThrow()
    await settle()
  })
})

describe('on the server', () => {
  beforeEach(() => {
    setFlags({ server: true })
  })

  it('never opens a WebSocket nor touches window listeners', async () => {
    const { subscribe, scopes } = await load()
    const { data, error } = subscribe(SUB)
    await settle()

    expect(h.createClient).not.toHaveBeenCalled()
    expect(added).toEqual([])
    expect(data.value).toBeUndefined()
    expect(error.value).toBeNull()

    scopes[0]!.stop()
    expect(removed).toEqual([])
  })
})
