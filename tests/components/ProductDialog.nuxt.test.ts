// components/ProductDialog.vue: removing a choice or a choice group only stages it; nothing reaches the API before Save,
// so closing the dialog keeps the product as it was. On Save, a group left without choices is deleted instead of being
// saved: the shop prints every required group on the card and an empty one can never be satisfied (see
// utils/choiceGroups.ts). Run: `vp test run tests/components/ProductDialog.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import type { ProductChoice, ProductChoiceGroup } from '~/types'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { makeProduct } from '../fixtures/dashboard'
import { bodySelector, bodyText } from '../helpers/dom'
import { gqlFailure } from '../fixtures/hubrise'
import { settle } from '../helpers/settle'

const h = vi.hoisted(() => ({
  gqlFetch:
    vi.fn<(query: string, options: { variables: Record<string, unknown> }) => Promise<unknown>>(),
}))

mockNuxtImport(
  'useNuxtApp',
  (original) => () =>
    new Proxy(original(), {
      get(target, key, receiver) {
        if (key === '$gqlFetch') return h.gqlFetch
        return Reflect.get(target, key, receiver)
      },
    }),
)
mockNuxtImport('useIsMobile', () => () => ref(false))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../helpers/i18n')
  return {
    ...(await importOriginal<typeof VueI18NModule>()),
    useI18n: () => ({ ...fakeI18n(), availableLocales: ['fr', 'en'] }),
  }
})

interface DialogVm {
  removeChoice: (groupIdx: number, choiceIdx: number) => void
  removeChoiceGroup: (groupIdx: number) => void
  saveChanges: () => Promise<void>
  validationErrors: string[]
}

const choice = (id: string, groupId: string, name: string): ProductChoice => ({
  id,
  productId: 'p-1',
  choiceGroupId: groupId,
  priceModifier: '0',
  sortOrder: 0,
  name,
  translations: [{ locale: 'fr', name }],
})

const group = (id: string, name: string, choices: ProductChoice[]): ProductChoiceGroup => ({
  id,
  productId: 'p-1',
  minSelections: 1,
  maxSelections: 1,
  sortOrder: 0,
  name,
  translations: [{ locale: 'fr', name }],
  choices,
})

// A poke bowl: "Base" (riz vinaigré / salade mix) and "Sauce" (one choice).
const pokeBowl = () =>
  makeProduct({
    id: 'p-1',
    name: 'Saumon',
    vatCategory: 'food',
    translations: [{ language: 'fr', name: 'Saumon', description: null }],
    choiceGroups: [
      group('g-base', 'Base', [
        choice('c-rice', 'g-base', 'Riz vinaigré'),
        choice('c-salad', 'g-base', 'Salade mix'),
      ]),
      group('g-sauce', 'Sauce', [choice('c-soy', 'g-sauce', 'Soja sucrée')]),
    ],
  } as never)

const mountDialog = async () => {
  const Dialog = (await import('~/components/ProductDialog.vue')).default
  const wrapper = await mountSuspended(Dialog, { props: { product: pokeBowl(), mode: 'edit' } })
  await settle()
  return { wrapper, vm: wrapper.vm as unknown as DialogVm }
}

