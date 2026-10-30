// useHubriseCatalog: the IMPORT side of the menu: the dry run and the import. The GraphQL transport is the boundary.
// Run: `vp test run tests/composables/useHubriseCatalog.nuxt.test.ts`.
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#imports'
import { gqlFailure, makeDiff, makeStatus } from '../fixtures/hubrise'
import { mountComposable } from '../helpers/mountComposable'
import { settle } from '../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})

const { useHubriseCatalog } = await import('~/composables/useHubriseCatalog')

let current = makeStatus()
const answers: Record<string, unknown> = {}
const install = () => {
  gqlFetch.mockImplementation((query: string) => {
    const name = /(?:query|mutation) (\w+)/u.exec(query)?.[1] ?? ''
    if (name === 'HubriseStatus') return Promise.resolve({ hubriseStatus: current })
    if (name in answers) {
      const answer = answers[name]
      return answer instanceof Error || Array.isArray(answer)
        ? Promise.reject(answer) // oxlint-disable-line typescript/prefer-promise-reject-errors -- $gqlFetch rejects with the raw errors array
        : Promise.resolve(answer)
    }
    return Promise.reject(new Error(`unexpected ${name}`))
  })
}

const mountCatalog = async () => {
  const mounted = mountComposable(() => useHubriseCatalog())
  await settle()
  gqlFetch.mockClear()
  return mounted
}

const operations = () =>
  gqlFetch.mock.calls.map(([query]) => /(?:query|mutation) (\w+)/u.exec(query as string)?.[1])

beforeEach(() => {
  vi.resetAllMocks()
  clearNuxtState('pili-hubrise-status')
  current = makeStatus()
  for (const key of Object.keys(answers)) delete answers[key] // oxlint-disable-line typescript/no-dynamic-delete
  install()
})

describe('preview', () => {
  it('computes the diff of a mode and reads the status again (the dry run unlocks enabling the import)', async () => {
    const diff = makeDiff({ retiringProducts: 6, retireNeedsConfirm: true })
    answers.PreviewHubriseCatalogSync = { previewHubriseCatalogSync: diff }
    const { result } = await mountCatalog()
    const pending = result.preview('DRY_RUN')
    expect(result.busy.value).toBe(true)
    expect(await pending).toEqual(diff)
    expect(result.diff.value).toEqual(diff)
    expect(result.busy.value).toBe(false)
    expect(gqlFetch.mock.calls[0]![1]).toEqual({ variables: { mode: 'DRY_RUN' } })
    expect(operations()).toEqual(['PreviewHubriseCatalogSync', 'HubriseStatus'])
  })

  it('asks for every part of the diff the dialog shows', async () => {
    answers.PreviewHubriseCatalogSync = { previewHubriseCatalogSync: makeDiff() }
    const { result } = await mountCatalog()
    await result.preview('LINK_ONLY')
    const [query] = gqlFetch.mock.calls[0]!
    for (const field of [
      'changes',
      'conflicts',
      'warnings',
      'retiringProducts',
      'retireNeedsConfirm',
      'catalogHash',
    ]) {
      expect(query).toContain(field)
    }
  })

  it('reports the failure with its message key instead of rejecting', async () => {
    answers.PreviewHubriseCatalogSync = gqlFailure('HUBRISE_PUBLISH_MODE')
    const { result } = await mountCatalog()
    expect(await result.preview('FULL')).toBeNull()
    expect(result.error.value).toMatchObject({
      code: 'HUBRISE_PUBLISH_MODE',
      key: 'hubrise.errors.publishMode',
    })
    expect(result.busy.value).toBe(false)
    expect(result.diff.value).toBeNull()
  })

  it('clears the previous error when it starts again', async () => {
    answers.PreviewHubriseCatalogSync = gqlFailure('HUBRISE_BUSY')
    const { result } = await mountCatalog()
    await result.preview('DRY_RUN')
    expect(result.error.value?.code).toBe('HUBRISE_BUSY')
    answers.PreviewHubriseCatalogSync = { previewHubriseCatalogSync: makeDiff() }
    await result.preview('DRY_RUN')
    expect(result.error.value).toBeNull()
  })
})

describe('sync', () => {
  const syncResult = (over = {}) => ({
    mode: 'FULL',
    applied: true,
    pendingReview: false,
    failedBatches: [],
    diff: makeDiff({ changes: [] }),
    ...over,
  })

  it('imports without confirming a retirement by default', async () => {
    answers.SyncHubriseCatalog = { syncHubriseCatalog: syncResult() }
    const { result } = await mountCatalog()
    expect(await result.sync('FULL')).toEqual(syncResult())
    expect(gqlFetch.mock.calls[0]![1]).toEqual({
      variables: { mode: 'FULL', confirmRetire: false },
    })
    expect(result.result.value).toEqual(syncResult())
    expect(result.diff.value).toEqual(syncResult().diff)
    expect(operations()).toEqual(['SyncHubriseCatalog', 'HubriseStatus'])
  })

  it('confirms the retirement when the admin did', async () => {
    answers.SyncHubriseCatalog = { syncHubriseCatalog: syncResult() }
    const { result } = await mountCatalog()
    await result.sync('FULL', true)
    expect(gqlFetch.mock.calls[0]![1]).toEqual({ variables: { mode: 'FULL', confirmRetire: true } })
  })

  it('tells that a retirement needs confirmation', async () => {
    answers.SyncHubriseCatalog = gqlFailure('HUBRISE_RETIRE_CONFIRM_REQUIRED')
    const { result } = await mountCatalog()
    expect(await result.sync('FULL')).toBeNull()
    expect(result.error.value?.code).toBe('HUBRISE_RETIRE_CONFIRM_REQUIRED')
    expect(result.result.value).toBeNull()
  })

  it('reset forgets the diff, the result and the error', async () => {
    answers.SyncHubriseCatalog = { syncHubriseCatalog: syncResult() }
    const { result } = await mountCatalog()
    await result.sync('FULL')
    result.reset()
    expect(result.diff.value).toBeNull()
    expect(result.result.value).toBeNull()
    expect(result.error.value).toBeNull()
  })

  it('treats a failure that is not ours as the generic one', async () => {
    answers.SyncHubriseCatalog = new Error('offline')
    const { result } = await mountCatalog()
    await result.sync('LINK_ONLY')
    expect(result.error.value).toMatchObject({ code: null, key: 'hubrise.errors.generic' })
  })
})
