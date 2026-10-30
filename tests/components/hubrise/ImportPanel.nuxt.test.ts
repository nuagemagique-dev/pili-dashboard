// components/hubrise/ImportPanel.vue: adopting the existing SKUs (LINK_ONLY) and importing the HubRise catalog (FULL):
// a preview, the diff, the confirmation a mass retirement needs, the result. The GraphQL transport is the boundary.
// Run: `vp test run tests/components/hubrise/ImportPanel.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#imports'
import { gqlFailure, makeCatalogChange, makeDiff, makeStatus } from '../../fixtures/hubrise'
import { hubriseApi } from '../../helpers/hubriseApi'
import { settle } from '../../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())
const toastAdd = vi.hoisted(() => vi.fn())

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
mockNuxtImport('useToast', () => () => ({ add: toastAdd }))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

// Compiled once at load: the first mount would otherwise eat the test timeout.
const Panel = (await import('~/components/hubrise/ImportPanel.vue')).default

const api = hubriseApi(gqlFetch)

const syncResult = (over = {}) => ({
  mode: 'FULL',
  applied: true,
  pendingReview: false,
  failedBatches: [],
  diff: makeDiff({ changes: [] }),
  ...over,
})

const mountPanel = async (status = makeStatus({ catalogDirection: 'IMPORT' })) => {
  const wrapper = await mountSuspended(Panel, { props: { status } })
  await settle()
  return wrapper
}

const button = (wrapper: Awaited<ReturnType<typeof mountPanel>>, text: string) =>
  wrapper.findAll('button').find((b) => b.text() === text)

beforeEach(() => {
  vi.resetAllMocks()
  clearNuxtState('pili-hubrise-status')
  api.install()
  api.clear()
  api.answer('HubriseStatus', { hubriseStatus: makeStatus() })
  api.answer('PreviewHubriseCatalogSync', { previewHubriseCatalogSync: makeDiff() })
  api.answer('SyncHubriseCatalog', { syncHubriseCatalog: syncResult() })
})

