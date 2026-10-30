// pages/more.vue (the phone's Plus tab): the HubRise entry exists only where HubRise is configured, and shows its state.
// Run: `vp test run tests/pages/more.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#imports'
import { makeStatus } from '../fixtures/hubrise'
import { hubriseApi } from '../helpers/hubriseApi'
import { settle } from '../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
mockNuxtImport('useGqlSubscription', () => () => ({ data: ref<unknown>(null) }))
mockNuxtImport('useIsMobile', () => () => ref(true))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

// Compiled once at load: the first mount would otherwise eat the test timeout.
const Page = (await import('~/pages/more.vue')).default

const api = hubriseApi(gqlFetch)

const mountMore = async (status: ReturnType<typeof makeStatus>) => {
  api.answer('HubriseStatus', { hubriseStatus: status })
  const wrapper = await mountSuspended(Page)
  await settle()
  await settle()
  return wrapper
}

const hubriseLink = (wrapper: Awaited<ReturnType<typeof mountMore>>) =>
  wrapper.find('a[href$="/hubrise"]')

beforeEach(() => {
  vi.resetAllMocks()
  clearNuxtState('pili-hubrise-status')
  api.install()
  api.clear()
  api.answer('MoreCounts', { customerStats: { summary: { totalCustomers: 4 } }, coupons: [] })
  api.answer('AssistantConnection', { assistantConnection: null })
  api.answer('OrderingStatus', { restaurantConfig: { orderingEnabled: true } })
})

describe('the HubRise entry of the Plus tab', () => {
  it('is there when HubRise is configured, with the state of the integration', async () => {
    const wrapper = await mountMore(makeStatus())
    expect(hubriseLink(wrapper).text()).toContain('navigation.hubrise')
    expect(hubriseLink(wrapper).text()).toContain('hubrise.status.enabled')
  })

  it('says the integration is paused or not connected', async () => {
    expect(hubriseLink(await mountMore(makeStatus({ enabled: false }))).text()).toContain(
      'hubrise.status.paused',
    )
    clearNuxtState('pili-hubrise-status')
    expect(hubriseLink(await mountMore(makeStatus({ connected: false }))).text()).toContain(
      'hubrise.status.notConnected',
    )
  })

  it('is hidden when the server has no HubRise', async () => {
    const wrapper = await mountMore(makeStatus({ available: false }))
    expect(hubriseLink(wrapper).exists()).toBe(false)
  })
})