/** The mutations sent, as `name(variables)` pairs, in order. */
const sentMutations = () =>
  h.gqlFetch.mock.calls.map(([query, options]) => ({
    name: /\{\s*(\w+)/u.exec(query.slice(query.indexOf('{')))?.[1],
    variables: options.variables,
  }))

beforeEach(() => {
  h.gqlFetch.mockReset()
  h.gqlFetch.mockImplementation((query: string) =>
    Promise.resolve(
      query.includes('createProductChoiceGroup')
        ? { createProductChoiceGroup: { id: 'g-new' } }
        : { ok: true },
    ),
  )
})

describe('ProductDialog: choice groups', () => {
  it('removing choices or a group calls no API until Save', async () => {
    const { vm, wrapper } = await mountDialog()

    vm.removeChoice(1, 0)
    vm.removeChoiceGroup(0)
    await settle()

    expect(h.gqlFetch).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(h.gqlFetch).not.toHaveBeenCalled()
  })

  it('on Save, deletes the removed choice and the group it left empty, and saves only the non-empty group', async () => {
    const { vm, wrapper } = await mountDialog()

    vm.removeChoice(1, 0)
    await vm.saveChanges()

    expect(vm.validationErrors).toEqual([])
    const sent = sentMutations()
    expect(sent.filter((m) => m.name === 'deleteProductChoice')).toEqual([
      { name: 'deleteProductChoice', variables: { id: 'c-soy' } },
    ])
    expect(sent.filter((m) => m.name === 'deleteProductChoiceGroup')).toEqual([
      { name: 'deleteProductChoiceGroup', variables: { id: 'g-sauce' } },
    ])
    const updatedGroups = sent.filter((m) => m.name === 'updateProductChoiceGroup')
    expect(updatedGroups.map((m) => m.variables.id)).toEqual(['g-base'])
    expect(sent.some((m) => m.name === 'createProductChoiceGroup')).toBe(false)
    expect(wrapper.emitted('update')?.[0]?.[0]).toMatchObject({ id: 'p-1' })
  })

  it('on Save, deletes a removed group (its choices go with it through the cascade)', async () => {
    const { vm } = await mountDialog()

    vm.removeChoiceGroup(1)
    await vm.saveChanges()

    const sent = sentMutations()
    expect(sent.filter((m) => m.name === 'deleteProductChoiceGroup')).toEqual([
      { name: 'deleteProductChoiceGroup', variables: { id: 'g-sauce' } },
    ])
    expect(sent.some((m) => m.name === 'deleteProductChoice')).toBe(false)
  })

  it('a failed delete blocks the update, and a retry resumes where it stopped', async () => {
    const { vm, wrapper } = await mountDialog()
    h.gqlFetch.mockRejectedValueOnce(new Error('order_product_choices_product_choice_id_fkey'))

    vm.removeChoice(0, 0)
    await vm.saveChanges()

    expect(vm.validationErrors).toEqual(['validation.choiceSaveFailed'])
    expect(wrapper.emitted('update')).toBeUndefined()

    h.gqlFetch.mockClear()
    await vm.saveChanges()

    const deletes = sentMutations().filter((m) => m.name === 'deleteProductChoice')
    expect(deletes).toEqual([{ name: 'deleteProductChoice', variables: { id: 'c-rice' } }])
    expect(wrapper.emitted('update')).toHaveLength(1)
  })
})

describe('ProductDialog: HubRise', () => {
  const withHubrise = (extra: Record<string, unknown>) =>
    ({ ...pokeBowl(), code: 'R12', ...extra }) as never

  const mountWith = async (extra: Record<string, unknown>) => {
    const Dialog = (await import('~/components/ProductDialog.vue')).default
    const wrapper = await mountSuspended(Dialog, {
      props: { product: withHubrise(extra), mode: 'edit' },
    })
    await settle()
    return wrapper
  }

  /** The inputs of the dialog that are disabled, by their placeholder. */
  const disabledFields = () =>
    [...document.body.querySelectorAll<HTMLInputElement>('input')]
      .filter((input) => input.disabled)
      .map((input) => input.placeholder)

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('shows nothing about HubRise where the server has none', async () => {
    await mountWith({})
    expect(bodySelector('[data-testid="product-hubrise-managed"]')).toBeNull()
    expect(bodySelector('[data-testid="product-hubrise-publish"]')).toBeNull()
    expect(disabledFields()).toEqual([])
  })

  it('marks a product HubRise owns and locks the fields the server lists', async () => {
    await mountWith({
      hubriseManaged: true,
      hubriseLockedFields: ['price', 'category', 'vatCategory', 'code', 'choiceGroups'],
    })
    expect(bodySelector('[data-testid="product-hubrise-managed"]')!.textContent).toContain(
      'products.hubrise.managed',
    )
    const disabled = disabledFields()
    for (const placeholder of ['products.code', 'products.priceEuro', '1', '0', '0.00']) {
      expect(disabled).toContain(placeholder)
    }
    // The names stay editable: the catalog language is the shop's to correct.
    expect(disabled).not.toContain('common.name')
    expect(
      [...document.body.querySelectorAll('button')]
        .filter((b) => b.disabled)
        .map((b) => b.textContent.trim()),
    ).toEqual(expect.arrayContaining(['products.choices.groupAdd', 'products.choices.add']))
  })

  it('locks only the fields the server lists', async () => {
    await mountWith({ hubriseManaged: true, hubriseLockedFields: ['price'] })
    expect(disabledFields()).toEqual(['products.priceEuro'])
  })

  it('leaves everything editable for a product that is not managed', async () => {
    await mountWith({ hubriseManaged: false, hubriseLockedFields: ['price'] })
    expect(bodySelector('[data-testid="product-hubrise-managed"]')).toBeNull()
    expect(disabledFields()).toEqual([])
  })

  it.each([
    ['PUBLISHED', 'products.hubrise.published'],
    ['PENDING', 'products.hubrise.pending'],
    ['NOT_PUBLISHED', 'products.hubrise.notPublished'],
  ])('shows where the publication stands (%s)', async (state, key) => {
    await mountWith({
      hubrisePublish: { state, publishedAt: '2026-10-24T10:00:00Z', ref: 'R12' },
    })
    const block = bodySelector('[data-testid="product-hubrise-publish"]')!
    expect(block.textContent).toContain(key)
    expect(block.textContent).toContain('products.hubrise.ref{"ref":"R12"}')
    expect(block.textContent).toMatch(/products\.hubrise\.publishedAt\{"time":"[^"]*12:00/u)
    expect(block.querySelector('a')!.getAttribute('href')).toContain('/hubrise')
    expect(disabledFields()).toEqual([])
  })

  it('says a product was never published, and shows no SKU yet', async () => {
    await mountWith({ hubrisePublish: { state: 'NOT_PUBLISHED', publishedAt: null, ref: null } })
    const block = bodySelector('[data-testid="product-hubrise-publish"]')!
    expect(block.textContent).toContain('products.hubrise.neverPublished')
    expect(block.textContent).not.toContain('products.hubrise.ref')
  })

  it('shows nothing when the publication is unknown (null outside PUBLISH)', async () => {
    await mountWith({ hubrisePublish: null })
    expect(bodySelector('[data-testid="product-hubrise-publish"]')).toBeNull()
  })

  it('tells that HubRise owns the option groups when saving them is refused', async () => {
    h.gqlFetch.mockRejectedValue(gqlFailure('HUBRISE_MANAGED'))
    const wrapper = await mountWith({})
    const vm = wrapper.vm as unknown as DialogVm
    vm.removeChoice(0, 0)
    await vm.saveChanges()
    expect(vm.validationErrors).toEqual(['hubrise.errors.managed'])
    expect(wrapper.emitted('update')).toBeUndefined()
    expect(bodyText()).toContain('hubrise.errors.managed')
  })
})
