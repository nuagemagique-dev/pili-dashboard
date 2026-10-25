<template>
  <div>
    <!-- ========== MOBILE VIEW (< md) ========== -->
    <div class="md:hidden">
      <!-- Header -->
      <div class="px-4 pt-4 pb-1 flex items-center justify-between gap-3">
        <div class="min-w-0 flex flex-col gap-0.5">
          <h1 class="text-[26px] leading-[1.1] font-bold text-highlighted truncate">
            {{ t('navigation.products') }}
          </h1>
          <span class="font-mono tabular-nums text-[13px] text-muted"
            >{{ filteredProducts.length }} {{ t('products.itemsCount') }}</span
          >
        </div>
        <UButton
          icon="i-lucide-plus"
          size="lg"
          class="shrink-0 h-11 px-4 text-[15px] font-bold rounded-[10px]"
          @click="openCreateDialog"
        >
          {{ t('products.addShort') }}
        </UButton>
      </div>

      <!-- Sticky toolbar: search + category rail -->
      <div class="sticky top-0 z-30 bg-default py-3 flex flex-col gap-2.5">
        <div class="px-4">
          <UInput
            v-model="searchQuery"
            name="search-products-mobile"
            :placeholder="t('products.search')"
            class="w-full"
            :ui="{
              base: 'h-12 px-4 rounded-xl text-base bg-elevated ring-0 border border-default focus-visible:ring-0 focus-visible:border-inverted',
            }"
          />
        </div>
        <PiliChipRail
          v-model="selectedCategoryId"
          :options="categoryRailOptions"
          :label="t('products.category')"
        />
      </div>

      <div class="px-4 pb-5 flex flex-col gap-2.5">
        <!-- Skeleton Loading -->
        <template v-if="pending">
          <div
            v-for="i in 6"
            :key="i"
            class="rounded-[14px] bg-elevated border border-default overflow-hidden"
          >
            <div class="flex items-center gap-3 p-3">
              <USkeleton class="size-[60px] rounded-[10px] shrink-0" />
              <div class="flex-1 space-y-1.5">
                <USkeleton class="h-4 w-32" />
                <USkeleton class="h-3 w-20" />
                <USkeleton class="h-3 w-16" />
              </div>
            </div>
            <USkeleton class="h-[52px] rounded-none border-t border-default" />
          </div>
        </template>

        <!-- Empty State -->
        <p
          v-else-if="filteredProducts.length === 0"
          class="py-12 px-4 text-center text-[15px] text-muted"
        >
          {{
            searchQuery || selectedCategoryId
              ? t('products.noProductsFiltered')
              : t('products.noProducts')
          }}
        </p>

        <!-- Product cards -->
        <template v-else>
          <div
            v-for="product in filteredProducts"
            :key="product.id"
            class="rounded-[14px] bg-elevated border border-default overflow-hidden"
          >
            <button
              type="button"
              class="w-full p-3 grid grid-cols-[60px_1fr_auto] gap-3 items-center text-left active:bg-accented transition-colors"
              @click="openEditDialog(product)"
            >
              <span
                class="relative size-[60px] rounded-[10px] bg-accented overflow-hidden flex items-center justify-center font-mono tabular-nums text-sm font-bold text-muted"
              >
                {{ product.code }}
                <img
                  v-if="getProductImageUrl(product)"
                  :src="getProductImageUrl(product) ?? undefined"
                  :alt="product.name"
                  class="absolute inset-0 size-full object-cover bg-accented"
                  @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                />
              </span>

              <span class="min-w-0 flex flex-col gap-[3px]">
                <span class="flex items-center gap-1.5 min-w-0">
                  <span
                    class="text-base font-bold leading-tight truncate"
                    :class="
                      product.isAvailable && product.isVisible ? 'text-default' : 'text-muted'
                    "
                    >{{ product.name }}</span
                  >
                  <UIcon
                    v-if="hasMissingTranslations(product)"
                    name="i-lucide-languages"
                    class="size-4 text-warning shrink-0"
                    :title="t('products.translations')"
                  />
                </span>
                <span
                  v-if="getZhName(product)"
                  class="text-[13px] text-muted font-(family-name:--font-zh) truncate"
                  >{{ getZhName(product) }}</span
                >
                <span class="flex items-center gap-2 flex-wrap">
                  <span
                    class="font-mono tabular-nums text-[15px] font-bold"
                    data-allow-mismatch="text"
                    >{{ formatPrice(product.price) }}</span
                  >
                  <span class="text-[13px] text-muted">{{ productMeta(product) }}</span>
                </span>
              </span>

              <UIcon name="i-lucide-chevron-right" class="size-5 text-muted shrink-0" />
            </button>

            <!-- Availability first, then visibility -->
            <div class="grid grid-cols-2 border-t border-default">
              <button
                type="button"
                role="switch"
                :aria-checked="product.isAvailable"
                class="h-[52px] flex items-center justify-center gap-2.5 text-sm font-bold border-r border-default"
                :class="product.isAvailable ? 'text-default' : 'text-warning'"
                :disabled="togglingField === `${product.id}-isAvailable`"
                @click="toggleProductField(product, 'isAvailable', !product.isAvailable)"
              >
                <PiliSwitch
                  presentational
                  size="sm"
                  :model-value="product.isAvailable"
                  :loading="togglingField === `${product.id}-isAvailable`"
                />
                {{ product.isAvailable ? t('common.available') : t('common.unavailable') }}
              </button>
              <button
                type="button"
                role="switch"
                :aria-checked="product.isVisible"
                class="h-[52px] flex items-center justify-center gap-2.5 text-sm font-bold"
                :class="product.isVisible ? 'text-default' : 'text-muted'"
                :disabled="togglingField === `${product.id}-isVisible`"
                @click="toggleProductField(product, 'isVisible', !product.isVisible)"
              >
                <PiliSwitch
                  presentational
                  size="sm"
                  :model-value="product.isVisible"
                  :loading="togglingField === `${product.id}-isVisible`"
                />
                {{ product.isVisible ? t('common.visible') : t('common.invisible') }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div class="hidden md:block md:p-6">
      <!-- Page Header (md+) -->
      <div class="mb-6 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-2xl font-bold text-highlighted truncate">
            {{ t('navigation.products') }}
          </h1>
          <p class="text-sm text-muted mt-0.5">
            {{ filteredProducts.length }} {{ t('orders.items') }}
          </p>
        </div>
        <UButton icon="i-lucide-plus" @click="openCreateDialog">
          {{ t('products.add') }}
        </UButton>
      </div>

      <!-- Toolbar (md+, in normal flow inside wrapper) -->
      <div class="pb-4">
        <UInput
          v-model="searchQuery"
          name="search-products"
          icon="i-lucide-search"
          :placeholder="t('products.search')"
          size="lg"
          class="w-full"
          :ui="{
            base: 'h-12 text-base bg-accented ring-0 border border-default focus-visible:ring-0 focus-visible:border-inverted',
          }"
        />

        <div class="mt-3 flex gap-2 flex-wrap">
          <button
            v-for="cat in categoryFilterItems"
            :key="`d-${cat.id ?? 'all'}`"
            type="button"
            class="shrink-0 inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-sm font-medium border transition-all active:scale-95"
            :class="
              selectedCategoryId === cat.id
                ? 'bg-inverted text-inverted border-inverted'
                : 'bg-transparent text-muted border-default'
            "
            @click="selectedCategoryId = cat.id"
          >
            {{ cat.name }}
          </button>
        </div>
      </div>

      <!-- ========== TABLET+ VIEW: Table (md+) ========== -->
      <div class="hidden md:block rounded-[14px] border border-default overflow-hidden bg-elevated">
        <UTable
          v-if="!pending && filteredProducts.length > 0"
          :data="paginatedProducts"
          :columns="columns"
          :loading="pending"
          :ui="{
            th: 'font-mono text-xs font-normal uppercase tracking-wider text-muted py-3 px-4',
            td: 'py-3 px-4',
            tr: 'cursor-pointer hover:bg-accented transition-colors',
          }"
          @select="onRowSelect"
        >
          <!-- Product name + image -->
          <template #name-cell="{ row }">
            <div class="flex items-center gap-3">
              <div
                class="size-9 rounded-lg border border-default bg-accented overflow-hidden shrink-0 flex items-center justify-center"
              >
                <img
                  v-if="getProductImageUrl(row.original)"
                  :src="getProductImageUrl(row.original) ?? undefined"
                  :alt="row.original.name"
                  class="size-full object-cover"
                  @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
                />
                <UIcon v-else name="i-lucide-image-off" class="size-4 text-muted" />
              </div>
              <p class="font-medium text-sm text-highlighted truncate">{{ row.original.name }}</p>
            </div>
          </template>

          <!-- Code -->
          <template #code-cell="{ row }">
            <span class="text-sm font-mono tabular-nums text-muted">{{
              row.original.code ?? '-'
            }}</span>
          </template>

          <!-- Category -->
          <template #category-cell="{ row }">
            <span class="text-sm">{{ row.original.category.name }}</span>
          </template>

          <!-- Price -->
          <template #price-cell="{ row }">
            <span class="text-sm font-semibold font-mono tabular-nums" data-allow-mismatch="text">{{
              formatPrice(row.original.price)
            }}</span>
          </template>

          <!-- Pieces -->
          <template #pieceCount-cell="{ row }">
            <span class="text-sm font-mono tabular-nums text-muted">{{
              row.original.pieceCount ?? '-'
            }}</span>
          </template>

          <!-- Visibility toggle -->
          <template #isVisible-cell="{ row }">
            <button
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border border-default bg-transparent active:scale-95 cursor-pointer"
              :class="row.original.isVisible ? 'text-success' : 'text-muted'"
              :disabled="togglingField === `${row.original.id}-isVisible`"
              @click.stop="toggleProductField(row.original, 'isVisible', !row.original.isVisible)"
            >
              <UIcon
                :name="
                  togglingField === `${row.original.id}-isVisible`
                    ? 'i-lucide-loader-2'
                    : row.original.isVisible
                      ? 'i-lucide-eye'
                      : 'i-lucide-eye-off'
                "
                class="size-3.5"
                :class="{ 'animate-spin': togglingField === `${row.original.id}-isVisible` }"
              />
              {{ row.original.isVisible ? t('common.visible') : t('common.invisible') }}
            </button>
          </template>

          <!-- Availability toggle -->
          <template #isAvailable-cell="{ row }">
            <button
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border border-default bg-transparent active:scale-95 cursor-pointer"
              :class="row.original.isAvailable ? 'text-success' : 'text-warning'"
              :disabled="togglingField === `${row.original.id}-isAvailable`"
              @click.stop="
                toggleProductField(row.original, 'isAvailable', !row.original.isAvailable)
              "
            >
              <UIcon
                :name="
                  togglingField === `${row.original.id}-isAvailable`
                    ? 'i-lucide-loader-2'
                    : row.original.isAvailable
                      ? 'i-lucide-circle-check'
                      : 'i-lucide-circle-x'
                "
                class="size-3.5"
                :class="{ 'animate-spin': togglingField === `${row.original.id}-isAvailable` }"
              />
              {{ row.original.isAvailable ? t('common.available') : t('common.unavailable') }}
            </button>
          </template>

          <!-- Dietary badges -->
          <template #tags-cell="{ row }">
            <div class="flex gap-1">
              <UBadge v-if="row.original.isHalal" color="neutral" variant="solid" size="xs">
                {{ t('products.halal') }}
              </UBadge>
              <UBadge v-if="row.original.isVegetarian" color="neutral" variant="solid" size="xs">
                {{ t('products.vegetarian') }}
              </UBadge>
              <UBadge v-if="row.original.isSpicy" color="neutral" variant="solid" size="xs">
                <UIcon name="i-lucide-flame" class="size-3 text-error" />
                {{ t('products.spicy') }}
              </UBadge>
            </div>
          </template>

          <!-- Translation flags -->
          <template #translations-cell="{ row }">
            <div class="flex gap-1">
              <UBadge
                v-for="lang in availableLocales"
                :key="lang"
                :color="hasTranslation(row.original, lang) ? 'success' : 'error'"
                variant="solid"
                size="xs"
              >
                {{ lang.toUpperCase() }}
              </UBadge>
            </div>
          </template>

          <!-- Actions -->
          <template #actions-cell="{ row }">
            <div class="flex justify-end">
              <UButton
                icon="i-lucide-pencil"
                size="sm"
                color="neutral"
                variant="ghost"
                @click.stop="openEditDialog(row.original)"
              />
            </div>
          </template>
        </UTable>

        <!-- Skeleton Loading -->
        <div v-if="pending" class="divide-y divide-default">
          <div v-for="i in 8" :key="i" class="flex items-center gap-4 px-4 py-3">
            <USkeleton class="size-9 rounded-lg" />
            <div class="flex-1 space-y-1.5">
              <USkeleton class="h-3.5 w-32" />
              <USkeleton class="h-3 w-16" />
            </div>
            <USkeleton class="h-3.5 w-20 hidden sm:block" />
            <USkeleton class="h-3.5 w-16 hidden sm:block" />
            <USkeleton class="h-6 w-20 rounded-full hidden md:block" />
            <USkeleton class="h-6 w-20 rounded-full hidden md:block" />
            <USkeleton class="h-5 w-5 rounded hidden lg:block" />
          </div>
        </div>

        <!-- Empty State -->
        <div
          v-if="!pending && filteredProducts.length === 0"
          class="flex flex-col items-center justify-center py-16"
        >
          <UIcon name="i-lucide-package-x" class="size-12 mb-3 text-muted" />
          <p class="text-muted text-sm">
            {{
              searchQuery || selectedCategoryId
                ? t('products.noProductsFiltered')
                : t('products.noProducts')
            }}
          </p>
        </div>

        <!-- Pagination -->
        <div
          v-if="!pending && filteredProducts.length > pageSize"
          class="flex justify-center py-4 border-t border-default"
        >
          <UPagination
            v-model:page="page"
            :total="filteredProducts.length"
            :items-per-page="pageSize"
            show-edges
          />
        </div>
      </div>
    </div>

    <!-- Modals (UModal handles its own teleport) -->
    <ProductDialog
      v-if="createDialog"
      mode="create"
      :on-create="handleCreate"
      @close="createDialog = false"
    />

    <ProductDialog
      v-if="selectedProduct"
      :product="selectedProduct"
      mode="edit"
      @update="handleUpdate"
      @close="selectedProduct = null"
    />
  </div>
