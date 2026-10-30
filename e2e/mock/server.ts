import { createMockServer } from './http.ts'

/*
 * Entry point: `node e2e/mock/server.ts` (Node 22.18+ runs TypeScript directly).
 *
 *   MOCK_PORT  port to listen on (required)
 */
const port = Number(process.env.MOCK_PORT)
if (!Number.isInteger(port) || port <= 0) {
  console.error('MOCK_PORT must be a port number')
  process.exit(1)
}

const mock = await createMockServer(port)
console.log(`[mock] dashboard backend listening on ${mock.url}`)

const stop = () => {
  void mock.close().then(() => process.exit(0))
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
