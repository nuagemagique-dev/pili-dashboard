// pages/products.vue: creating or updating a product WITH an image goes through `$api` as a multipart GraphQL request
// (a FormData body: operations / map / file, the plugin then leaves the Content-Type to the runtime, which adds the
// boundary), and WITHOUT an image through the normal GraphQL mutation. The multipart builder itself is tested in
// tests/utils/graphqlUpload.test.ts, the Content-Type handling in tests/plugins/api.nuxt.test.ts.
// Run: `vp test run tests/pages/products.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { clearNuxtState, useRuntimeConfig } from '#imports'
import { makeProduct } from '../fixtures/dashboard'
import { gqlFailure, makeStatus } from '../fixtures/hubrise'
import { settle } from '../helpers/settle'

const h = vi.hoisted(() => ({
  api: vi.fn(),
  gqlFetch: vi.fn(),
  products: [] as unknown[],
  queries: [] as string[],
  subscriptions: [] as string[],
  toast: vi.fn(),
}))

mockNuxtImport(
  'useNuxtApp',
  (original) => () =>
    new Proxy(original(), {
      get(target, key, receiver) {
        if (key === '$api') return h.api
        if (key === '$gqlFetch') return h.gqlFetch
        return Reflect.get(target, key, receiver)
      },
    }),
)
mockNuxtImport('useGqlQuery', () => (query: string) => {
  h.queries.push(query)
  return Promise.resolve({
    data: ref(
      query.includes('productCategories') ? { productCategories: [] } : { products: h.products },
    ),
    pending: ref(false),
    refetch: vi.fn(),
  })
})
mockNuxtImport('useToast', () => () => ({ add: h.toast }))
mockNuxtImport('useGqlSubscription', () => (query: string) => {
  h.subscriptions.push(query)
  return { data: ref<unknown>(null) }
})
mockNuxtImport('useIsMobile', () => () => ref(false))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../helpers/i18n')
  return {
    ...(await importOriginal<typeof VueI18NModule>()),
    useI18n: () => ({ ...fakeI18n(), availableLocales: ['fr', 'en'] }),
  }
})

interface ProductsPageVm {
  handleCreate: (input: Record<string, unknown>) => Promise<unknown>
  handleUpdate: (request: { id: string; input: Record<string, unknown> }) => Promise<void>
}

const mountPage = async () => {
  const Page = (await import('~/pages/products.vue')).default
  const wrapper = await mountSuspended(Page)
  await settle()
  // The page reads the HubRise status when it starts: the tests below are about what comes after.
  h.gqlFetch.mockClear()
  return { wrapper, vm: wrapper.vm as unknown as ProductsPageVm }
}

const image = () => new File(['png-bytes'], 'ramen.png', { type: 'image/png' })

beforeEach(() => {
  h.api.mockReset()
  h.gqlFetch.mockReset()
  h.toast.mockReset()
  h.queries.length = 0
  h.subscriptions.length = 0
  clearNuxtState('pili-hubrise-status')
  h.products = [makeProduct({ id: 'p-1' })]
})

describe('products page: image upload', () => {
  const graphqlUrl = () => useRuntimeConfig().public.graphqlHttp

  it('create with an image: a FormData through $api (operations, map, file), no JSON Content-Type forced', async () => {
    const created = makeProduct({ id: 'p-new' })
    h.api.mockResolvedValue({ data: { createProduct: created } })
    const { vm } = await mountPage()

    const file = image()
    await expect(vm.handleCreate({ code: 'R1', price: '12.50', image: file })).resolves.toEqual(
      created,
    )

    expect(h.api).toHaveBeenCalledOnce()
    const [url, options] = h.api.mock.calls[0]!
    expect(url).toBe(graphqlUrl())
    expect(options.method).toBe('POST')
    expect(options.body).toBeInstanceOf(FormData)
    // Anything in `headers` would override the multipart boundary the runtime generates.
    expect(options.headers).toBeUndefined()

    const form = options.body as FormData
    const operations = JSON.parse(form.get('operations') as string)
    expect(operations.query).toContain('createProduct')
    expect(operations.variables).toEqual({ input: { code: 'R1', price: '12.50', image: null } })
    expect(JSON.parse(form.get('map') as string)).toEqual({ 0: ['variables.input.image'] })
    expect((form.get('0') as File).name).toBe('ramen.png')
    expect(h.gqlFetch).not.toHaveBeenCalled()
  })

  it('create without an image: the normal GraphQL mutation, no $api', async () => {
    const created = makeProduct({ id: 'p-new' })
    h.gqlFetch.mockResolvedValue({ createProduct: created })
    const { vm } = await mountPage()

    await expect(vm.handleCreate({ code: 'R1', price: '12.50' })).resolves.toEqual(created)

    expect(h.api).not.toHaveBeenCalled()
    const [query, options] = h.gqlFetch.mock.calls[0]!
    expect(query).toContain('createProduct')
    expect(options).toEqual({ variables: { input: { code: 'R1', price: '12.50' } } })
  })

  it('update with an image: a FormData through $api carrying the id, no JSON Content-Type forced', async () => {
    h.api.mockResolvedValue({ data: { updateProduct: makeProduct({ id: 'p-1' }) } })
    const { vm } = await mountPage()

    await vm.handleUpdate({ id: 'p-1', input: { price: '13.00', image: image() } })

    expect(h.api).toHaveBeenCalledOnce()
    const [url, options] = h.api.mock.calls[0]!
    expect(url).toBe(graphqlUrl())
    expect(options.method).toBe('POST')
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.headers).toBeUndefined()
    const operations = JSON.parse((options.body as FormData).get('operations') as string)
    expect(operations.query).toContain('updateProduct')
    expect(operations.variables).toEqual({ id: 'p-1', input: { price: '13.00', image: null } })
    expect(h.gqlFetch).not.toHaveBeenCalled()
  })

  it('update without an image: the normal GraphQL mutation, no $api', async () => {
    h.gqlFetch.mockResolvedValue({ updateProduct: makeProduct({ id: 'p-1' }) })
    const { vm } = await mountPage()

    await vm.handleUpdate({ id: 'p-1', input: { price: '13.00' } })

    expect(h.api).not.toHaveBeenCalled()
    expect(h.gqlFetch.mock.calls[0]![1]).toEqual({
      variables: { id: 'p-1', input: { price: '13.00' } },
    })
  })

  it('reports a GraphQL error of the upload as a failure (null) without throwing', async () => {
    h.api.mockResolvedValue({ errors: [{ message: 'file too large' }] })
    const { vm } = await mountPage()
    await expect(vm.handleCreate({ code: 'R1', image: image() })).resolves.toBeNull()
  })
})

