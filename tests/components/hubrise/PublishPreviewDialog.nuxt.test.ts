// components/hubrise/PublishPreviewDialog.vue: what a publish would change, read before it is confirmed: the counts, the
// changes with the removals first, the HubRise-only items, the warnings and blockers, the typed confirmation of a mass
// removal, and the publish of exactly the plan that was shown. The GraphQL transport is the boundary.
// Run: `vp test run tests/components/hubrise/PublishPreviewDialog.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#imports'
import { gqlFailure, makePreview, makePublishChange, makeStatus } from '../../fixtures/hubrise'
import { bodyButton, bodyInput, bodySelector, bodyText } from '../../helpers/dom'
import { hubriseApi } from '../../helpers/hubriseApi'
import { settle } from '../../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
mockNuxtImport('useIsMobile', () => () => ref(false))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

// Compiled once at load: the first mount would otherwise eat the test timeout.
const Dialog = (await import('~/components/hubrise/PublishPreviewDialog.vue')).default

const api = hubriseApi(gqlFetch)

const published = (over = {}) => ({
  publishHubriseCatalog: {
    published: true,
    queued: false,
    status: makeStatus({ catalogDirection: 'PUBLISH' }).publish,
    ...over,
  },
})

const mountDialog = async (open = true) => {
  const wrapper = await mountSuspended(Dialog, { props: { open } })
  await settle()
  return wrapper
}

const confirmButton = () =>
  bodyButton('hubrise.preview.confirm') ?? bodyButton('hubrise.preview.confirmFirst')

beforeEach(() => {
  vi.resetAllMocks()
  document.body.innerHTML = ''
  clearNuxtState('pili-hubrise-status')
  api.install()
  api.clear()
  api.answer('PreviewHubriseCatalogPublish', { previewHubriseCatalogPublish: makePreview() })
  api.answer('PublishHubriseCatalog', published())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('opening', () => {
  it('reads nothing while closed', async () => {
    await mountDialog(false)
    expect(api.calls('PreviewHubriseCatalogPublish')).toEqual([])
  })

  it('reads the plan when it opens, without removing the HubRise-only items', async () => {
    await mountDialog()
    expect(api.calls('PreviewHubriseCatalogPublish')).toEqual([{ removeForeign: false }])
  })

  it('reads the plan again every time it opens, forgetting the previous one', async () => {
    const wrapper = await mountDialog()
    await wrapper.setProps({ open: false })
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({ planHash: 'second', added: 9 }),
    })
    await wrapper.setProps({ open: true })
    await settle()
    expect(api.calls('PreviewHubriseCatalogPublish')).toHaveLength(2)
    expect(bodySelector('[data-testid="hubrise-preview-counts"]')!.textContent).toContain('9')
  })

  it('says it is loading until the plan arrives', async () => {
    let release!: (value: unknown) => void
    api.answer(
      'PreviewHubriseCatalogPublish',
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const wrapper = await mountDialog()
    expect(bodyText()).toContain('hubrise.preview.loading')
    release({ previewHubriseCatalogPublish: makePreview() })
    await settle()
    expect(bodyText()).not.toContain('hubrise.preview.loading')
    wrapper.unmount()
  })

  it('cancels', async () => {
    const wrapper = await mountDialog()
    bodyButton('common.cancel')!.click()
    await settle()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    expect(api.calls('PublishHubriseCatalog')).toEqual([])
  })
})

describe('the plan', () => {
  it('shows the five counts and the entities that change', async () => {
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({
        added: 3,
        updated: 2,
        removed: 1,
        unchanged: 40,
        foreign: 4,
        counts: [
          { entity: 'PRODUCT', added: 3, updated: 2, removed: 1 },
          { entity: 'CATEGORY', added: 0, updated: 0, removed: 0 },
        ],
      }),
    })
    await mountDialog()
    const counts = bodySelector('[data-testid="hubrise-preview-counts"]')!.textContent
    for (const n of ['3', '2', '1', '40', '4']) expect(counts).toContain(n)
    expect(bodyText()).toContain('hubrise.entities.PRODUCT')
    expect(bodyText()).toContain('hubrise.preview.rowCounts{"added":3,"updated":2,"removed":1}')
    expect(bodyText()).not.toContain('hubrise.entities.CATEGORY')
  })

  it('lists the removals before the updates and the additions', async () => {
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({
        changes: [
          makePublishChange({ action: 'ADD', name: 'Added roll', key: 'a' }),
          makePublishChange({
            action: 'UPDATE',
            name: 'Updated roll',
            key: 'u',
            fields: ['price'],
          }),
          makePublishChange({ action: 'REMOVE', name: 'Removed roll', key: 'r' }),
        ],
      }),
    })
    await mountDialog()
    const groups = [...document.body.querySelectorAll('[data-group]')].map((g) =>
      g.getAttribute('data-group'),
    )
    expect(groups).toEqual(['REMOVE', 'UPDATE', 'ADD'])
    expect(bodyText()).toContain('price')
  })

  it('says nothing changes when the plan is empty', async () => {
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({ added: 0, changes: [], counts: [] }),
    })
    await mountDialog()
    expect(bodyText()).toContain('hubrise.preview.nothingToDo')
  })

  it('says the list is cut when HubRise sent more than it shows', async () => {
    expect(bodySelector('[data-testid="hubrise-preview-truncated"]')).toBeNull()
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({ truncated: true }),
    })
    await mountDialog()
    expect(bodySelector('[data-testid="hubrise-preview-truncated"]')).not.toBeNull()
  })

  it('explains the first publish and labels the button for it', async () => {
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({ firstPublish: true }),
    })
    await mountDialog()
    expect(bodyText()).toContain('hubrise.preview.firstPublish')
    expect(bodyButton('hubrise.preview.confirmFirst')).toBeDefined()
    expect(bodyButton('hubrise.preview.confirm')).toBeUndefined()
  })

  it('lists the sections of the HubRise catalog that are carried over untouched', async () => {
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({ preserved: ['deals (2)', 'discounts (1)'] }),
    })
    await mountDialog()
    expect(bodyText()).toContain('deals (2)')
    expect(bodyText()).toContain('hubrise.preview.preserved')
  })

  it('shows the warnings, which do not stop the publish', async () => {
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({
        warnings: [{ code: 'NO_CODE', key: 'x', message: 'Ramen has no code' }],
      }),
    })
    await mountDialog()
    expect(bodySelector('[data-testid="hubrise-preview-warnings"]')!.textContent).toContain(
      'Ramen has no code',
    )
    expect(confirmButton()!.disabled).toBe(false)
  })

  it('shows the blockers and disables the confirmation', async () => {
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({
        blockers: [{ code: 'DUPLICATE_REF', key: 'ramen', message: 'Two products share ramen' }],
      }),
    })
    await mountDialog()
    expect(bodySelector('[data-testid="hubrise-preview-blockers"]')!.textContent).toContain(
      'Two products share ramen',
    )
    expect(confirmButton()!.disabled).toBe(true)
  })

  it('cannot confirm before there is a plan', async () => {
    api.answer('PreviewHubriseCatalogPublish', api.failWith(gqlFailure('HUBRISE_EMPTY_MENU')))
    await mountDialog()
    expect(confirmButton()!.disabled).toBe(true)
    expect(bodySelector('[data-testid="hubrise-preview-error"]')!.textContent).toContain(
      'hubrise.errors.emptyMenu',
    )
  })
})

