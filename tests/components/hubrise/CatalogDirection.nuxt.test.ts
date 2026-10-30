// components/hubrise/CatalogDirection.vue: who owns the menu. Choosing a direction opens a confirmation (the text of
// the move, the acknowledgement for unpublished edits, the dry-run diff before an import) and only then switches.
// The GraphQL transport is the boundary. Run: `vp test run tests/components/hubrise/CatalogDirection.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#imports'
import { gqlFailure, makeCatalogChange, makeDiff, makeStatus } from '../../fixtures/hubrise'
import { bodyButton, bodyCheckbox, bodyText } from '../../helpers/dom'
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
const Direction = (await import('~/components/hubrise/CatalogDirection.vue')).default

const api = hubriseApi(gqlFetch)

const mountDirection = async (status = makeStatus()) => {
  const wrapper = await mountSuspended(Direction, { props: { status } })
  await settle()
  return wrapper
}

const choose = async (wrapper: Awaited<ReturnType<typeof mountDirection>>, direction: string) => {
  await wrapper.find(`[data-direction="${direction}"]`).trigger('click')
  await settle()
}

const clickBody = async (text: string) => {
  bodyButton(text)!.click()
  await settle()
}

beforeEach(() => {
  vi.resetAllMocks()
  document.body.innerHTML = ''
  clearNuxtState('pili-hubrise-status')
  api.install()
  api.clear()
  api.answer('HubriseStatus', { hubriseStatus: makeStatus() })
  api.answer('SetHubriseCatalogDirection', (variables: Record<string, unknown>) => ({
    setHubriseCatalogDirection: makeStatus({
      catalogDirection: variables.direction as 'NONE' | 'IMPORT' | 'PUBLISH',
    }),
  }))
  api.answer('PreviewHubriseCatalogSync', { previewHubriseCatalogSync: makeDiff() })
})

describe('the three owners', () => {
  it('marks the current one', async () => {
    const wrapper = await mountDirection(makeStatus({ catalogDirection: 'IMPORT' }))
    const checked = wrapper.findAll('[role="radio"]').map((r) => r.attributes('aria-checked'))
    expect(checked).toEqual(['false', 'true', 'false'])
    expect(wrapper.find('[data-direction="IMPORT"]').text()).toContain('hubrise.direction.current')
    expect(wrapper.text()).toContain('hubrise.direction.options.PUBLISH.description')
  })

  it('does nothing when the current one is chosen again', async () => {
    const wrapper = await mountDirection()
    await choose(wrapper, 'NONE')
    expect(bodyText()).not.toContain('hubrise.direction.dialogTitle')
  })
})

describe('switching to PUBLISH', () => {
  it('shows the confirmation of the move, then switches and tells the owner', async () => {
    const wrapper = await mountDirection()
    await choose(wrapper, 'PUBLISH')
    expect(bodyText()).toContain('hubrise.direction.confirm.noneToPublish')
    await clickBody('hubrise.direction.confirmButton')
    expect(api.calls('SetHubriseCatalogDirection')).toEqual([
      { direction: 'PUBLISH', acknowledgeLocalOverwrite: false },
    ])
    expect(toastAdd).toHaveBeenCalledWith({ title: 'hubrise.direction.changed', color: 'success' })
    expect(wrapper.emitted('changed')).toEqual([['PUBLISH']])
    expect(bodyText()).not.toContain('hubrise.direction.confirm.noneToPublish')
  })

  it('writes nothing when the confirmation is cancelled', async () => {
    const wrapper = await mountDirection()
    await choose(wrapper, 'PUBLISH')
    await clickBody('common.cancel')
    expect(api.calls('SetHubriseCatalogDirection')).toEqual([])
    expect(bodyText()).not.toContain('hubrise.direction.confirm.noneToPublish')
  })

  it('asks to reconnect first when the connection cannot write', async () => {
    const wrapper = await mountDirection(makeStatus({ publish: { needsReconnectForWrite: true } }))
    await choose(wrapper, 'PUBLISH')
    expect(wrapper.text()).toContain('hubrise.direction.blocked.reconnectRequired')
    expect(bodyText()).not.toContain('hubrise.direction.dialogTitle')
    const reconnect = wrapper
      .findAll('button')
      .find((b) => b.text() === 'hubrise.actions.reconnect')
    await reconnect!.trigger('click')
    expect(wrapper.emitted('reconnect')).toHaveLength(1)
  })

  it('says a switch needs a connection', async () => {
    const wrapper = await mountDirection(makeStatus({ connected: false }))
    await choose(wrapper, 'PUBLISH')
    expect(wrapper.text()).toContain('hubrise.direction.blocked.notConnected')
    expect(wrapper.findAll('button').some((b) => b.text() === 'hubrise.actions.reconnect')).toBe(
      false,
    )
  })

  it('forgets the notice once the current owner is clicked', async () => {
    const wrapper = await mountDirection(makeStatus({ connected: false }))
    await choose(wrapper, 'PUBLISH')
    await choose(wrapper, 'NONE')
    expect(wrapper.text()).not.toContain('hubrise.direction.blocked')
  })

  it('shows why the server refused', async () => {
    api.answer('SetHubriseCatalogDirection', api.failWith(gqlFailure('HUBRISE_RECONNECT_REQUIRED')))
    const wrapper = await mountDirection()
    await choose(wrapper, 'PUBLISH')
    await clickBody('hubrise.direction.confirmButton')
    expect(bodyText()).toContain('hubrise.errors.reconnectRequired')
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(toastAdd).not.toHaveBeenCalled()
  })
})

