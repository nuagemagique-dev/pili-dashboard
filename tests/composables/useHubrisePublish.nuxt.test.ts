// useHubrisePublish: the PUBLISH side of the menu: the direction switch, the preview, the confirmed publish with its
// stale-plan and rate-limit handling, the external-change acknowledgement. The GraphQL transport is the boundary; the
// shared status is real and the countdown runs on a fake clock.
// Run: `vp test run tests/composables/useHubrisePublish.nuxt.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#imports'
import { gqlFailure, makePreview, makePublish, makeStatus } from '../fixtures/hubrise'
import { mountComposable } from '../helpers/mountComposable'

const gqlFetch = vi.hoisted(() => vi.fn())

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})

const { useHubrisePublish } = await import('~/composables/useHubrisePublish')
const { useHubriseStatusState } = await import('~/composables/useHubriseStatus')

const mountPublish = () =>
  mountComposable(() => ({ ...useHubrisePublish(), ...useHubriseStatusState() })).result

const callsOf = (name: string) =>
  gqlFetch.mock.calls.filter(([query]) => (query as string).includes(name))

beforeEach(() => {
  vi.resetAllMocks()
  clearNuxtState('pili-hubrise-status')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('setDirection', () => {
  it('switches the owner of the menu and shares the new status', async () => {
    const next = makeStatus({
      catalogDirection: 'PUBLISH',
      publish: { awaitingFirstPublish: true },
    })
    gqlFetch.mockResolvedValue({ setHubriseCatalogDirection: next })
    const publish = mountPublish()
    const pending = publish.setDirection('PUBLISH')
    expect(publish.switching.value).toBe(true)
    expect(await pending).toEqual(next)
    expect(publish.switching.value).toBe(false)
    expect(publish.status.value).toEqual(next)
    expect(gqlFetch.mock.calls[0]![1]).toEqual({
      variables: { direction: 'PUBLISH', acknowledgeLocalOverwrite: false },
    })
  })

  it('sends the acknowledgement that leaving PUBLISH with edits waiting needs', async () => {
    gqlFetch.mockResolvedValue({ setHubriseCatalogDirection: makeStatus() })
    const publish = mountPublish()
    await publish.setDirection('NONE', true)
    expect(gqlFetch.mock.calls[0]![1]).toEqual({
      variables: { direction: 'NONE', acknowledgeLocalOverwrite: true },
    })
  })

  it.each([
    ['HUBRISE_PUBLISH_PENDING_CHANGES', 'hubrise.errors.publishPendingChanges'],
    ['HUBRISE_PREVIEW_REQUIRED', 'hubrise.errors.previewRequired'],
    ['HUBRISE_RECONNECT_REQUIRED', 'hubrise.errors.reconnectRequired'],
  ])('reports %s', async (code, key) => {
    gqlFetch.mockRejectedValue(gqlFailure(code))
    const publish = mountPublish()
    expect(await publish.setDirection('IMPORT')).toBeNull()
    expect(publish.error.value).toMatchObject({ code, key })
    expect(publish.switching.value).toBe(false)
    expect(publish.status.value).toBeNull()
  })
})

describe('loadPreview', () => {
  it('loads the plan (without removing the HubRise-only items by default)', async () => {
    const plan = makePreview({ firstPublish: true })
    gqlFetch.mockResolvedValue({ previewHubriseCatalogPublish: plan })
    const publish = mountPublish()
    const pending = publish.loadPreview()
    expect(publish.loadingPreview.value).toBe(true)
    expect(await pending).toEqual(plan)
    expect(publish.preview.value).toEqual(plan)
    expect(publish.loadingPreview.value).toBe(false)
    expect(gqlFetch.mock.calls[0]![1]).toEqual({ variables: { removeForeign: false } })
  })

  it('asks for every part of the plan the dialog shows', async () => {
    gqlFetch.mockResolvedValue({ previewHubriseCatalogPublish: makePreview() })
    await mountPublish().loadPreview(true)
    const [query, options] = gqlFetch.mock.calls[0]!
    for (const field of [
      'planHash',
      'firstPublish',
      'counts',
      'changes',
      'truncated',
      'foreignItems',
      'preserved',
      'warnings',
      'blockers',
      'removalsNeedConfirm',
      'generatedAt',
    ]) {
      expect(query).toContain(field)
    }
    expect(options).toEqual({ variables: { removeForeign: true } })
  })

  it('reports an empty menu', async () => {
    gqlFetch.mockRejectedValue(gqlFailure('HUBRISE_EMPTY_MENU'))
    const publish = mountPublish()
    expect(await publish.loadPreview()).toBeNull()
    expect(publish.error.value?.key).toBe('hubrise.errors.emptyMenu')
    expect(publish.preview.value).toBeNull()
  })

  it('counts down the wait of a rate limit and then lets the admin ask again', async () => {
    vi.useFakeTimers()
    gqlFetch.mockRejectedValue(gqlFailure('HUBRISE_RATE_LIMITED', { retryAfterSeconds: 3 }))
    const publish = mountPublish()
    await publish.loadPreview()
    expect(publish.error.value).toMatchObject({
      code: 'HUBRISE_RATE_LIMITED',
      retryAfterSeconds: 3,
    })
    expect(publish.retryIn.value).toBe(3)
    await vi.advanceTimersByTimeAsync(1000)
    expect(publish.retryIn.value).toBe(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(publish.retryIn.value).toBe(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(publish.retryIn.value).toBe(0)
  })

  it('starts the wait over when rate limited again, and drops it with the next attempt', async () => {
    vi.useFakeTimers()
    gqlFetch.mockRejectedValue(gqlFailure('HUBRISE_RATE_LIMITED', { retryAfterSeconds: 30 }))
    const publish = mountPublish()
    await publish.loadPreview()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(publish.retryIn.value).toBe(20)
    await publish.loadPreview()
    expect(publish.retryIn.value).toBe(30)
    gqlFetch.mockResolvedValue({ previewHubriseCatalogPublish: makePreview() })
    await publish.loadPreview()
    expect(publish.retryIn.value).toBe(0)
    expect(publish.error.value).toBeNull()
    await vi.advanceTimersByTimeAsync(5000)
    expect(publish.retryIn.value).toBe(0)
  })

  it('stops counting when the component goes away', async () => {
    vi.useFakeTimers()
    gqlFetch.mockRejectedValue(gqlFailure('HUBRISE_RATE_LIMITED', { retryAfterSeconds: 30 }))
    const mounted = mountComposable(() => useHubrisePublish())
    await mounted.result.loadPreview()
    mounted.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('publish', () => {
  const published = (over = {}) => ({
    publishHubriseCatalog: {
      published: true,
      queued: false,
      status: makePublish({ lastPublishedAt: '2026-10-24T10:00:00Z', pending: false }),
      ...over,
    },
  })

  it('publishes exactly the plan that was seen and shares the status', async () => {
    gqlFetch.mockResolvedValue(published())
    const publish = mountPublish()
    publish.setStatus(makeStatus({ catalogDirection: 'PUBLISH', publish: { pending: true } }))
    const plan = makePreview({ planHash: 'abc' })
    const pending = publish.publish(plan, true)
    expect(publish.publishing.value).toBe(true)
    const result = await pending
    expect(result).toMatchObject({ published: true, queued: false })
    expect(publish.publishing.value).toBe(false)
    // Only the publish block comes back: it is folded into the status that was already loaded.
    expect(publish.status.value?.catalogDirection).toBe('PUBLISH')
    expect(publish.status.value?.publish.pending).toBe(false)
    expect(publish.status.value?.publish.lastPublishedAt).toBe('2026-10-24T10:00:00Z')
    expect(gqlFetch.mock.calls[0]![1]).toEqual({
      variables: { confirmRemovals: true, removeForeign: true, planHash: 'abc' },
    })
  })

  it('tells that the work was queued behind another replica', async () => {
    gqlFetch.mockResolvedValue(published({ published: false, queued: true }))
    const result = await mountPublish().publish(makePreview(), false)
    expect(result).toMatchObject({ published: false, queued: true })
  })

  it('reloads the plan when it changed meanwhile, and says so', async () => {
    const fresh = makePreview({ planHash: 'new', removed: 4 })
    gqlFetch
      .mockRejectedValueOnce(gqlFailure('HUBRISE_PREVIEW_STALE'))
      .mockResolvedValueOnce({ previewHubriseCatalogPublish: fresh })
    const publish = mountPublish()
    expect(await publish.publish(makePreview({ planHash: 'old' }), true)).toBeNull()
    expect(publish.stale.value).toBe(true)
    expect(publish.error.value?.code).toBe('HUBRISE_PREVIEW_STALE')
    expect(publish.preview.value).toEqual(fresh)
    expect(publish.publishing.value).toBe(false)
    expect(callsOf('previewHubriseCatalogPublish')[0]![1]).toEqual({
      variables: { removeForeign: true },
    })
  })

  it('shows the reload failure instead of the stale notice when the plan cannot be reloaded', async () => {
    gqlFetch
      .mockRejectedValueOnce(gqlFailure('HUBRISE_PREVIEW_STALE'))
      .mockRejectedValueOnce(gqlFailure('HUBRISE_UPSTREAM', { status: 502 }))
    const publish = mountPublish()
    await publish.publish(makePreview(), false)
    expect(publish.stale.value).toBe(false)
    expect(publish.error.value).toMatchObject({ code: 'HUBRISE_UPSTREAM', params: { status: 502 } })
  })

  it.each([
    ['HUBRISE_PUBLISH_CONFIRM_REQUIRED', 'hubrise.errors.publishConfirmRequired'],
    ['HUBRISE_PUBLISH_BLOCKED', 'hubrise.errors.publishBlocked'],
    ['HUBRISE_ACCOUNT_CATALOG', 'hubrise.errors.accountCatalog'],
    ['HUBRISE_RECONNECT_REQUIRED', 'hubrise.errors.reconnectRequired'],
    ['HUBRISE_NOT_PUBLISH_MODE', 'hubrise.errors.notPublishMode'],
  ])('reports %s without reloading anything', async (code, key) => {
    gqlFetch.mockRejectedValue(gqlFailure(code))
    const publish = mountPublish()
    expect(await publish.publish(makePreview(), false)).toBeNull()
    expect(publish.error.value).toMatchObject({ code, key })
    expect(publish.stale.value).toBe(false)
    expect(gqlFetch).toHaveBeenCalledTimes(1)
  })

  it('counts down a rate limit of the publish', async () => {
    vi.useFakeTimers()
    gqlFetch.mockRejectedValue(gqlFailure('HUBRISE_RATE_LIMITED', { retryAfterSeconds: 8 }))
    const publish = mountPublish()
    await publish.publish(makePreview(), false)
    expect(publish.retryIn.value).toBe(8)
    expect(publish.error.value?.params).toEqual({ seconds: 8 })
  })
})

describe('acknowledgeExternalChange', () => {
  it('clears the warning and shares the status', async () => {
    const next = makeStatus({ catalogDirection: 'PUBLISH', publish: { externalChangeAt: null } })
    gqlFetch.mockResolvedValue({ acknowledgeHubriseExternalChange: next })
    const publish = mountPublish()
    expect(await publish.acknowledgeExternalChange()).toEqual(next)
    expect(publish.status.value).toEqual(next)
  })

  it('reports a failure', async () => {
    gqlFetch.mockRejectedValue(gqlFailure('HUBRISE_NOT_PUBLISH_MODE'))
    const publish = mountPublish()
    expect(await publish.acknowledgeExternalChange()).toBeNull()
    expect(publish.error.value?.code).toBe('HUBRISE_NOT_PUBLISH_MODE')
  })
})

describe('reset', () => {
  it('forgets the plan and every message', async () => {
    gqlFetch.mockResolvedValue({ previewHubriseCatalogPublish: makePreview() })
    const publish = mountPublish()
    await publish.loadPreview()
    gqlFetch.mockRejectedValue(gqlFailure('HUBRISE_EMPTY_MENU'))
    await publish.loadPreview()
    publish.reset()
    expect(publish.preview.value).toBeNull()
    expect(publish.error.value).toBeNull()
    expect(publish.stale.value).toBe(false)
    expect(publish.retryIn.value).toBe(0)
  })
})