</template>

<script lang="ts" setup>
import type { CreateProductInput, Product, ProductCategory, UpdateProductRequest } from '~/types'
import { buildGraphqlUpload } from '~/utils/graphqlUpload'
import { computed, ref, watch } from 'vue'
import {
  useCategoriesStore,
  useGqlMutation,
  useGqlQuery,
  useGqlSubscription,
  useNuxtApp,
} from '#imports'
import ProductDialog from '~/components/ProductDialog.vue'
import { useI18n } from 'vue-i18n'

const { $api } = useNuxtApp()
const config = useRuntimeConfig()
const graphqlUrl = config.public.graphqlHttp as string
const s3bucketUrl = config.public.s3bucketUrl as string
const { t, availableLocales } = useI18n()
const categoryStore = useCategoriesStore()
const toast = useToast()

// Helper: Check if a translation is complete.
const hasTranslation = (product: Product, lang: string) => {
  const translation = product.translations.find((tr) => tr.language === lang)
  return translation && translation.name && translation.name.trim() !== ''
}

// Helper: True if any of the available locales is missing a translation.
const hasMissingTranslations = (product: Product) =>
  availableLocales.some((lang) => !hasTranslation(product, lang))

// Helper: Return the flag emoji for each language.
const getFlagEmoji = (lang: string) => {
  switch (lang) {
    case 'fr':
      return '🇫🇷'
    case 'en':
      return '🇬🇧'
    case 'zh':
      return '🇨🇳'
    case 'nl':
      return '🇳🇱'
    default:
      return ''
  }
}