describe('leaving PUBLISH with edits waiting', () => {
  const waiting = () => makeStatus({ catalogDirection: 'PUBLISH', publish: { pending: true } })

  it('needs the acknowledgement that HubRise keeps its last version', async () => {
    const wrapper = await mountDirection(waiting())
    await choose(wrapper, 'NONE')
    expect(bodyText()).toContain('hubrise.direction.acknowledgeOverwrite')
    expect(bodyButton('hubrise.direction.confirmButton')!.disabled).toBe(true)
    bodyCheckbox()!.click()
    await settle()
    expect(bodyButton('hubrise.direction.confirmButton')!.disabled).toBe(false)
    await clickBody('hubrise.direction.confirmButton')
    expect(api.calls('SetHubriseCatalogDirection')).toEqual([
      { direction: 'NONE', acknowledgeLocalOverwrite: true },
    ])
  })

  it('asks for the acknowledgement when only the server knows about the edits', async () => {
    api.answer(
      'SetHubriseCatalogDirection',
      api.failWith(gqlFailure('HUBRISE_PUBLISH_PENDING_CHANGES')),
    )
    const wrapper = await mountDirection(makeStatus({ catalogDirection: 'PUBLISH' }))
    await choose(wrapper, 'NONE')
    expect(bodyCheckbox()).toBeNull()
    await clickBody('hubrise.direction.confirmButton')
    expect(bodyCheckbox()).not.toBeNull()
    expect(bodyButton('hubrise.direction.confirmButton')!.disabled).toBe(true)
    api.answer('SetHubriseCatalogDirection', { setHubriseCatalogDirection: makeStatus() })
    bodyCheckbox()!.click()
    await settle()
    await clickBody('hubrise.direction.confirmButton')
    expect(api.calls('SetHubriseCatalogDirection').at(-1)).toEqual({
      direction: 'NONE',
      acknowledgeLocalOverwrite: true,
    })
  })

  it('needs no acknowledgement when nothing waits', async () => {
    const wrapper = await mountDirection(makeStatus({ catalogDirection: 'PUBLISH' }))
    await choose(wrapper, 'NONE')
    expect(bodyCheckbox()).toBeNull()
    expect(bodyButton('hubrise.direction.confirmButton')!.disabled).toBe(false)
  })
})

describe('switching to IMPORT', () => {
  it('runs the dry run first and shows its diff, which the admin confirms', async () => {
    api.answer('PreviewHubriseCatalogSync', {
      previewHubriseCatalogSync: makeDiff({ changes: [makeCatalogChange({ name: 'Edamame' })] }),
    })
    const wrapper = await mountDirection()
    await choose(wrapper, 'IMPORT')
    expect(api.calls('PreviewHubriseCatalogSync')).toEqual([{ mode: 'DRY_RUN' }])
    expect(bodyText()).toContain('hubrise.direction.confirm.noneToImport')
    expect(bodyText()).toContain('Edamame')
    await clickBody('hubrise.direction.confirmButton')
    expect(api.calls('SetHubriseCatalogDirection')).toEqual([
      { direction: 'IMPORT', acknowledgeLocalOverwrite: false },
    ])
  })

  it('cannot confirm while the dry run is missing or failed', async () => {
    api.answer('PreviewHubriseCatalogSync', api.failWith(gqlFailure('HUBRISE_EMPTY_CATALOG')))
    const wrapper = await mountDirection()
    await choose(wrapper, 'IMPORT')
    expect(bodyText()).toContain('hubrise.errors.emptyCatalog')
    expect(bodyButton('hubrise.direction.confirmButton')!.disabled).toBe(true)
  })

  it('runs the dry run when the server says it is required', async () => {
    api.answer('SetHubriseCatalogDirection', api.failWith(gqlFailure('HUBRISE_PREVIEW_REQUIRED')))
    const wrapper = await mountDirection()
    await choose(wrapper, 'IMPORT')
    api.clear()
    await clickBody('hubrise.direction.confirmButton')
    expect(api.calls('PreviewHubriseCatalogSync')).toEqual([{ mode: 'DRY_RUN' }])
    expect(bodyText()).not.toContain('hubrise.errors.previewRequired')
  })

  it('reaches IMPORT from PUBLISH with the same dry run', async () => {
    const wrapper = await mountDirection(makeStatus({ catalogDirection: 'PUBLISH' }))
    await choose(wrapper, 'IMPORT')
    expect(bodyText()).toContain('hubrise.direction.confirm.publishToImport')
    expect(api.calls('PreviewHubriseCatalogSync')).toHaveLength(1)
  })
})
