# Unit tests and coverage

Unit tests run with Vite+ (`vp test run`, vitest 5 inside). They cover the **TypeScript** of the dashboard: `composables`,
`stores`, `plugins`, `middleware`, `utils` and `server`. `.vue` pages,
layouts and components are not part of the unit metric.

```bash
pnpm test                                          # all projects
pnpm exec vp test run tests/composables                 # one folder / file
pnpm exec vp test run -t "removes the line"             # by test title
pnpm exec vp test run --project unit                    # only the plain-node project (fastest, no Nuxt boot)
pnpm exec vp test run --sequence.shuffle --sequence.seed=7   # random order: the suite must pass in any order
pnpm test:coverage                             # coverage + thresholds (what CI runs); report in coverage/
```

`coverage/lcov-report/index.html` is the browsable report. The thresholds in `vite.config.ts`
(`test.coverage.thresholds`) only ever go up: a global floor of 99 % (so that one new defensive line somewhere does not
fail CI), and one per file for the critical flows (`criticalFiles`: auth, the GraphQL client, the orders store and the
order logic, money, the HubRise logic `utils/hubrise.ts` and its four composables: status, settings, catalog import, publish): held at what they reach: 100 % lines, statements, functions and branches,
except one file: `utils/utils.ts` has 96 % of its branches, because of the `?? 1970` / `?? 0`
fallbacks of `shiftBrusselsDate` / `timeToRFC3339` after `split`, which only run for a malformed date string.

The pure logic that used to sit in the big pages lives in `utils/` (`orders`, `coupons`, `settings`, `money`, `authReturn`,
`graphqlUpload`) and in composables (`useLoginFlow`); the pages are thin and a mount test per page (`tests/pages/`) checks
that they are wired to it, submits included (coupon create / update payloads, the settings save bar, the product image upload through `$api`).

pnpm: the repo pins `packageManager` pnpm 12.15.0 and `devEngines.packageManager` accepts `^12.15.0` (`onFail: error`); install the pinned one with `corepack enable` or `npm install -g pnpm@12.15.0`.

## Where tests go and how they are named

Tests live under `tests/`, mirroring the source folder (`composables/useOidc.ts` is tested by
`tests/composables/useOidc.nuxt.test.ts`). They cannot sit next to the sources: Nuxt scans `composables/`, `plugins/`,
`middleware/` and `stores/` and would register a test file there. One test file per module: add the case to the file that
exists. The suffix picks the environment (the vitest "project"):

| Suffix           | Project | Environment                              | For                                                                  |
| ---------------- | ------- | ---------------------------------------- | -------------------------------------------------------------------- |
| `*.test.ts`      | `unit`  | plain Node, no Nuxt                      | pure code: `utils/`, stores without auto-imports                     |
| `*.nuxt.test.ts` | `nuxt`  | the real dashboard Nuxt app in happy-dom | composables, plugins, route middleware, stores that use auto-imports |

Prefer the lightest project that works. Always `import { describe, expect, it, vi } from 'vite-plus/test'` (the lint rule
`prefer-vite-plus-imports` enforces it). `~` and `@` resolve in every project.

Every project resets spies, stubbed globals and stubbed env after each test (`restoreMocks`, `unstubGlobals`,
`unstubEnvs`), and unmounts every mounted component (`tests/support/vue.ts`). Whatever else a test overrides (a property of
`window`, `navigator`, `process.env.TZ`, a module-level state), it puts back itself. The suite must pass in any order
(`--sequence.shuffle`) and needs per-file isolation.

Shared helpers live in `tests/`:

