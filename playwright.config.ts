import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import type { MockOptions } from './e2e/support/test'

/*
 * The dashboard against a mock tsb-service, no secret, database or Zitadel:
 *
 *   pnpm exec playwright test   builds the app, starts the mock + the production build, runs the specs
 *   E2E_SKIP_BUILD=1 ...         reuse the last build in .output (it must have been built with this file's env)
 *   E2E_REUSE=1 ...              reuse a mock / app already listening (local iteration)
 *
 * The webServers are a mock (e2e/mock/server.ts: GraphQL over HTTP and graphql-transport-ws, fake Zitadel, OTP endpoints)
 * and a PRODUCTION build of the dashboard whose API, WebSocket and Zitadel URLs all point at that mock. Two projects:
 * a desktop browser (the kanban board and the order slideover) and a phone (the mobile list and the order page).
 * The build overwrites .output and .nuxt: do not run it next to `nuxt dev`.
 */
const appPort = 3300
const mockPort = 8200
const env = {
  DASHBOARD_BASE_URL: `http://localhost:${appPort}`,
  API_BASE_URL: `http://localhost:${mockPort}/api/v1`,
  S3_BUCKET_URL: `http://localhost:${mockPort}`,
  GRAPHQL_WS_URL: `ws://localhost:${mockPort}/api/v1/graphql`,
  ZITADEL_AUTHORITY: `http://localhost:${mockPort}/zitadel`,
  ZITADEL_CLIENT_ID: 'e2e-client',
}
const reuse = Boolean(process.env.E2E_REUSE)
const appDir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/u, '')
const build = 'node node_modules/nuxt/bin/nuxt.mjs build'
const serve = 'node .output/server/index.mjs'

export default defineConfig<{ mockOptions: MockOptions }>({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One mock holds the state of the running test: tests run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${appPort}`,
    mockOptions: {
      url: `http://localhost:${mockPort}`,
      oidcAuthority: env.ZITADEL_AUTHORITY,
      oidcClientId: env.ZITADEL_CLIENT_ID,
    },
    locale: 'fr-BE',
    extraHTTPHeaders: { 'Accept-Language': 'fr-BE,fr;q=0.9' },
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: '**/mobile-*.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: '**/mobile-*.spec.ts',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: [
    {
      command: `node ${appDir}/e2e/mock/server.ts`,
      env: { MOCK_PORT: String(mockPort) },
      url: `http://localhost:${mockPort}/__mock/health`,
      reuseExistingServer: reuse,
      timeout: 30_000,
      stdout: 'pipe',
    },
    {
      command: process.env.E2E_SKIP_BUILD ? serve : `${build} && ${serve}`,
      cwd: appDir,
      env: { ...env, NITRO_PORT: String(appPort), NITRO_HOST: '127.0.0.1' },
      url: `http://localhost:${appPort}/fr/auth/login`,
      reuseExistingServer: reuse,
      timeout: 300_000,
      stdout: 'ignore',
    },
  ],
})
