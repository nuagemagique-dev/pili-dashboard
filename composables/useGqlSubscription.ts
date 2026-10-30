// Composables/useGqlSubscription.ts
import { onScopeDispose, ref } from 'vue'
import type { Client } from 'graphql-ws/client'
import { useRuntimeConfig } from '#imports'
import { hasText, isRecord } from '~/utils/guards'

/**
 * What a failed subscription hands over, as an Error with a readable message. graphql-ws gives an Error, a close event
 * (`code`, `reason`) or, for execution errors, an ARRAY of GraphQL errors: `String()` of that is "[object Object]", so
 * the message of the first error is used.
 */
const toError = (e: unknown): Error => {
  if (e instanceof Error) return e
  const first: unknown = Array.isArray(e) ? e[0] : e
  if (first instanceof Error) return first
  if (typeof first === 'object' && first !== null) {
    const { message, code, reason } = first as {
      message?: unknown
      code?: unknown
      reason?: unknown
    }
    if (typeof message === 'string' && message) return new Error(message)
    if (typeof code === 'number') {
      return new Error(
        `Connection closed (${code})${typeof reason === 'string' && reason ? `: ${reason}` : ''}`,
      )
    }
  }
  return new Error(String(e))
}

/** The part of the socket graphql-ws reports as connected that the pong watchdog uses. */
interface WatchedSocket {
  readyState: number
  close: (code?: number, reason?: string) => void
}

const isWatchedSocket = (value: unknown): value is WatchedSocket =>
  isRecord(value) && typeof value.readyState === 'number' && typeof value.close === 'function'

let wsClient: Client | null = null
let wsClientPromise: Promise<Client> | null = null

/*
 * Dispose the shared client without scheduling reconnects. Called from a
 * `pagehide` handler so the server sees a clean WS close frame on tab close
 * or navigation, instead of an abrupt TCP close that cancels in-flight
 * resolvers and produces lib/pq "canceling statement" errors.
 */
const disposeSharedClient = () => {
  void wsClient?.dispose()
  wsClient = null
  wsClientPromise = null
}

let globalListenersBound = false
const ensureGlobalListeners = () => {
  if (globalListenersBound || !import.meta.client) return
  globalListenersBound = true
  window.addEventListener('pagehide', disposeSharedClient)
}

const getWsClient = (): Promise<Client> => {
  if (wsClient) return Promise.resolve(wsClient)
  wsClientPromise ??= Promise.all([
    import('graphql-ws/client'),
    import('~/composables/useOidc'),
  ]).then(([{ createClient }, { useOidc }]) => {
    const cfg = useRuntimeConfig()
    const { getAccessToken, isRenewalUnavailable } = useOidc()

    /*
     * `keepAlive` only schedules pings: detection of a dead server
     * requires our own pong watchdog. Track the active socket so we
     * can force-close it when the server stops responding.
     */
    let activeSocket: WatchedSocket | null = null
    let pongTimer: ReturnType<typeof setTimeout> | null = null

    const client = createClient({
      url: cfg.public.graphqlWs,
      connectionParams: async () => {
        const token = await getAccessToken()
        return hasText(token) ? { Authorization: `Bearer ${token}` } : {}
      },
      /*
       * Ping every 12s; with the pong watchdog below, dropped
       * connections (network blip, proxy idle timeout) surface
       * within ~17s instead of waiting for the next outbound msg.
       */
      keepAlive: 12_000,
      on: {
        connected: (socket) => {
          activeSocket = isWatchedSocket(socket) ? socket : null
        },
        closed: () => {
          if (pongTimer) {
            clearTimeout(pongTimer)
            pongTimer = null
          }
          activeSocket = null
        },
        ping: (received) => {
          if (received) return
          if (pongTimer) clearTimeout(pongTimer)
          pongTimer = setTimeout(() => {
            if (activeSocket?.readyState === WebSocket.OPEN) {
              activeSocket.close(4408, 'Pong timeout')
            }
          }, 5_000)
        },
        pong: (received) => {
          if (received && pongTimer) {
            clearTimeout(pongTimer)
            pongTimer = null
          }
        },
      },
      retryAttempts: Infinity,
      retryWait: async (retries) => {
        const delay = Math.min(1000 * 2 ** retries, 30_000)
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delay)
        })
        const token = await getAccessToken()
        if (hasText(token)) return
        /*
         * No token: either the session is over (stop: graphql-ws gives up and the login flow takes over), or it is
         * kept but Zitadel / the backend cannot be reached right now (keep backing off: only an offline -> online
         * event of the browser would otherwise restart the subscriptions, and that does not fire when the outage
         * is not on the device's side). There is no live-updates indicator in the UI, so this is only logged.
         */
        if (!isRenewalUnavailable()) throw new Error('No valid auth token')
        console.warn('Live updates paused: the session cannot be renewed right now, retrying')
      },
    })
    wsClient = client
    return client
  })
  return wsClientPromise
}

export function useGqlSubscription<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
) {
  const data = ref<T | null>()
  const error = ref<Error | null>(null)
  let stop: () => void = () => {}
  // Set when the owning scope ends, so a subscription whose client was still loading is never started afterwards.
  let disposed = false

  // Track if we've genuinely gone offline
  let wentOffline = false

  const startSubscription = () => {
    getWsClient()
      .then((client) => {
        if (disposed) return
        stop = client.subscribe<T>(
          {
            query,
            variables,
          },
          {
            next: (msg) => {
              if (msg.data !== undefined) data.value = msg.data
            },
            error: (e) => {
              error.value = toError(e)
            },
            complete: () => {},
          },
        )
      })
      .catch((e) => {
        error.value = toError(e)
      })
  }

  const handleOffline = () => {
    wentOffline = true
    error.value = new Error('Lost internet connection')
  }

  const handleOnline = () => {
    if (!wentOffline) return
    wentOffline = false
    error.value = null
    // Re-establish subscription (graphql-ws auto-reconnects the WebSocket)
    stop()
    startSubscription()
  }

  if (import.meta.client) {
    ensureGlobalListeners()
    startSubscription()

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
  }

  onScopeDispose(() => {
    disposed = true
    stop()
    if (import.meta.client) {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  })

  const closeAll = () => {
    void wsClient?.dispose()
    wsClient = null
    wsClientPromise = null
  }

  return {
    data,
    error,
    // A function that calls the current unsubscribe: `stop` is reassigned once the client is ready, so returning the
    // variable itself would hand callers the initial no-op for good.
    stop: () => {
      stop()
    },
    closeAll,
  }
}
