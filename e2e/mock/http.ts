import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import { type RequestContext, execute, parseSubscription } from './graphql.ts'
import { handleRest, handleZitadel } from './auth.ts'
import { type Json, MockState } from './state.ts'
import { WebSocketServer } from 'ws'
import { handleControl } from './control.ts'
import { operations } from './resolvers.ts'

/*
 * The mock tsb-service: GraphQL over HTTP (POST /api/v1/graphql), graphql-transport-ws on the same path, the sign-in
 * endpoints and fake Zitadel (auth.ts), the control API (/__mock/*) and fake product images.
 */

export interface MockServer {
  state: MockState
  server: Server
  url: string
  close: () => Promise<void>
}

// A 1x1 PNG: every product image.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
}

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS })
  res.end(JSON.stringify(body))
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString()
    })
    req.on('end', () => {
      resolve(data)
    })
  })

const parseJson = (text: string): Json | null => {
  if (!text.trim()) return {}
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' ? (value as Json) : null
  } catch {
    return null
  }
}

const headerOf = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

const isBearer = (value: string | undefined): boolean => /^Bearer\s+\S+/u.test(value ?? '')

export function createMockServer(port: number): Promise<MockServer> {
  const state = new MockState()
  const selfUrl = `http://localhost:${port}`

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', selfUrl)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return
    }

    if (url.pathname.startsWith('/__mock/')) {
      const body = parseJson(req.method === 'GET' ? '' : await readBody(req))
      if (body === null) {
        sendJson(res, 400, { error: 'bad json' })
        return
      }
      const result = handleControl(state, req.method ?? 'GET', url.pathname, body)
      sendJson(res, result?.status ?? 404, result?.body ?? { error: 'not found' })
      return
    }

    if (await handleZitadel(req, res, url, `${selfUrl}/zitadel`, state)) return
    if (await handleRest(req, res, url, async () => parseJson(await readBody(req)), state)) return

    if (url.pathname.startsWith('/images/') || url.pathname.startsWith('/s3/')) {
      res.writeHead(200, { 'Content-Type': 'image/png', ...CORS })
      res.end(PNG)
      return
    }

    if (url.pathname === '/api/v1/graphql' && req.method === 'POST') {
      const body = parseJson(await readBody(req))
      if (!body || typeof body.query !== 'string') {
        sendJson(res, 400, { errors: [{ message: 'bad request' }] })
        return
      }
      const context: RequestContext = {
        state,
        authenticated: isBearer(headerOf(req, 'authorization')),
      }
      const result = await execute(operations, context, {
        query: body.query,
        variables: (body.variables as Json | undefined) ?? {},
      })
      sendJson(res, 200, result)
      return
    }

    sendJson(res, 404, {
      errors: [{ message: `mock: no route ${req.method ?? 'GET'} ${url.pathname}` }],
    })
  }

  const server = createServer((req, res) => {
    void handle(req, res)
  })

  // Graphql-transport-ws
  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (socket) => {
    let authenticated = false
    const unsubscribe = new Map<string, () => void>()
    const send = (message: unknown) => {
      socket.send(JSON.stringify(message))
    }

    socket.on('message', (raw) => {
      let message: { type?: string; id?: string; payload?: Json }
      try {
        message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : '')
      } catch {
        return
      }
      switch (message.type) {
        case 'connection_init': {
          const header: unknown = message.payload?.Authorization
          authenticated = isBearer(typeof header === 'string' ? header : undefined)
          send({ type: 'connection_ack' })
          break
        }
        case 'ping':
          send({ type: 'pong' })
          break
        case 'subscribe': {
          const id = message.id ?? ''
          const parsed = parseSubscription(operations, state, {
            query: typeof message.payload?.query === 'string' ? message.payload.query : '',
            variables: (message.payload?.variables as Json | undefined) ?? {},
          })
          if (!parsed?.definition) {
            state.noteGap(`subscription ${parsed?.name ?? '(unparsable)'}`)
            send({
              type: 'error',
              id,
              payload: [
                {
                  message: 'mock: no such subscription',
                  extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
                },
              ],
            })
            break
          }
          state.log({ op: parsed.name, kind: 'subscription', args: {}, authenticated })
          const { definition } = parsed
          unsubscribe.set(
            id,
            state.subscribe(parsed.name, (event) => {
              send({
                type: 'next',
                id,
                payload: { data: parsed.render(definition.payload(event)) },
              })
            }),
          )
          break
        }
        case 'complete':
          unsubscribe.get(message.id ?? '')?.()
          unsubscribe.delete(message.id ?? '')
          break
        case undefined:
        default:
          break
      }
    })
    socket.on('close', () => {
      for (const stop of unsubscribe.values()) stop()
      unsubscribe.clear()
    })
  })
  server.on('upgrade', (req, socket, head) => {
    if (!(req.url ?? '').startsWith('/api/v1/graphql')) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({
        state,
        server,
        url: selfUrl,
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate()
            server.close(() => {
              done()
            })
            server.closeAllConnections()
          }),
      })
    })
  })
}
