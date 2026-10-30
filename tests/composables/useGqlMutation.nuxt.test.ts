// useGqlMutation: `mutate()` you can await anywhere, plus reactive data / loading / error for the UI. The GraphQL
// transport ($gqlFetch) is the boundary.
// Run: `vp test run tests/composables/useGqlMutation.nuxt.test.ts`.
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useGqlMutation } from '~/composables/useGqlMutation'

const gqlFetch = vi.hoisted(() => vi.fn())
mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})

const MUTATION = 'mutation Cancel($id: ID!) { cancelOrder(id: $id) { id } }'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('mutate', () => {
  it('sends the mutation with its variables and resolves with the response, also kept in `data`', async () => {
    gqlFetch.mockResolvedValue({ cancelOrder: { id: 'o-1' } })
    const { mutate, data } = useGqlMutation<{ cancelOrder: { id: string } }>(MUTATION)

    await expect(mutate({ id: 'o-1' })).resolves.toEqual({ cancelOrder: { id: 'o-1' } })

    expect(gqlFetch).toHaveBeenCalledExactlyOnceWith(MUTATION, { variables: { id: 'o-1' } })
    expect(data.value).toEqual({ cancelOrder: { id: 'o-1' } })
  })

  it('sends empty variables when called without any', async () => {
    gqlFetch.mockResolvedValue({})
    await useGqlMutation(MUTATION).mutate()
    expect(gqlFetch).toHaveBeenCalledExactlyOnceWith(MUTATION, { variables: {} })
  })

  it('is loading while the request is in flight, and not before or after', async () => {
    let finish: (value: unknown) => void = () => {}
    gqlFetch.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const { mutate, loading } = useGqlMutation(MUTATION)
    expect(loading.value).toBe(false)

    const pending = mutate()
    expect(loading.value).toBe(true)

    finish({ ok: true })
    await pending
    expect(loading.value).toBe(false)
  })

  it('rethrows a failure, exposes it in `error`, stops loading and keeps the previous data', async () => {
    const { mutate, data, error, loading } = useGqlMutation<{ n: number }>(MUTATION)
    gqlFetch.mockResolvedValueOnce({ n: 1 })
    await mutate()

    const failure = [{ message: 'forbidden' }]
    gqlFetch.mockRejectedValueOnce(failure)
    await expect(mutate()).rejects.toBe(failure)

    expect(error.value).toEqual(failure)
    expect(loading.value).toBe(false)
    expect(data.value).toEqual({ n: 1 })
  })

  it('clears the previous error when called again', async () => {
    const { mutate, error } = useGqlMutation(MUTATION)
    gqlFetch.mockRejectedValueOnce(new Error('first'))
    await expect(mutate()).rejects.toThrow('first')
    expect(error.value).toBeInstanceOf(Error)

    gqlFetch.mockResolvedValueOnce({})
    await mutate()
    expect(error.value).toBeUndefined()
  })

  it('keeps separate state per useGqlMutation() call', async () => {
    gqlFetch.mockResolvedValue({ ok: true })
    const first = useGqlMutation(MUTATION)
    const second = useGqlMutation(MUTATION)
    await first.mutate()
    expect(first.data.value).toEqual({ ok: true })
    expect(second.data.value).toBeUndefined()
  })
})
