// useHubriseStatus: the HubRise status shared by the layout banner, the navigation and the HubRise page: loaded on
// mount, read again every 30 seconds while a consumer is on screen (one timer for all of them), stopped with the last
// one. The GraphQL transport is the boundary; the shared state (useState) and the timers are real (fake clock).
// Run: `vp test run tests/composables/useHubriseStatus.nuxt.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#imports'
import { HUBRISE_POLL_MS, HUBRISE_STATUS_FIELDS } from '~/composables/useHubriseStatus'
import { makeStatus } from '../fixtures/hubrise'
import { mountComposable } from '../helpers/mountComposable'
import { settle } from '../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})

const { useHubriseStatus, useHubriseStatusState } = await import('~/composables/useHubriseStatus')

const answer = (status = makeStatus()) => ({ hubriseStatus: status })

beforeEach(() => {
  vi.resetAllMocks()
  clearNuxtState('pili-hubrise-status')
  gqlFetch.mockResolvedValue(answer())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loading', () => {
  it('stays null until the first answer', async () => {
    let release!: (value: unknown) => void
    gqlFetch.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const { result } = mountComposable(() => useHubriseStatus())
    expect(result.status.value).toBeNull()
    expect(result.loading.value).toBe(true)
    release(answer())
    await settle()
    expect(result.status.value).toEqual(makeStatus())
  })

  it('loads the status when mounted, asking for every field the screens use', async () => {
    const { result } = mountComposable(() => useHubriseStatus())
    await settle()
    expect(result.status.value).toEqual(makeStatus())
    expect(result.loading.value).toBe(false)
    expect(result.loadError.value).toBeNull()
    const [query] = gqlFetch.mock.calls[0]!
    for (const field of [
      'available',
      'catalogDirection',
      'customerListName',
      'publishCatalog',
      'backlog',
      'parked',
      'unlinkedProducts',
      'attention',
      'nextPublishAt',
      'lastErrorCode',
      'externalChangeAt',
      'needsReconnectForWrite',
      'accountCatalogDetected',
      'publishImages',
      'publishedProducts',
      'pendingProducts',
    ]) {
      expect(query).toMatch(new RegExp(`\\b${field}\\b`, 'u'))
    }
    expect(HUBRISE_STATUS_FIELDS).toContain('publish {')
  })

  it('keeps the previous status when the answer is empty', async () => {
    const { result } = mountComposable(() => useHubriseStatus())
    await settle()
    gqlFetch.mockResolvedValue(null)
    expect(await result.reload()).toEqual(makeStatus())
    expect(result.status.value).toEqual(makeStatus())
  })

  it('keeps the previous status when the answer has no status in it', async () => {
    const { result } = mountComposable(() => useHubriseStatus())
    await settle()
    gqlFetch.mockResolvedValue({})
    await result.reload()
    expect(result.status.value).toEqual(makeStatus())
  })

  it('keeps what is shown and reports the error when the query fails', async () => {
    const { result } = mountComposable(() => useHubriseStatus())
    await settle()
    const failure = new Error('down')
    gqlFetch.mockRejectedValue(failure)
    expect(await result.reload()).toBeNull()
    expect(result.loadError.value).toBe(failure)
    expect(result.status.value).toEqual(makeStatus())
    expect(result.loading.value).toBe(false)
  })

  it('clears the error with the next good answer', async () => {
    gqlFetch.mockRejectedValueOnce(new Error('down'))
    const { result } = mountComposable(() => useHubriseStatus())
    await settle()
    expect(result.loadError.value).not.toBeNull()
    await result.reload()
    expect(result.loadError.value).toBeNull()
  })

  it('shares the status between the layout and the page', async () => {
    mountComposable(() => useHubriseStatus())
    await settle()
    const second = mountComposable(() => useHubriseStatus()).result
    expect(second.status.value).toEqual(makeStatus())
  })

  it('reads once for several asks at the same time', async () => {
    let release!: (value: unknown) => void
    gqlFetch.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const first = mountComposable(() => useHubriseStatus())
    const second = mountComposable(() => useHubriseStatus())
    expect(gqlFetch).toHaveBeenCalledTimes(1)
    const pending = first.result.reload()
    release(answer(makeStatus({ enabled: false })))
    await pending
    expect(second.result.status.value?.enabled).toBe(false)
    expect(gqlFetch).toHaveBeenCalledTimes(1)
  })

  it('reports a failed shared read to every consumer that joined it', async () => {
    let fail!: (reason: unknown) => void
    gqlFetch.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject
      }),
    )
    const first = mountComposable(() => useHubriseStatus())
    const second = mountComposable(() => useHubriseStatus())
    await settle()
    expect(second.result.loading.value).toBe(true)
    const failure = new Error('down')
    fail(failure)
    await settle()
    expect(gqlFetch).toHaveBeenCalledTimes(1)
    expect(first.result.loadError.value).toBe(failure)
    expect(second.result.loadError.value).toBe(failure)
    expect(second.result.loading.value).toBe(false)
  })

  it('setStatus replaces the shared status (a mutation answered with a fresh one)', async () => {
    const { result } = mountComposable(() => useHubriseStatus())
    await settle()
    result.setStatus(makeStatus({ enabled: false }))
    expect(result.status.value?.enabled).toBe(false)
  })

  it('exposes the state to the composables that only write it', () => {
    const { result } = mountComposable(() => useHubriseStatusState())
    result.setStatus(makeStatus({ attention: 3 }))
    expect(mountComposable(() => useHubriseStatusState()).result.status.value?.attention).toBe(3)
  })
})

