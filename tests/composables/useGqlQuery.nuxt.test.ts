// useGqlQuery: a GraphQL query as Nuxt async data (`data`, `pending`, `error`, `refresh`, `refetch`). Asserts what the
// pages rely on: what is sent, the cache key when `cache` is on, `immediate`, and the refetch when reactive variables
// change (the latest variables win). useAsyncData and the Nuxt payload are real; the transport ($gqlFetch) is the boundary.
// Run: `vp test run tests/composables/useGqlQuery.nuxt.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { effectScope, nextTick, ref } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { clearNuxtData, useNuxtData } from '#imports'
import { hash } from 'ohash'
import { settle } from '../helpers/settle'
import { useGqlQuery as useGqlQueryUnscoped } from '~/composables/useGqlQuery'

const gqlFetch = vi.hoisted(() => vi.fn())
const asyncDataCalls = vi.hoisted(() => [] as unknown[][])

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
// The real useAsyncData, observed: the options a caller's flags turn into are part of the contract.
mockNuxtImport('useAsyncData', (original) => (...args: unknown[]) => {
  // A copy: Nuxt fills the defaults into the options object it receives.
  asyncDataCalls.push(args.map((arg) => (typeof arg === 'object' && arg ? { ...arg } : arg)))
  return (original as (...a: unknown[]) => unknown)(...args)
})

/**
 * Every query runs in its own effect scope, stopped after the test: that is what a component unmount does, and it
 * releases the async-data entry. (Nuxt keeps an entry, and the handler it was created with, while any user is alive.)
 */
const scopes: ReturnType<typeof effectScope>[] = []
const useGqlQuery = ((...args: Parameters<typeof useGqlQueryUnscoped>) => {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useGqlQueryUnscoped(...args))!
}) as typeof useGqlQueryUnscoped

let n = 0
/** A document no other test asks: Nuxt keeps async data by key. */
const doc = () => `query Q${++n} { thing { id } }`

beforeEach(() => {
  vi.resetAllMocks()
  asyncDataCalls.length = 0
  clearNuxtData()
})

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
})

describe('asking', () => {
  it('asks through the shared transport with the document and exposes the answer', async () => {
    const query = doc()
    gqlFetch.mockResolvedValue({ thing: { id: 't-1' } })

    const { data, pending, error } = await useGqlQuery<{ thing: { id: string } }>(query)

    expect(gqlFetch).toHaveBeenCalledExactlyOnceWith(query, { variables: {} })
    expect(data.value).toEqual({ thing: { id: 't-1' } })
    expect(pending.value).toBe(false)
    expect(error.value).toBeUndefined()
  })

  it('sends the variables, given as an object', async () => {
    gqlFetch.mockResolvedValue({})
    await useGqlQuery(doc(), { first: 5 })
    expect(gqlFetch.mock.calls[0]![1]).toEqual({ variables: { first: 5 } })
  })

  it('sends the variables, given as a function (evaluated at request time)', async () => {
    gqlFetch.mockResolvedValue({})
    const first = ref(5)
    await useGqlQuery(doc(), () => ({ first: first.value }))
    expect(gqlFetch.mock.calls[0]![1]).toEqual({ variables: { first: 5 } })
  })

  it('exposes a failure in `error` and leaves `data` empty, without throwing', async () => {
    const failure = [{ message: 'forbidden' }]
    gqlFetch.mockRejectedValue(failure)

    const { data, error } = await useGqlQuery(doc())

    expect(data.value).toBeUndefined()
    expect(error.value).toBeTruthy()
  })
})

describe('refresh and refetch', () => {
  it('refetch is the same function as refresh, and asks again', async () => {
    gqlFetch.mockResolvedValueOnce({ n: 1 }).mockResolvedValueOnce({ n: 2 })
    const result = await useGqlQuery<{ n: number }>(doc())
    expect(result.refetch).toBe(result.refresh)

    await result.refetch()

    expect(gqlFetch).toHaveBeenCalledTimes(2)
    expect(result.data.value).toEqual({ n: 2 })
  })

  it('immediate: false waits for the first refetch', async () => {
    gqlFetch.mockResolvedValue({ n: 1 })
    const result = await useGqlQuery<{ n: number }>(doc(), {}, { immediate: false })
    expect(gqlFetch).not.toHaveBeenCalled()
    expect(result.data.value).toBeUndefined()

    await result.refetch()

    expect(gqlFetch).toHaveBeenCalledOnce()
    expect(result.data.value).toEqual({ n: 1 })
  })
})

