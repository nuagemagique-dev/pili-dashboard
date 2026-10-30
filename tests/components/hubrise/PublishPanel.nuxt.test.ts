// components/hubrise/PublishPanel.vue: the status of the publishing (phase, countdown to the debounced publish, last
// publish, counts), the publish banners with their actions, the images switch and the way into the preview dialog.
// The GraphQL transport is the boundary; the clock is fake. Run: `vp test run tests/components/hubrise/PublishPanel.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#imports'
import { gqlFailure, makePreview, makeStatus } from '../../fixtures/hubrise'
import { bodyButton, bodyText } from '../../helpers/dom'
import { hubriseApi } from '../../helpers/hubriseApi'
import { settle } from '../../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())
const toastAdd = vi.hoisted(() => vi.fn())

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
mockNuxtImport('useToast', () => () => ({ add: toastAdd }))
mockNuxtImport('useIsMobile', () => () => ref(false))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

// Compiled once at load: the first mount would otherwise eat the test timeout.
const Panel = (await import('~/components/hubrise/PublishPanel.vue')).default

const api = hubriseApi(gqlFetch)

const NOW = '2026-10-24T10:00:00Z'

const publishing = (publish = {}, rest = {}) =>
  makeStatus({
    catalogDirection: 'PUBLISH',
    publish: {
      enabled: true,
      active: true,
      firstPublishConfirmedAt: '2026-10-23T10:00:00Z',
      ...publish,
    },
    ...rest,
  })

const mountPanel = async (status = publishing()) => {
  const wrapper = await mountSuspended(Panel, { props: { status } })
  await settle()
  return wrapper
}

beforeEach(() => {
  vi.resetAllMocks()
  document.body.innerHTML = ''
  clearNuxtState('pili-hubrise-status')
  api.install()
  api.clear()
  api.answer('HubriseStatus', { hubriseStatus: makeStatus() })
  api.answer('PreviewHubriseCatalogPublish', { previewHubriseCatalogPublish: makePreview() })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('status', () => {
  it('says the menu is up to date', async () => {
    const wrapper = await mountPanel(publishing({ lastPublishedAt: NOW, publishedProducts: 12 }))
    expect(wrapper.text()).toContain('hubrise.publish.phase.upToDate')
    expect(wrapper.find('[data-testid="hubrise-publish-last"]').text()).toMatch(/12:00/u)
    expect(wrapper.text()).toContain('hubrise.publish.productsCount{"published":12,"pending":0}')
  })

  it('says nothing was published yet', async () => {
    const wrapper = await mountPanel()
    expect(wrapper.find('[data-testid="hubrise-publish-last"]').text()).toBe(
      'hubrise.publish.never',
    )
  })

  it('explains that the first publish waits for the admin', async () => {
    const wrapper = await mountPanel(publishing({ awaitingFirstPublish: true }))
    expect(wrapper.text()).toContain('hubrise.publish.phase.awaitingFirst')
    expect(wrapper.text()).toContain('hubrise.publish.awaitingFirst')
  })

  it('says publishing is paused when it cannot run', async () => {
    const wrapper = await mountPanel(publishing({ active: false }))
    expect(wrapper.text()).toContain('hubrise.publish.phase.paused')
  })

  it('says a publish is running', async () => {
    const wrapper = await mountPanel(publishing({ publishing: true }))
    expect(wrapper.text()).toContain('hubrise.publish.phase.publishing')
  })

  it('counts down to the next publish, second by second', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date(NOW))
    const wrapper = await mountPanel(
      publishing({ pending: true, nextPublishAt: '2026-10-24T10:01:15Z', pendingProducts: 2 }),
    )
    const next = () => wrapper.find('[data-testid="hubrise-publish-next"]').text()
    expect(next()).toBe('hubrise.publish.nextIn{"time":"1:15"}')
    await vi.advanceTimersByTimeAsync(5000)
    expect(next()).toBe('hubrise.publish.nextIn{"time":"1:10"}')
    expect(wrapper.text()).toContain('"pending":2')
  })

  it('does not know when the next publish is', async () => {
    const wrapper = await mountPanel(publishing({ pending: true, nextPublishAt: null }))
    expect(wrapper.find('[data-testid="hubrise-publish-next"]').text()).toBe(
      'hubrise.publish.nextUnknown',
    )
  })

  it('stops the clock with the panel', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const wrapper = await mountPanel()
    const before = vi.getTimerCount()
    wrapper.unmount()
    expect(vi.getTimerCount()).toBeLessThan(before)
  })
})