describe('items only HubRise has', () => {
  const withForeign = () => {
    api.answer('PreviewHubriseCatalogPublish', (variables: Record<string, unknown>) => ({
      previewHubriseCatalogPublish: makePreview({
        foreign: 2,
        foreignItems: [
          { entity: 'PRODUCT', ref: 'EPOS1', name: 'Till only item' },
          { entity: 'CATEGORY', ref: 'EPOSCAT', name: 'Till category' },
        ],
        removed: variables.removeForeign === true ? 2 : 0,
      }),
    }))
  }

  it('keeps them by default and says so', async () => {
    withForeign()
    await mountDialog()
    expect(bodyText()).toContain('Till only item')
    expect(bodyText()).toContain('hubrise.preview.foreignHint')
    expect(bodyText()).toContain('hubrise.preview.foreignTitle{"count":2}')
  })

  it('reads the plan again when removing them is chosen, and publishes that plan', async () => {
    withForeign()
    await mountDialog()
    document.body.querySelector<HTMLButtonElement>('button[role="checkbox"]')!.click()
    await settle()
    expect(api.calls('PreviewHubriseCatalogPublish')).toEqual([
      { removeForeign: false },
      { removeForeign: true },
    ])
    confirmButton()!.click()
    await settle()
    expect(api.calls('PublishHubriseCatalog')).toEqual([
      { confirmRemovals: true, removeForeign: true, planHash: 'hash-1' },
    ])
  })

  it('shows the section for a count alone', async () => {
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({ foreign: 3, foreignItems: [] }),
    })
    await mountDialog()
    expect(bodyText()).toContain('hubrise.preview.foreignTitle{"count":3}')
  })

  it('shows the section for items alone', async () => {
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({
        foreign: 0,
        foreignItems: [{ entity: 'PRODUCT', ref: 'X', name: 'Lonely' }],
      }),
    })
    await mountDialog()
    expect(bodyText()).toContain('Lonely')
  })
})

describe('a mass removal', () => {
  const mass = () => {
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({ removed: 12, removalsNeedConfirm: true }),
    })
  }

  it('needs the number of removals typed', async () => {
    mass()
    await mountDialog()
    expect(bodyText()).toContain('hubrise.preview.typedPrompt{"count":"12"}')
    expect(confirmButton()!.disabled).toBe(true)
    const input = bodyInput('[data-testid="hubrise-preview-typed"] input')!
    input.value = '11'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(confirmButton()!.disabled).toBe(true)
    input.value = '12'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(confirmButton()!.disabled).toBe(false)
  })

  it('asks for nothing typed below the threshold', async () => {
    await mountDialog()
    expect(bodySelector('[data-testid="hubrise-preview-typed"]')).toBeNull()
  })
})