const imageCacheBust = reactive<Record<string, number>>({})

// Helper: Get product thumbnail URL
const getProductImageUrl = (product: Product) => {
  if (!s3bucketUrl || !product.id) return null
  const bust = imageCacheBust[product.id]
  return `${s3bucketUrl}/images/thumbnails/${product.id}.png${bust ? `?v=${bust}` : ''}`
}

const searchQuery = ref('')
const selectedCategoryId = ref<string | null>(null)

// Pagination state
const page = ref(1)
const pageSize = ref(10)

// Table columns
const columns = computed(() => [
  { accessorKey: 'code', header: t('products.code') },
  { accessorKey: 'category', header: t('products.category') },
  { accessorKey: 'name', header: t('common.name') },
  {
    accessorKey: 'price',
    header: t('common.price'),
    meta: {
      class: { td: 'hidden sm:table-cell text-right', th: 'hidden sm:table-cell text-right' },
    },
  },
  {
    accessorKey: 'pieceCount',
    header: t('products.pieceCount'),
    meta: {
      class: { td: 'hidden lg:table-cell text-right', th: 'hidden lg:table-cell text-right' },
    },
  },
  {
    accessorKey: 'isVisible',
    header: t('common.visibility'),
    meta: { class: { td: 'hidden md:table-cell', th: 'hidden md:table-cell' } },
  },
  {
    accessorKey: 'isAvailable',
    header: t('common.availability'),
    meta: { class: { td: 'hidden md:table-cell', th: 'hidden md:table-cell' } },
  },
  {
    accessorKey: 'tags',
    header: '',
    enableSorting: false,
    meta: { class: { td: 'hidden xl:table-cell', th: 'hidden xl:table-cell' } },
  },
  {
    accessorKey: 'translations',
    header: t('products.translations'),
    enableSorting: false,
    meta: { class: { td: 'hidden lg:table-cell', th: 'hidden lg:table-cell' } },
  },
  { accessorKey: 'actions', header: '', enableSorting: false },
])