describe('products page: HubRise', () => {
  const productsQuery = () => h.queries.find((q) => q.includes('products {')) ?? ''
  const hubriseAnswer = (status = makeStatus()) =>
    h.gqlFetch.mockImplementation((query: string) =>
      Promise.resolve(query.includes('hubriseStatus') ? { hubriseStatus: status } : {}),
    )

  it('does not ask for the HubRise fields where the server has no HubRise', async () => {
    hubriseAnswer(makeStatus({ available: false }))
    await mountPage()
    expect(productsQuery()).not.toMatch(/hubrise/iu)
    expect(h.subscriptions[0]).not.toMatch(/hubrise/iu)
  })

  it('does not ask for them when the status cannot be read (an older server)', async () => {
    h.gqlFetch.mockRejectedValue(new Error('Cannot query field "hubriseStatus"'))
    await mountPage()
    expect(productsQuery()).toContain('products {')
    expect(productsQuery()).not.toMatch(/hubrise/iu)
  })

  it('asks for the HubRise fields in the list, the mutations and the live subscription', async () => {
    hubriseAnswer()
    const created = makeProduct({ id: 'p-new' })
    const { vm } = await mountPage()
    expect(productsQuery()).toMatch(
      /hubriseManaged[\s\S]*hubriseLockedFields[\s\S]*hubrisePublish/u,
    )

    h.gqlFetch.mockResolvedValue({ createProduct: created, updateProduct: created })
    await vm.handleCreate({ code: 'R1' })
    await vm.handleUpdate({ id: 'p-1', input: { price: '13.00' } })
    const [create, update] = h.gqlFetch.mock.calls.map(([query]) => query as string)
    expect(create).toContain('hubrisePublish')
    expect(update).toContain('hubriseManaged')
  })

  it('shows the chip of a product HubRise owns, or of its publication', async () => {
    hubriseAnswer()
    h.products = [
      makeProduct({ id: 'p-1', name: 'Managed', hubriseManaged: true } as never),
      makeProduct({
        id: 'p-2',
        name: 'Pending',
        hubrisePublish: { state: 'PENDING', publishedAt: null, ref: null },
      } as never),
      makeProduct({ id: 'p-3', name: 'Plain' }),
    ]
    const { wrapper } = await mountPage()
    const chips = wrapper.findAll('[data-hubrise-chip]').map((c) => c.text())
    expect(chips).toContain('products.hubrise.managed')
    expect(chips).toContain('products.hubrise.pending')
    expect(chips).not.toContain('products.hubrise.published')
  })

  it('says HubRise owns the field when an update is refused (without an image)', async () => {
    const { vm } = await mountPage()
    h.gqlFetch.mockRejectedValue(gqlFailure('HUBRISE_MANAGED'))
    await vm.handleUpdate({ id: 'p-1', input: { price: '13.00' } })
    expect(h.toast).toHaveBeenCalledWith({ title: 'hubrise.errors.managed', color: 'error' })
  })

  it('says HubRise owns the field when an update with an image is refused', async () => {
    const { vm } = await mountPage()
    h.api.mockResolvedValue({ errors: gqlFailure('HUBRISE_MANAGED') })
    await vm.handleUpdate({ id: 'p-1', input: { price: '13.00', image: image() } })
    expect(h.toast).toHaveBeenCalledWith({ title: 'hubrise.errors.managed', color: 'error' })
  })

  it('keeps the generic message for any other failure', async () => {
    const { vm } = await mountPage()
    h.gqlFetch.mockRejectedValue(new Error('boom'))
    await vm.handleUpdate({ id: 'p-1', input: { price: '13.00' } })
    expect(h.toast).toHaveBeenCalledWith({ title: 'orders.errors.updateFailed', color: 'error' })
  })
})