describe('reactive variables', () => {
  it('asks again when a value the variables function reads changes', async () => {
    gqlFetch.mockImplementation((_q: string, { variables }: { variables: { id: string } }) =>
      Promise.resolve({ id: variables.id }),
    )
    const id = ref('a')
    const { data } = await useGqlQuery<{ id: string }>(doc(), () => ({ id: id.value }))
    expect(data.value).toEqual({ id: 'a' })

    id.value = 'b'
    await nextTick()
    await settle()

    expect(gqlFetch).toHaveBeenCalledTimes(2)
    expect(gqlFetch.mock.calls[1]![1]).toEqual({ variables: { id: 'b' } })
    expect(data.value).toEqual({ id: 'b' })
  })

  it('watches nested changes of the variables', async () => {
    gqlFetch.mockResolvedValue({})
    const filter = ref({ status: 'PENDING' })
    await useGqlQuery(doc(), () => ({ filter: filter.value }))

    filter.value.status = 'CONFIRMED'
    await nextTick()
    await settle()

    expect(gqlFetch.mock.calls[1]![1]).toEqual({ variables: { filter: { status: 'CONFIRMED' } } })
  })

  it('lets the latest variables win when an earlier request answers late', async () => {
    const answers: Record<string, (value: unknown) => void> = {}
    gqlFetch.mockImplementation(
      (_q: string, { variables }: { variables: { id: string } }) =>
        new Promise((resolve) => {
          answers[variables.id] = resolve
        }),
    )
    const id = ref('a')
    const asking = useGqlQuery<{ id: string }>(doc(), () => ({ id: id.value }))
    await nextTick()
    answers.a!({ id: 'a' })
    const { data } = await asking

    // `a` was answered; now `b` is requested and, before it answers, `c` supersedes it.
    id.value = 'b'
    await nextTick()
    id.value = 'c'
    await nextTick()
    answers.c!({ id: 'c' })
    await settle()
    answers.b!({ id: 'b' })
    await settle()

    expect(data.value).toEqual({ id: 'c' })
  })

  it('does not watch anything when the variables are a plain object', async () => {
    gqlFetch.mockResolvedValue({})
    const vars = { first: 5 }
    await useGqlQuery(doc(), vars)
    vars.first = 10
    await nextTick()
    await settle()
    expect(gqlFetch).toHaveBeenCalledOnce()
  })
})

describe('options', () => {
  it('does not share by document by default: the key is derived from the document AND its variables', async () => {
    gqlFetch.mockResolvedValue({ thing: 1 })
    const query = doc()
    await useGqlQuery(query, { id: 'a' })
    expect(useNuxtData(`gql:${hash(query)}`).data.value).toBeUndefined()
    expect(asyncDataCalls[0]![0]).toBe(`gql:${hash([query, { id: 'a' }])}`)
    expect(useNuxtData(`gql:${hash([query, { id: 'a' }])}`).data.value).toEqual({ thing: 1 })
  })

  it('cache: true keys the data by the document, so the same query shares its data', async () => {
    gqlFetch.mockResolvedValue({ thing: 1 })
    const query = doc()
    await useGqlQuery(query, {}, { cache: true })
    expect(asyncDataCalls[0]![0]).toBe(`gql:${hash(query)}`)
    expect(useNuxtData(`gql:${hash(query)}`).data.value).toEqual({ thing: 1 })
  })

  it('passes `immediate` and `server` on to useAsyncData', async () => {
    gqlFetch.mockResolvedValue({})
    await useGqlQuery(doc(), {}, { immediate: false, server: false })
    const options = asyncDataCalls[0]!.find((arg) => typeof arg === 'object')
    expect(options).toEqual({ immediate: false, server: false })
  })

  it('has no explicit `immediate` when options are given without it (Nuxt then fetches)', async () => {
    gqlFetch.mockResolvedValue({ thing: 1 })
    const { data } = await useGqlQuery(doc(), {}, { cache: false })
    expect(asyncDataCalls[0]!.find((arg) => typeof arg === 'object')).toEqual({
      immediate: undefined,
      server: undefined,
    })
    expect(data.value).toEqual({ thing: 1 })
  })
})

describe('concurrent queries', () => {
  // Without `cache` the key is derived from the document and its variables, so queries alive at the same time
  // (a page and its layout, two panels) each ask their own document. (A key generated by Nuxt for the call site inside
  // useGqlQuery was the same for every caller: the second query reused the first one's handler and data.)
  it('two live uncached queries each ask their own document and keep their own data', async () => {
    gqlFetch.mockImplementation((query: string) => Promise.resolve({ asked: query }))
    const first = doc()
    const second = doc()

    const a = await useGqlQuery<{ asked: string }>(first)
    const b = await useGqlQuery<{ asked: string }>(second)

    expect(a.data.value).toEqual({ asked: first })
    expect(b.data.value).toEqual({ asked: second })
    expect(gqlFetch).toHaveBeenCalledTimes(2)
  })

  it('two live uncached queries of the same document with different variables keep their own data', async () => {
    gqlFetch.mockImplementation((query: string, { variables }: { variables: { id: string } }) =>
      Promise.resolve({ id: variables.id }),
    )
    const query = doc()

    const a = await useGqlQuery<{ id: string }>(query, { id: 'a' })
    const b = await useGqlQuery<{ id: string }>(query, { id: 'b' })

    expect(a.data.value).toEqual({ id: 'a' })
    expect(b.data.value).toEqual({ id: 'b' })
  })

  it('two live uncached identical queries are one query: one request, shared data', async () => {
    gqlFetch.mockResolvedValue({ thing: 1 })
    const query = doc()

    const a = await useGqlQuery<{ thing: number }>(query, { id: 'a' })
    const b = await useGqlQuery<{ thing: number }>(query, { id: 'a' })

    expect(a.data.value).toEqual({ thing: 1 })
    expect(b.data.value).toEqual({ thing: 1 })
    expect(gqlFetch).toHaveBeenCalledTimes(1)
  })

  it('derives the key from the variables a function returns when the query starts', async () => {
    gqlFetch.mockResolvedValue({ thing: 1 })
    const query = doc()
    await useGqlQuery(query, () => ({ page: 2 }))
    expect(asyncDataCalls[0]![0]).toBe(`gql:${hash([query, { page: 2 }])}`)
  })

  it('cached queries are keyed by their document, so different documents do not collide', async () => {
    gqlFetch.mockImplementation((query: string) => Promise.resolve({ asked: query }))
    const first = doc()
    const second = doc()

    const a = await useGqlQuery<{ asked: string }>(first, {}, { cache: true })
    const b = await useGqlQuery<{ asked: string }>(second, {}, { cache: true })

    expect(a.data.value).toEqual({ asked: first })
    expect(b.data.value).toEqual({ asked: second })
  })
})