const PRODUCTS_QUERY = /* GraphQL */ `
  query {
    products {
      id
      price
      code
      slug
      pieceCount
      isVisible
      isAvailable
      isHalal
      isLunchOnly
      isSpicy
      isVegetarian
      isDiscountable
      vatCategory
      name
      description
      category {
        id
        name
      }
      choices {
        id
        productId
        choiceGroupId
        priceModifier
        sortOrder
        name
        translations {
          locale
          name
        }
      }
      translations {
        language
        name
        description
      }
    }
  }
`

const PRODUCT_CATEGORIES_QUERY = /* GraphQL */ `
  query {
    productCategories {
      id
      name
      order
      slug
      translations {
        language
        name
        description
      }
    }
  }
`

const CREATE_PRODUCT_MUTATION = /* GraphQL */ `
  mutation ($input: CreateProductInput!) {
    createProduct(input: $input) {
      id
      price
      code
      slug
      pieceCount
      isVisible
      isAvailable
      isHalal
      isLunchOnly
      isSpicy
      isVegetarian
      isDiscountable
      vatCategory
      name
      description
      category {
        id
        name
      }
      choices {
        id
        productId
        choiceGroupId
        priceModifier
        sortOrder
        name
        translations {
          locale
          name
        }
      }
      translations {
        language
        name
        description
      }
    }
  }
`