describe('modes', () => {
  it('offers adoption and the full import, starting with adoption', async () => {
    const wrapper = await mountPanel()
    const radios = wrapper.findAll('[role="radio"]')
    expect(radios.map((r) => r.text())).toEqual([
      'hubrise.import.modes.LINK_ONLY',
      'hubrise.import.modes.FULL',
    ])
    expect(radios[0]!.attributes('aria-checked')).toBe('true')
    expect(wrapper.text()).toContain('hubrise.import.intro.IMPORT')
    expect(wrapper.text()).toContain('hubrise.import.modeHint.LINK_ONLY')
  })

  it('only adopts while the dashboard owns the menu', async () => {
    const wrapper = await mountPanel(makeStatus({ catalogDirection: 'PUBLISH' }))
    expect(wrapper.findAll('[role="radio"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('hubrise.import.intro.PUBLISH')
  })

  it('moves to adoption when the owner of the menu changes to the dashboard', async () => {
    const wrapper = await mountPanel()
    await wrapper.findAll('[role="radio"]')[1]!.trigger('click')
    expect(wrapper.text()).toContain('hubrise.import.modeHint.FULL')
    await wrapper.setProps({ status: makeStatus({ catalogDirection: 'PUBLISH' }) })
    expect(wrapper.text()).toContain('hubrise.import.modeHint.LINK_ONLY')
  })

  it('keeps the mode when the owner changes between two that offer it', async () => {
    const wrapper = await mountPanel()
    await wrapper.findAll('[role="radio"]')[1]!.trigger('click')
    await wrapper.setProps({ status: makeStatus({ catalogDirection: 'NONE' }) })
    expect(wrapper.text()).toContain('hubrise.import.modeHint.FULL')
  })

  it('forgets the diff when the mode changes', async () => {
    const wrapper = await mountPanel()
    await button(wrapper, 'hubrise.import.preview')!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('hubrise.import.linked')
    await wrapper.findAll('[role="radio"]')[1]!.trigger('click')
    expect(wrapper.text()).not.toContain('hubrise.import.linked')
  })
})

describe('preview and apply', () => {
  it('previews adoption with its own mode and applies it', async () => {
    const wrapper = await mountPanel()
    expect(button(wrapper, 'hubrise.import.apply.LINK_ONLY')).toBeUndefined()
    await button(wrapper, 'hubrise.import.preview')!.trigger('click')
    await settle()
    expect(api.calls('PreviewHubriseCatalogSync')).toEqual([{ mode: 'LINK_ONLY' }])
    await button(wrapper, 'hubrise.import.apply.LINK_ONLY')!.trigger('click')
    await settle()
    expect(api.calls('SyncHubriseCatalog')).toEqual([{ mode: 'LINK_ONLY', confirmRetire: false }])
    expect(toastAdd).toHaveBeenCalledWith({ title: 'hubrise.import.applied', color: 'success' })
    expect(wrapper.emitted('applied')).toHaveLength(1)
    expect(wrapper.text()).toContain('hubrise.import.applied')
  })

  it('previews a full import as a dry run', async () => {
    const wrapper = await mountPanel()
    await wrapper.findAll('[role="radio"]')[1]!.trigger('click')
    await button(wrapper, 'hubrise.import.preview')!.trigger('click')
    await settle()
    expect(api.calls('PreviewHubriseCatalogSync')).toEqual([{ mode: 'DRY_RUN' }])
    expect(button(wrapper, 'hubrise.import.apply.FULL')).toBeDefined()
  })

  it('lists the changes of the diff', async () => {
    api.answer('PreviewHubriseCatalogSync', {
      previewHubriseCatalogSync: makeDiff({
        changes: [
          makeCatalogChange({ action: 'RETIRE', name: 'Old roll', fields: [] }),
          makeCatalogChange({ action: 'CREATE', name: 'New roll', key: 'n' }),
        ],
        warnings: [{ code: 'W', key: null, message: 'careful' }],
        conflicts: [{ code: 'C', key: 'x', message: 'two matches' }],
        retiringProducts: 1,
      }),
    })
    const wrapper = await mountPanel()
    await button(wrapper, 'hubrise.import.preview')!.trigger('click')
    await settle()
    const text = wrapper.text()
    expect(text.indexOf('Old roll')).toBeLessThan(text.indexOf('New roll'))
    for (const part of ['careful', 'two matches', 'hubrise.import.retiring{"count":1}']) {
      expect(text).toContain(part)
    }
  })

  it('says there is nothing to change', async () => {
    api.answer('PreviewHubriseCatalogSync', {
      previewHubriseCatalogSync: makeDiff({ changes: [] }),
    })
    const wrapper = await mountPanel()
    await button(wrapper, 'hubrise.import.preview')!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('hubrise.import.noChanges')
  })

  it('does not preview while the integration is paused', async () => {
    const wrapper = await mountPanel(makeStatus({ enabled: false, catalogDirection: 'IMPORT' }))
    expect(button(wrapper, 'hubrise.import.preview')!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('hubrise.import.enableFirst')
  })

  it('shows why a preview failed', async () => {
    api.answer('PreviewHubriseCatalogSync', api.failWith(gqlFailure('HUBRISE_EMPTY_CATALOG')))
    const wrapper = await mountPanel()
    await button(wrapper, 'hubrise.import.preview')!.trigger('click')
    await settle()
    expect(wrapper.find('[role="alert"]').text()).toBe('hubrise.errors.emptyCatalog')
  })
})

describe('retirement confirmation', () => {
  const mass = makeDiff({ retiringProducts: 8, retireNeedsConfirm: true })

  const previewFull = async (wrapper: Awaited<ReturnType<typeof mountPanel>>) => {
    await wrapper.findAll('[role="radio"]')[1]!.trigger('click')
    await button(wrapper, 'hubrise.import.preview')!.trigger('click')
    await settle()
  }

  it('asks to confirm a mass retirement before the import can run', async () => {
    api.answer('PreviewHubriseCatalogSync', { previewHubriseCatalogSync: mass })
    const wrapper = await mountPanel()
    await previewFull(wrapper)
    const apply = button(wrapper, 'hubrise.import.apply.FULL')!
    expect(apply.attributes('disabled')).toBeDefined()
    await wrapper.find('button[role="checkbox"]').trigger('click')
    expect(button(wrapper, 'hubrise.import.apply.FULL')!.attributes('disabled')).toBeUndefined()
    await button(wrapper, 'hubrise.import.apply.FULL')!.trigger('click')
    await settle()
    expect(api.calls('SyncHubriseCatalog')).toEqual([{ mode: 'FULL', confirmRetire: true }])
  })

  it('asks for the confirmation when the server wants it although the diff did not', async () => {
    api.answer('SyncHubriseCatalog', api.failWith(gqlFailure('HUBRISE_RETIRE_CONFIRM_REQUIRED')))
    const wrapper = await mountPanel()
    await previewFull(wrapper)
    expect(wrapper.find('button[role="checkbox"]').exists()).toBe(false)
    await button(wrapper, 'hubrise.import.apply.FULL')!.trigger('click')
    await settle()
    expect(wrapper.find('button[role="checkbox"]').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').text()).toBe('hubrise.errors.retireConfirmRequired')
    expect(wrapper.emitted('applied')).toBeUndefined()
  })
})

describe('result', () => {
  const apply = async (result: object) => {
    api.answer('SyncHubriseCatalog', { syncHubriseCatalog: result })
    const wrapper = await mountPanel()
    await button(wrapper, 'hubrise.import.preview')!.trigger('click')
    await settle()
    await button(wrapper, 'hubrise.import.apply.LINK_ONLY')!.trigger('click')
    await settle()
    return wrapper
  }

  it('says the import waits for a person when it stopped at the threshold', async () => {
    const wrapper = await apply(syncResult({ applied: false, pendingReview: true }))
    expect(wrapper.text()).toContain('hubrise.import.waitingReview')
    expect(wrapper.emitted('applied')).toBeUndefined()
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it('says nothing was applied', async () => {
    const wrapper = await apply(syncResult({ applied: false }))
    expect(wrapper.text()).toContain('hubrise.import.notApplied')
  })

  it('lists the batches that were rolled back', async () => {
    const wrapper = await apply(syncResult({ failedBatches: ['Sushi', 'Maki'] }))
    expect(wrapper.text()).toContain('hubrise.import.failedBatches{"batches":"Sushi, Maki"}')
  })
})