describe('publishing', () => {
  it('publishes the plan that was shown and tells whether it was queued', async () => {
    const wrapper = await mountDialog()
    confirmButton()!.click()
    await settle()
    expect(api.calls('PublishHubriseCatalog')).toEqual([
      { confirmRemovals: true, removeForeign: false, planHash: 'hash-1' },
    ])
    expect(wrapper.emitted('published')).toEqual([[false]])
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('reports a publish queued behind another replica', async () => {
    api.answer('PublishHubriseCatalog', published({ published: false, queued: true }))
    const wrapper = await mountDialog()
    confirmButton()!.click()
    await settle()
    expect(wrapper.emitted('published')).toEqual([[true]])
  })

  it('shows the new plan when the old one went stale, and writes nothing', async () => {
    api.answer('PublishHubriseCatalog', api.failWith(gqlFailure('HUBRISE_PREVIEW_STALE')))
    const wrapper = await mountDialog()
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({ planHash: 'fresh', added: 8 }),
    })
    confirmButton()!.click()
    await settle()
    expect(bodySelector('[data-testid="hubrise-preview-error"]')!.textContent).toContain(
      'hubrise.errors.previewStale',
    )
    expect(bodySelector('[data-testid="hubrise-preview-counts"]')!.textContent).toContain('8')
    expect(wrapper.emitted('published')).toBeUndefined()
    // The admin confirms the plan they now see.
    api.answer('PublishHubriseCatalog', published())
    confirmButton()!.click()
    await settle()
    expect(api.calls('PublishHubriseCatalog').at(-1)).toMatchObject({ planHash: 'fresh' })
    expect(wrapper.emitted('published')).toHaveLength(1)
  })

  it('clears the typed confirmation after a refusal', async () => {
    api.answer('PreviewHubriseCatalogPublish', {
      previewHubriseCatalogPublish: makePreview({ removed: 7, removalsNeedConfirm: true }),
    })
    api.answer('PublishHubriseCatalog', api.failWith(gqlFailure('HUBRISE_PUBLISH_BLOCKED')))
    await mountDialog()
    const input = bodyInput('[data-testid="hubrise-preview-typed"] input')!
    input.value = '7'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    confirmButton()!.click()
    await settle()
    expect(bodyText()).toContain('hubrise.errors.publishBlocked')
    expect(input.value).toBe('')
    expect(confirmButton()!.disabled).toBe(true)
  })

  it.each([
    ['HUBRISE_RECONNECT_REQUIRED', 'hubrise.errors.reconnectRequired'],
    ['HUBRISE_ACCOUNT_CATALOG', 'hubrise.errors.accountCatalog'],
  ])('tells %s', async (code, key) => {
    api.answer('PublishHubriseCatalog', api.failWith(gqlFailure(code)))
    const wrapper = await mountDialog()
    confirmButton()!.click()
    await settle()
    expect(bodyText()).toContain(key)
    expect(wrapper.emitted('published')).toBeUndefined()
  })
})

describe('rate limit', () => {
  it('counts down, then lets the admin ask again', async () => {
    vi.useFakeTimers()
    api.answer(
      'PreviewHubriseCatalogPublish',
      api.failWith(gqlFailure('HUBRISE_RATE_LIMITED', { retryAfterSeconds: 65 })),
    )
    await mountDialog()
    await vi.advanceTimersByTimeAsync(0)
    expect(bodySelector('[data-testid="hubrise-preview-countdown"]')!.textContent).toContain(
      'hubrise.preview.retryIn{"time":"1:05"}',
    )
    expect(bodyButton('hubrise.preview.retry')!.disabled).toBe(true)
    await vi.advanceTimersByTimeAsync(65_000)
    expect(bodySelector('[data-testid="hubrise-preview-countdown"]')).toBeNull()
    expect(bodyButton('hubrise.preview.retry')!.disabled).toBe(false)
    api.answer('PreviewHubriseCatalogPublish', { previewHubriseCatalogPublish: makePreview() })
    bodyButton('hubrise.preview.retry')!.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(confirmButton()).toBeDefined()
    expect(bodySelector('[data-testid="hubrise-preview-counts"]')).not.toBeNull()
  })

  it('does not publish during the wait of a rate-limited publish', async () => {
    vi.useFakeTimers()
    api.answer(
      'PublishHubriseCatalog',
      api.failWith(gqlFailure('HUBRISE_RATE_LIMITED', { retryAfterSeconds: 30 })),
    )
    await mountDialog()
    await vi.advanceTimersByTimeAsync(0)
    confirmButton()!.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(confirmButton()!.disabled).toBe(true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(confirmButton()!.disabled).toBe(false)
  })
})