const UPDATE_PRODUCT_MUTATION = /* GraphQL */ `
  mutation ($id: ID!, $input: UpdateProductInput!) {
    updateProduct(id: $id, input: $input) {
      id
      price
      code
      slug
      pieceCount
      isVisible
      isAvailable
      isHalal
      isLunchOnly
      isSpicy
      isVegetarian
      isDiscountable
      vatCategory
      name
      description
      category {
        id
        name
      }
      choices {
        id
        productId
        choiceGroupId
        priceModifier
        sortOrder
        name
        translations {
          locale
          name
        }
      }
      translations {
        language
        name
        description
      }
    }
  }
`

// Lightweight mutation for inline toggles
const TOGGLE_PRODUCT_MUTATION = /* GraphQL */ `
  mutation ($id: ID!, $input: UpdateProductInput!) {
    updateProduct(id: $id, input: $input) {
      id
      isVisible
      isAvailable
    }
  }
`

const SUB_PRODUCT_UPDATED = /* GraphQL */ `
  subscription ProductUpdated {
    productUpdated {
      id
      isAvailable
      isVisible
      price
      code
      pieceCount
      isHalal
      isLunchOnly
      isSpicy
      isVegetarian
      isDiscountable
      vatCategory
      name
      slug
    }
  }
`

// Fetch products
const { data: dataProducts, pending } = await useGqlQuery<{ products: Product[] }>(
  PRODUCTS_QUERY,
  {},
  { immediate: true, cache: true },
)

const products = computed(() => dataProducts.value?.products ?? [])

// Fetch categories
const { data: dataCategories } = await useGqlQuery<{ productCategories: ProductCategory[] }>(
  PRODUCT_CATEGORIES_QUERY,
  {},
  { immediate: true },
)