describe('polling', () => {
  it('reads again every 30 seconds while mounted', async () => {
    vi.useFakeTimers()
    mountComposable(() => useHubriseStatus())
    await vi.advanceTimersByTimeAsync(0)
    expect(gqlFetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(HUBRISE_POLL_MS)
    expect(gqlFetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(HUBRISE_POLL_MS)
    expect(gqlFetch).toHaveBeenCalledTimes(3)
  })

  it('runs one timer however many consumers are mounted', async () => {
    vi.useFakeTimers()
    mountComposable(() => useHubriseStatus())
    mountComposable(() => useHubriseStatus())
    await vi.advanceTimersByTimeAsync(0)
    gqlFetch.mockClear()
    await vi.advanceTimersByTimeAsync(HUBRISE_POLL_MS)
    expect(gqlFetch).toHaveBeenCalledTimes(1)
  })

  it('keeps polling until the last consumer unmounts, then stops', async () => {
    vi.useFakeTimers()
    const first = mountComposable(() => useHubriseStatus())
    const second = mountComposable(() => useHubriseStatus())
    await vi.advanceTimersByTimeAsync(0)
    first.unmount()
    gqlFetch.mockClear()
    await vi.advanceTimersByTimeAsync(HUBRISE_POLL_MS)
    expect(gqlFetch).toHaveBeenCalledTimes(1)
    second.unmount()
    gqlFetch.mockClear()
    await vi.advanceTimersByTimeAsync(HUBRISE_POLL_MS * 3)
    expect(gqlFetch).not.toHaveBeenCalled()
  })

  it('starts again for a later consumer', async () => {
    vi.useFakeTimers()
    mountComposable(() => useHubriseStatus()).unmount()
    mountComposable(() => useHubriseStatus())
    await vi.advanceTimersByTimeAsync(0)
    gqlFetch.mockClear()
    await vi.advanceTimersByTimeAsync(HUBRISE_POLL_MS)
    expect(gqlFetch).toHaveBeenCalledTimes(1)
  })

  it('leaves a server without HubRise alone', async () => {
    vi.useFakeTimers()
    gqlFetch.mockResolvedValue(answer(makeStatus({ available: false })))
    mountComposable(() => useHubriseStatus())
    await vi.advanceTimersByTimeAsync(0)
    expect(gqlFetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(HUBRISE_POLL_MS * 3)
    expect(gqlFetch).toHaveBeenCalledTimes(1)
  })
})