describe('publish banners', () => {
  it('shows the external change and clears it when acknowledged', async () => {
    api.answer('AcknowledgeHubriseExternalChange', {
      acknowledgeHubriseExternalChange: publishing({ externalChangeAt: null }),
    })
    const wrapper = await mountPanel(publishing({ externalChangeAt: '2026-10-24T09:00:00Z' }))
    const banner = wrapper.find('[data-banner="externalChange"]')
    expect(banner.text()).toContain('hubrise.banners.externalChange')
    await banner.find('button').trigger('click')
    await settle()
    expect(api.calls('AcknowledgeHubriseExternalChange')).toHaveLength(1)
  })

  it('opens the preview from the removals confirmation banner', async () => {
    const wrapper = await mountPanel(
      publishing({ lastErrorCode: 'REMOVALS_NEED_CONFIRM', lastError: 'hold' }),
    )
    const banner = wrapper.find('[data-banner="removalsConfirm"]')
    expect(banner.exists()).toBe(true)
    expect(wrapper.find('[data-banner="publishError"]').exists()).toBe(false)
    await banner.find('button').trigger('click')
    await settle()
    expect(api.calls('PreviewHubriseCatalogPublish').length).toBeGreaterThan(0)
  })

  it('shows why acknowledging failed', async () => {
    api.answer(
      'AcknowledgeHubriseExternalChange',
      api.failWith(gqlFailure('HUBRISE_NOT_PUBLISH_MODE')),
    )
    const wrapper = await mountPanel(publishing({ externalChangeAt: '2026-10-24T09:00:00Z' }))
    await wrapper.find('[data-banner="externalChange"] button').trigger('click')
    await settle()
    expect(wrapper.find('[role="alert"]:not([data-banner])').text()).toBe(
      'hubrise.errors.notPublishMode',
    )
  })

  it('asks its owner to reconnect for the write scope', async () => {
    const wrapper = await mountPanel(publishing({ needsReconnectForWrite: true }))
    await wrapper.find('[data-banner="reconnectForWrite"] button').trigger('click')
    expect(wrapper.emitted('reconnect')).toHaveLength(1)
  })

  it('shows the error of the last publish', async () => {
    const wrapper = await mountPanel(
      publishing({ lastErrorCode: 'REJECTED', lastError: 'name too long' }),
    )
    expect(wrapper.find('[data-banner="publishError"]').text()).toContain(
      'hubrise.publish.errors.rejected{"detail":"name too long"}',
    )
  })

  it('does not show the banners that belong to the page', async () => {
    const wrapper = await mountPanel(publishing({}, { authErrorAt: NOW }))
    expect(wrapper.find('[data-banner="authError"]').exists()).toBe(false)
  })
})

describe('images', () => {
  it('turns the upload of the images on', async () => {
    api.answer('UpdateHubriseSettings', {
      updateHubriseSettings: publishing({ publishImages: true }),
    })
    const wrapper = await mountPanel()
    await wrapper.find('button[role="switch"]').trigger('click')
    await settle()
    expect(api.calls('UpdateHubriseSettings')).toEqual([{ input: { publishImages: true } }])
  })

  it('shows why the switch was refused', async () => {
    api.answer('UpdateHubriseSettings', api.failWith(gqlFailure('HUBRISE_DIRECTION_CONFLICT')))
    const wrapper = await mountPanel()
    await wrapper.find('button[role="switch"]').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('hubrise.errors.directionConflict')
  })

  it('clears the previous refusal with the next try', async () => {
    api.answer('UpdateHubriseSettings', api.failWith(gqlFailure('HUBRISE_DIRECTION_CONFLICT')))
    const wrapper = await mountPanel()
    await wrapper.find('button[role="switch"]').trigger('click')
    await settle()
    api.answer('UpdateHubriseSettings', {
      updateHubriseSettings: publishing({ publishImages: true }),
    })
    await wrapper.find('button[role="switch"]').trigger('click')
    await settle()
    expect(wrapper.text()).not.toContain('hubrise.errors.directionConflict')
  })

  it('is locked while the integration is paused', async () => {
    const wrapper = await mountPanel(publishing({}, { enabled: false }))
    expect(wrapper.find('button[role="switch"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('hubrise.import.enableFirst')
  })
})

describe('the preview button', () => {
  const previewButton = (wrapper: Awaited<ReturnType<typeof mountPanel>>) =>
    wrapper.findAll('button').find((b) => b.text() === 'hubrise.publish.previewButton')!

  it('opens the dialog and tells that the publish ran', async () => {
    api.answer('PublishHubriseCatalog', {
      publishHubriseCatalog: { published: true, queued: false, status: publishing().publish },
    })
    const wrapper = await mountPanel()
    await previewButton(wrapper).trigger('click')
    await settle()
    expect(bodyText()).toContain('hubrise.preview.title')
    bodyButton('hubrise.preview.confirm')!.click()
    await settle()
    expect(toastAdd).toHaveBeenCalledWith({ title: 'hubrise.publish.published', color: 'success' })
  })

  it('tells that the publish was queued', async () => {
    api.answer('PublishHubriseCatalog', {
      publishHubriseCatalog: { published: false, queued: true, status: publishing().publish },
    })
    const wrapper = await mountPanel()
    await previewButton(wrapper).trigger('click')
    await settle()
    bodyButton('hubrise.preview.confirm')!.click()
    await settle()
    expect(toastAdd).toHaveBeenCalledWith({ title: 'hubrise.publish.queued', color: 'success' })
  })

  it.each([
    ['paused', { enabled: false }, {}],
    ['not connected', { connected: false }, {}],
    ['without write scope', {}, { needsReconnectForWrite: true }],
  ])('is disabled when %s', async (_name, statusOver, publishOver) => {
    const wrapper = await mountPanel(publishing(publishOver, statusOver))
    expect(previewButton(wrapper).attributes('disabled')).toBeDefined()
  })
})
