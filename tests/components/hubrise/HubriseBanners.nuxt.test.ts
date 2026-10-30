// components/hubrise/HubriseBanners.vue: the banners of utils/hubrise.ts as alerts, each with the button of its action.
// Run: `vp test run tests/components/hubrise/HubriseBanners.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { describe, expect, it, vi } from 'vite-plus/test'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { statusBanners } from '~/utils/hubrise'
import { makeStatus } from '../../fixtures/hubrise'

vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

// Compiled once at load: the first mount would otherwise eat the test timeout.
const Banners = (await import('~/components/hubrise/HubriseBanners.vue')).default

const mountBanners = (banners: ReturnType<typeof statusBanners>, props = {}) =>
  mountSuspended(Banners, { props: { banners, ...props } })

describe('HubriseBanners', () => {
  it('renders nothing without a banner', async () => {
    const wrapper = await mountBanners([])
    expect(wrapper.find('[data-banner]').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('shows each banner with its message, errors as alerts and the others as status', async () => {
    const wrapper = await mountBanners(
      statusBanners(
        makeStatus({
          authErrorAt: '2026-10-24T10:00:00Z',
          catalogDirection: 'IMPORT',
          catalogUpdateAvailable: true,
        }),
      ),
    )
    const error = wrapper.find('[data-banner="authError"]')
    expect(error.attributes('role')).toBe('alert')
    expect(error.text()).toContain('hubrise.banners.authError')
    expect(error.text()).toContain('hubrise.actions.reconnect')
    const info = wrapper.find('[data-banner="updateAvailable"]')
    expect(info.attributes('role')).toBe('status')
  })

  it('formats the date of the message in Brussels time', async () => {
    const wrapper = await mountBanners(
      statusBanners(makeStatus({ authErrorAt: '2026-10-24T10:00:00Z' })),
    )
    expect(wrapper.text()).toMatch(/"since":"[^"]*12:00/u)
  })

  it('tells which banner asked when its button is clicked', async () => {
    const banners = statusBanners(makeStatus({ relinkRequired: true }))
    const wrapper = await mountBanners(banners)
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('action')).toEqual([[banners[0]]])
  })

  it('shows no button for a banner without action', async () => {
    const wrapper = await mountBanners(
      statusBanners(
        makeStatus({ catalogDirection: 'PUBLISH', publish: { accountCatalogDetected: true } }),
      ),
    )
    expect(wrapper.find('[data-banner="accountCatalog"]').find('button').exists()).toBe(false)
  })

  it('shows a spinner on the button of the action running', async () => {
    const banners = statusBanners(makeStatus({ relinkRequired: true }))
    const wrapper = await mountBanners(banners, { busyAction: 'forgetLinks' })
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
  })
})