if (dataCategories.value?.productCategories) {
  categoryStore.setCategories(dataCategories.value?.productCategories)
}

// Category order lookup: categoryId → order
const categoryOrderMap = computed(() => {
  const map = new Map<string, number>()
  for (const cat of dataCategories.value?.productCategories ?? []) {
    map.set(cat.id, cat.order)
  }
  return map
})

// Category filter dropdown items
const categoryFilterItems = computed(() => {
  const all = { id: null as string | null, name: t('orders.all') }
  const cats = (dataCategories.value?.productCategories ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ id: c.id, name: c.name }))
  return [all, ...cats]
})

// Category rail options for the mobile chip rail
const categoryRailOptions = computed(() =>
  categoryFilterItems.value.map((c) => ({ value: c.id, label: c.name })),
)

// Chinese name shown under the French name on mobile cards
const getZhName = (product: Product) =>
  product.translations.find((tr) => tr.language === 'zh')?.name?.trim() || ''

// Plain-text meta line: category, pieces, dietary flags
const productMeta = (product: Product) =>
  [
    product.category.name,
    product.pieceCount ? `${product.pieceCount} ${t('products.piecesShort')}` : '',
    product.isHalal ? t('products.halal') : '',
    product.isVegetarian ? t('products.vegetarian') : '',
    product.isSpicy ? t('products.spicy') : '',
  ]
    .filter(Boolean)
    .join(' · ')

// Filter and sort products (same order as /menu: category order, then product code)
const filteredProducts = computed(() => {
  let result = products.value

  if (selectedCategoryId.value) {
    result = result.filter((p) => p.category.id === selectedCategoryId.value)
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(
      (product) =>
        product.name.toLowerCase().includes(query) ||
        (product.code && product.code.toLowerCase().includes(query)) ||
        product.category.name.toLowerCase().includes(query),
    )
  }

  // Sort by category order, then by product code (alphanumeric)
  const orderMap = categoryOrderMap.value
  return result.slice().sort((a, b) => {
    const catOrderA = orderMap.get(a.category.id) ?? Infinity
    const catOrderB = orderMap.get(b.category.id) ?? Infinity
    if (catOrderA !== catOrderB) return catOrderA - catOrderB

    const codeA = a.code ?? ''
    const codeB = b.code ?? ''
    const alphaA = codeA.match(/^[A-Za-z]+/u)?.[0] ?? ''
    const alphaB = codeB.match(/^[A-Za-z]+/u)?.[0] ?? ''
    if (alphaA !== alphaB) return alphaA.localeCompare(alphaB)

    const numA = parseInt(codeA.match(/[0-9]+/u)?.[0] ?? '0', 10)
    const numB = parseInt(codeB.match(/[0-9]+/u)?.[0] ?? '0', 10)
    if (numA !== numB) return numA - numB

    return a.name.localeCompare(b.name)
  })
})

