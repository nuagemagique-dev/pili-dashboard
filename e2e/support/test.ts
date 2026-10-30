import { type Page, test as base, expect } from '@playwright/test'
import { MockControl } from './control'
import { fakeOidcEntry } from './session'

/*
 * Shared `test` of the dashboard specs.
 *
 * - `mock` (a MockControl) arranges and inspects the mock backend.
 * - Every test starts from the mock's defaults, the browser is kept off the internet (fonts, icons), and a passing test
 *   still fails when the dashboard used API the mock does not implement (the mock lags the dashboard: add the field or
 *   operation to e2e/mock/resolvers.ts rather than letting the page get a silent null).
 * - `authenticatedPage` is a staff member who is already signed in (a faked oidc-client-ts session); `page` is anonymous.
 */
export interface MockOptions {
  url: string
  /* ZITADEL_AUTHORITY / ZITADEL_CLIENT_ID the build under test was made with. */
  oidcAuthority: string
  oidcClientId: string
}

export const test = base.extend<{
  mockOptions: MockOptions
  mock: MockControl
  mockLifecycle: void
  authenticatedPage: Page
}>({
  mockOptions: [
    { url: 'http://localhost:8200', oidcAuthority: 'x', oidcClientId: 'x' },
    { option: true },
  ],

  /*
   * `page.goto` resolves once the app is mounted: the window's load event can fire before the SPA has started (the entry
   * script is a module and Nuxt's plugins are async), and a click straight after `goto` would then land on an empty shell.
   * A page that never starts FAILS here with that said, instead of timing out somewhere downstream.
   */
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page)
    page.goto = async (url, options) => {
      const response = await goto(url, options)
      try {
        await page.waitForFunction(
          () => {
            const root = document.getElementById('__nuxt')
            return !root || '__vue_app__' in root
          },
          undefined,
          { timeout: 10_000 },
        )
      } catch (error) {
        throw new Error(
          `page.goto(${url}): the app did not start within 10 s (no Vue app on #__nuxt at ${page.url()})`,
          { cause: error },
        )
      }
      return response
    }
    await use(page)
  },

  mock: async ({ mockOptions }, use) => {
    await use(new MockControl(mockOptions.url))
  },

  mockLifecycle: [
    async ({ mock, context }, use, testInfo) => {
      await mock.reset()
      await context.route(
        (url) => !['localhost', '127.0.0.1'].includes(url.hostname),
        (route) => route.abort('blockedbyclient'),
      )
      // What the browser complained about, attached to a failing test (a failed chunk or API call explains most flakes).
      const problems: string[] = []
      context.on('page', (opened) => {
        opened.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
        opened.on('console', (message) => {
          if (message.type() === 'error') problems.push(`console.error: ${message.text()}`)
        })
        opened.on('requestfailed', (request) =>
          problems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`),
        )
      })
      await use()
      if (testInfo.status !== testInfo.expectedStatus && problems.length > 0) {
        await testInfo.attach('browser-problems', {
          body: problems.join('\n'),
          contentType: 'text/plain',
        })
      }
      if (testInfo.status === testInfo.expectedStatus) {
        const { gaps } = await mock.state()
        expect(gaps, 'the dashboard used API the mock does not implement (e2e/mock)').toEqual([])
      }
    },
    { auto: true },
  ],

  authenticatedPage: async ({ page, context, mockOptions }, use) => {
    const entry = fakeOidcEntry(mockOptions.oidcAuthority, mockOptions.oidcClientId)
    // Seeded before any page script, once per browser context (a later sign-out must not be undone by the next navigation).
    await context.addInitScript((pair: [string, string]) => {
      if (localStorage.getItem('e2e-session-seeded')) return
      localStorage.setItem(pair[0], pair[1])
      localStorage.setItem('e2e-session-seeded', '1')
    }, entry)
    await use(page)
  },
})

export { expect } from '@playwright/test'