- `tests/fixtures/dashboard.ts`: `makeOrder`, `makeOrderItem`, `makeProduct`, `makeCategory`, `makeAddress`, `makeCustomer`, `makeUser`
- `tests/support/flags.ts`: `setFlags({ server, client, dev })`, see "SSR-only and dev-only code"
- `tests/support/*`: setup files of the projects (no network, flag reset, Nuxt ready), `nuxtProject.ts` (the Nuxt project and its runtime config)
- `tests/helpers/`: `i18n.ts` (a `t` that returns the key), `gqlFetch.ts` (swap `$gqlFetch`), `mountComposable.ts`, `fakeOidc.ts`
  (oidc-client-ts's `UserManager`, to run the real `useOidc` over a fake Zitadel), `settle.ts`

## The `nuxt` project: composables, stores, plugins, middleware

`@nuxt/test-utils` boots the real app (auto-imports, Pinia, i18n, runtime config) once per test file. Real is the default:
use the real stores, real `useState`, real i18n and localised paths, real runtime config, and mock only the boundaries.

```ts
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
```

| Need           | How                                                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime config | Fixed values from `tests/support/nuxtProject.ts` (`https://dash.test`, `https://api.dash.test/api/v1`...), whatever a developer has exported. A test reads what it asserts from `useRuntimeConfig()`; the object is mutable, put it back after |
| `$fetch`       | `const $fetchMock = vi.hoisted(() => vi.fn()); mockNuxtImport('$fetch', () => $fetchMock)`                                                                                                                                                     |
| `$gqlFetch`    | wrap `useNuxtApp` with `withGqlFetch` (it is a read-only getter on the app), see `tests/helpers/gqlFetch.ts`                                                                                                                                   |
| Navigation     | `mockNuxtImport('navigateTo', () => navigateTo)`, or `vi.mock('nuxt/app', ...)` when the file imports it from `'nuxt/app'` (the auth middleware)                                                                                               |
| i18n           | `vi.mock('vue-i18n', ...)` with `fakeI18n`: a test asserts WHICH message key was chosen, not its wording                                                                                                                                       |
| OIDC (Zitadel) | `vi.mock('~/composables/useOidc', () => ({ useOidc: () => oidcMock }))`; to run the REAL `useOidc`, fake only the UserManager: `vi.mock('oidc-client-ts', async () => (await import('../helpers/fakeOidc')).oidcClientTsFake())`               |
| Time           | `vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime(...)`; restore with `vi.useRealTimers()`. Never sleep. A timezone: `process.env.TZ = 'Asia/Kolkata'` (restore it)                                                               |

`vi.mock` / `mockNuxtImport` are hoisted: the values they use must come from `vi.hoisted(...)`. A module that is mocked
must be imported **after** the mocks: `const { default: plugin } = await import('~/plugins/gqlFetch')`.

A composable with module-level state (the OIDC user manager and renewal promise, the shared WebSocket client) is loaded
fresh per test: `vi.resetModules()` then `await import(...)` (see `useOidc.nuxt.test.ts`, `useGqlSubscription.nuxt.test.ts`).
`mountComposable` runs a composable inside a real component (`onMounted`, `onScopeDispose`...).

A plugin file default-exports `defineNuxtPlugin(fn)`, which is the function itself: call it and read what it returns
(`{ provide: { gqlFetch } }`). Route middleware is the same: call it with a fake `to`.

## SSR-only and dev-only code

Nuxt replaces `import.meta.server`, `import.meta.client` and `import.meta.dev` with constants at build time, which makes one
side of every `if (import.meta.server)` unreachable. The dashboard is a SPA (`ssr: false`), but the plugins keep their
server branches. In the projects, the sources of the app are rewritten so each flag first reads a per-test override.
Defaults: browser (`client` true, `server` false, `dev` false).

```ts
import { setFlags } from '../support/flags'
it('does not touch localStorage during SSR', () => {
  setFlags({ server: true }) // also sets client: false; reset automatically after each test
})
```

This is a hybrid, not a server render: it proves the server BRANCH does the right thing, not that nothing touches the DOM.

## The network is closed

`tests/support/noNetwork.ts` makes any `fetch`/`$fetch` to a host other than localhost fail with
`Unmocked network request blocked in unit tests`. A test that reaches Zitadel, the API or S3 is wrong: mock the boundary.

## Writing good tests (the review bar)

- Assert behaviour: return values, state, calls made with the right arguments, errors surfaced. A test that only calls a
  function to light up lines is rejected.
- Critical flows (auth, the GraphQL client, orders) cover every branch, error paths included.
- Deterministic and fast: no real network, no sleeps, no dependence on test order or on the current date or timezone.
- Don't change production behaviour for testability. A branch that cannot be reached is dead code: report it instead of
  adding an ignore comment.
- A suspected product bug is pinned with a `NOTE:` test title and a comment, and reported; a real bug gets a `fix(...)` commit.

## End-to-end tests (Playwright, mock backend)

`e2e/` runs the real production build of the dashboard in a browser against an in-repo mock of tsb-service and a fake
Zitadel: no secret, no database, no network. It covers what the unit tests cannot see because it needs the pages, the
router, the WebSocket and the API to work together: signing in with the e-mailed code, the orders board (desktop kanban
and slideover, phone list and order page) with the status changes and the mutations they send, editing a product, creating
a coupon.

```bash
pnpm exec playwright test                      # builds the app, starts the mock and the build, runs both projects
E2E_SKIP_BUILD=1 pnpm exec playwright test     # reuse .output (built with the env of playwright.config.ts)
E2E_REUSE=1 pnpm exec playwright test          # reuse a mock / app already listening on 8200 / 3300
pnpm exec playwright test --project=mobile     # `mobile-*.spec.ts` on a Pixel 5; `desktop` runs the other specs on 1440 x 900
```

- Import `test` / `expect` from `e2e/support/test.ts`, never from `@playwright/test`: its fixtures reset the mock before every
  test, keep the browser off the internet and FAIL a passing test when the page asked the mock for an operation or a field it
  does not implement (the mock lags the dashboard: add it to `e2e/mock/resolvers.ts` or `e2e/mock/state.ts`).
- `authenticatedPage` is a signed-in staff member (a faked oidc-client-ts session); `page` is anonymous. `mock` arranges
  (`mock.failOperation('updateOrder', { code })`, `mock.newOrder(seed)`) and inspects (`mock.operations('updateOrder')` lists
  the calls with their arguments).
- Labels come from `locales/fr.json` through `message('orders.status.preparing')`, so a renamed label fails the spec that
  needs it instead of being copied into it.
- The mock has no schema: its resolvers are plain functions and the selection set is projected onto what they return.
  What each part does is in the header comment of `e2e/mock/*.ts`.
- CI runs this as the `e2e` job of `ci.yml`.