// Paginate the filtered products
const paginatedProducts = computed(() => {
  const start = (page.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredProducts.value.slice(start, end)
})

// Reset page to 1 when filters change
watch([searchQuery, selectedCategoryId], () => {
  page.value = 1
})

// State for dialogs
const selectedProduct = ref<Product | null>(null)
const createDialog = ref(false)

// Inline toggle state
const togglingField = ref<string | null>(null)

const toggleProductField = async (
  product: Product,
  field: 'isAvailable' | 'isVisible',
  value: boolean,
) => {
  const fieldKey = `${product.id}-${field}`
  togglingField.value = fieldKey

  try {
    const { mutate } = useGqlMutation<{ updateProduct: Product }>(TOGGLE_PRODUCT_MUTATION)
    await mutate({
      id: product.id,
      input: { [field]: value },
    })

    // Update local data: reassign dataProducts.value because useAsyncData uses shallowRef
    if (dataProducts.value?.products) {
      const idx = dataProducts.value.products.findIndex((p) => p.id === product.id)
      if (idx !== -1) {
        dataProducts.value = {
          ...dataProducts.value,
          products: dataProducts.value.products.map((p, i) =>
            i === idx ? ({ ...p, [field]: value } as Product) : p,
          ),
        }
      }
    }
  } catch (err) {
    if (import.meta.dev) console.error(`Toggle ${field} failed:`, err)
    toast.add({ title: t('orders.errors.updateFailed'), color: 'error' })
  } finally {
    togglingField.value = null
  }
}

// Row select handler for UTable
const onRowSelect = (_e: Event, row: any) => {
  openEditDialog(row.original)
}

// Open the edit dialog
const openEditDialog = (product: Product) => {
  selectedProduct.value = product
}

// Open the create dialog
const openCreateDialog = () => {
  createDialog.value = true
}

const handleCreate = async (newProductInput: CreateProductInput): Promise<Product | null> => {
  let newProduct: Product
  const { image, ...productData } = newProductInput

  try {
    if (image instanceof File) {
      const form = buildGraphqlUpload({
        query: CREATE_PRODUCT_MUTATION,
        variables: { input: productData },
        fileVariable: 'input.image',
        file: image,
      })

      const res = await $api<{ data: { createProduct: Product }; errors?: { message: string }[] }>(
        graphqlUrl,
        {
          method: 'POST',
          body: form,
        },
      )

      if (res.errors?.length) {
        if (import.meta.dev) console.error('GraphQL errors:', res.errors)
        toast.add({ title: t('orders.errors.updateFailed'), color: 'error' })
        return null
      }

      newProduct = res.data.createProduct
    } else {
      const { mutate: mutationCreateProduct } = useGqlMutation<{ createProduct: Product }>(
        CREATE_PRODUCT_MUTATION,
      )
      const res: { createProduct: Product } = await mutationCreateProduct({
        input: productData,
      })
      newProduct = res.createProduct
    }

    if (dataProducts.value?.products) {
      dataProducts.value = {
        ...dataProducts.value,
        products: [newProduct, ...dataProducts.value.products],
      }
    }

    return newProduct
  } catch (err) {
    if (import.meta.dev) console.error('handleCreate failed:', err)
    toast.add({ title: t('orders.errors.updateFailed'), color: 'error' })
    return null
  }
}

// Handle product updates (edit mode)
const handleUpdate = async (updateReq: UpdateProductRequest) => {
  let updated: Product
  const { id, input } = updateReq
  const { image, ...productData } = input as CreateProductInput

  try {
    if (image instanceof File) {
      const form = buildGraphqlUpload({
        query: UPDATE_PRODUCT_MUTATION,
        variables: { id, input: productData },
        fileVariable: 'input.image',
        file: image,
      })

      const res = await $api<{ data: { updateProduct: Product }; errors?: { message: string }[] }>(
        graphqlUrl,
        {
          method: 'POST',
          body: form,
        },
      )

      if (res.errors?.length) {
        if (import.meta.dev) console.error('GraphQL errors:', res.errors)
        toast.add({ title: t('orders.errors.updateFailed'), color: 'error' })
        return
      }

      updated = res.data.updateProduct
      imageCacheBust[updated.id] = Date.now()
    } else {
      const { mutate: mutationUpdateProduct } = useGqlMutation<{ updateProduct: Product }>(
        UPDATE_PRODUCT_MUTATION,
      )

      const { updateProduct } = await mutationUpdateProduct({
        id,
        input: productData,
      })
      updated = updateProduct
    }

    if (dataProducts.value?.products) {
      const idx = dataProducts.value.products.findIndex((p) => p.id === updated.id)
      if (idx !== -1) {
        dataProducts.value = {
          ...dataProducts.value,
          products: dataProducts.value.products.map((p, i) => (i === idx ? updated : p)),
        }
      }
    }

    selectedProduct.value = null
  } catch (err) {
    if (import.meta.dev) console.error('handleUpdate failed:', err)
    toast.add({ title: t('orders.errors.updateFailed'), color: 'error' })
  }
}

// Subscribe in setup so onScopeDispose ties to the component scope; in onMounted it leaks the WebSocket.
const { data: liveProduct } = useGqlSubscription<{ productUpdated: Partial<Product> }>(
  SUB_PRODUCT_UPDATED,
)
watch(liveProduct, (val) => {
  if (!val?.productUpdated?.id || !dataProducts.value?.products) return
  const idx = dataProducts.value.products.findIndex((p) => p.id === val.productUpdated.id)
  if (idx !== -1) {
    dataProducts.value.products.splice(idx, 1, {
      ...dataProducts.value.products[idx]!,
      ...val.productUpdated,
    } as Product)
  }
})
</script>
