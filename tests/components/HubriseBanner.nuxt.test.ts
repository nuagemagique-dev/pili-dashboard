// components/HubriseBanner.vue: the banner above every page when HubRise refuses the token or rows are parked; it points
// to the HubRise page and is not shown there. The GraphQL transport is the boundary.
// Run: `vp test run tests/components/HubriseBanner.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#imports'
import { makeStatus } from '../fixtures/hubrise'
import { hubriseApi } from '../helpers/hubriseApi'
import { settle } from '../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())
const current = vi.hoisted(() => ({ path: '/fr/orders' }))

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
// The auth middleware would send a bare mount to the login page: the banner only reads the path.
mockNuxtImport('useRoute', () => () => ({ path: current.path }))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

// Compiled once at load: the first mount would otherwise eat the test timeout.
const Banner = (await import('~/components/HubriseBanner.vue')).default

const api = hubriseApi(gqlFetch)

const mountBanner = async (status: ReturnType<typeof makeStatus>, route = '/fr/orders') => {
  api.answer('HubriseStatus', { hubriseStatus: status })
  current.path = route
  const wrapper = await mountSuspended(Banner)
  await settle()
  return wrapper
}

beforeEach(() => {
  vi.resetAllMocks()
  clearNuxtState('pili-hubrise-status')
  api.install()
  api.clear()
})

describe('HubriseBanner', () => {
  it('warns that HubRise refuses the connection and links to the HubRise page', async () => {
    const wrapper = await mountBanner(makeStatus({ authErrorAt: '2026-10-24T10:00:00Z' }))
    expect(wrapper.attributes('role')).toBe('alert')
    expect(wrapper.text()).toContain('hubrise.layoutBanner.authError')
    expect(wrapper.attributes('href')).toContain('/hubrise')
  })

  it('warns about the rows HubRise refused, with their number', async () => {
    const wrapper = await mountBanner(makeStatus({ backlog: { parked: 3 } }))
    expect(wrapper.text()).toContain('hubrise.layoutBanner.parked{"count":3}#3')
  })

  it('stays quiet when all is well, when HubRise is absent and before the status loads', async () => {
    expect((await mountBanner(makeStatus())).text()).toBe('')
    expect(
      (await mountBanner(makeStatus({ available: false, backlog: { parked: 3 } }))).text(),
    ).toBe('')
  })

  it('is not shown on the HubRise page, which says it already', async () => {
    const wrapper = await mountBanner(makeStatus({ backlog: { parked: 3 } }), '/fr/hubrise')
    expect(wrapper.text()).toBe('')
  })

  it('stays empty when the status cannot be read', async () => {
    api.answer('HubriseStatus', api.failWith([{ message: 'x', extensions: { code: 'FORBIDDEN' } }]))
    const wrapper = await mountSuspended(Banner)
    await settle()
    expect(wrapper.text()).toBe('')
  })
})
