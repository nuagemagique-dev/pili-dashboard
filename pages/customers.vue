<template>
  <div class="md:p-6">
    <!-- Desktop: header, summary and filters (>= md) -->
    <div class="hidden md:block">
      <!-- Page Header -->
      <div class="mb-6">
        <h1 class="text-lg sm:text-2xl font-bold text-highlighted">{{ t('customers.title') }}</h1>
        <p class="hidden sm:block text-sm text-muted mt-0.5">{{ t('customers.subtitle') }}</p>
      </div>

      <!-- Summary Cards -->
      <div
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4 mb-3 sm:mb-6"
      >
        <div
          v-for="card in summaryCards"
          :key="card.label"
          class="rounded-[14px] border border-default bg-elevated p-3 sm:p-4"
        >
          <div class="flex items-center gap-3">
            <UIcon :name="card.icon" class="size-5 text-muted shrink-0" />
            <div class="min-w-0">
              <p class="text-xs text-muted leading-tight">{{ card.label }}</p>
              <div
                class="text-base sm:text-lg font-bold text-highlighted font-mono tabular-nums truncate"
              >
                <USkeleton v-if="pending" class="h-5 w-14 mt-1" />
                <template v-else>{{ card.value }}</template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Filters Bar (sticky on mobile) -->
      <div
        class="sticky top-0 z-20 -mx-3 sm:mx-0 px-3 sm:px-0 pb-3 sm:pb-4 pt-1 bg-default sm:static sm:bg-transparent"
      >
        <!-- Search row (search + min orders) -->
        <div class="flex items-center gap-2">
          <UInput
            v-model="searchQuery"
            icon="i-lucide-search"
            :placeholder="t('customers.search')"
            size="lg"
            class="flex-1"
            :ui="{ base: 'h-12 text-base bg-accented' }"
          />
          <UInput
            id="min-orders"
            v-model.number="minOrders"
            type="number"
            :placeholder="t('customers.filters.minOrders')"
            :min="1"
            size="lg"
            class="w-24 sm:w-32 shrink-0"
            icon="i-lucide-hash"
            :ui="{ base: 'h-12 text-base bg-accented font-mono tabular-nums' }"
            :aria-label="t('customers.filters.minOrders')"
          />
        </div>

        <!-- Combined chip rail: period + type -->
        <div
          class="relative mt-2 sm:mt-3 -mx-3 sm:mx-0 px-3 sm:px-0 flex items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible scrollbar-hide"
        >
          <button
            v-for="preset in periodPresets"
            :key="`p-${preset.key}`"
            type="button"
            class="shrink-0 inline-flex items-center h-10 px-4 rounded-lg text-sm font-medium border transition-all active:scale-95"
            :class="
              selectedPeriod === preset.key
                ? 'bg-inverted text-inverted border-transparent'
                : 'bg-accented text-muted border-default hover:text-default'
            "
            @click="selectPeriod(preset.key)"
          >
            {{ preset.label }}
          </button>

          <span class="shrink-0 h-6 w-px bg-(--ui-border)" aria-hidden="true" />

          <button
            v-for="opt in orderTypeOptions"
            :key="`t-${opt.value}`"
            type="button"
            class="shrink-0 inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-sm font-medium border transition-all active:scale-95"
            :class="
              selectedOrderType === opt.value
                ? 'bg-inverted text-inverted border-transparent'
                : 'bg-accented text-muted border-default hover:text-default'
            "
            @click="selectedOrderType = opt.value"
          >
            <UIcon v-if="opt.icon" :name="opt.icon" class="size-4" />
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- ========== MOBILE VIEW (< md) ========== -->
    <div class="md:hidden">
      <PiliSubHeader :title="t('navigation.customers')" />

      <div class="px-4 pt-1 grid grid-cols-2 gap-2">
        <PiliStatCard
          v-for="card in summaryCards.slice(0, 4)"
          :key="card.label"
          size="lg"
          :label="card.label"
          :value="pending ? '-' : card.value"
        />
      </div>

      <!-- Sticky search and period chips -->
      <div class="sticky top-[60px] z-20 bg-default py-3 flex flex-col gap-2.5">
        <div class="px-4 flex items-center gap-2">
          <UInput
            v-model="searchQuery"
            icon="i-lucide-search"
            :placeholder="t('customers.search')"
            size="lg"
            class="flex-1"
            :ui="{ base: 'h-12 text-base bg-elevated rounded-xl' }"
          />
          <button
            type="button"
            class="shrink-0 h-12 px-4 rounded-xl border text-sm font-bold inline-flex items-center gap-2"
            :class="
              activeFilterCount > 0
                ? 'bg-inverted text-inverted border-inverted'
                : 'bg-elevated border-default'
            "
            @click="showFilters = true"
          >
            <UIcon name="i-lucide-sliders-horizontal" class="size-4" />
            {{ t('common.filters') }}
            <span v-if="activeFilterCount > 0" class="font-mono tabular-nums">{{
              activeFilterCount
            }}</span>
          </button>
        </div>
        <PiliChipRail
          :model-value="selectedPeriod"
          :options="mobilePeriodOptions"
          :label="t('customers.filters.allTime')"
          @update:model-value="selectPeriod"
        />
      </div>

      <!-- Skeleton -->
      <div v-if="pending" class="px-4 pb-5 flex flex-col gap-2.5">
        <div
          v-for="i in 5"
          :key="i"
          class="p-3.5 rounded-[14px] bg-elevated border border-default flex flex-col gap-2.5"
        >
          <div class="flex justify-between gap-3">
            <USkeleton class="h-4 w-32" />
            <USkeleton class="h-4 w-16" />
          </div>
          <USkeleton class="h-8 w-full" />
          <USkeleton class="h-4 w-40" />
        </div>
      </div>

      <!-- Empty -->
      <div
        v-else-if="filteredCustomers.length === 0"
        class="mx-4 flex flex-col items-center justify-center py-16 px-6 text-center rounded-[14px] bg-elevated border border-default"
      >
        <UIcon name="i-lucide-users" class="size-14 mb-3 text-muted" />
        <p class="text-muted text-sm">{{ t('customers.noResults') }}</p>
      </div>

      <!-- Cards -->
      <div v-else class="px-4 pb-5 flex flex-col gap-2.5">
        <div
          v-for="customer in paginatedCustomers"
          :key="customer.userId"
          role="button"
          tabindex="0"
          class="p-3.5 rounded-[14px] bg-elevated border border-default flex flex-col gap-2.5 cursor-pointer active:bg-accented transition-colors"
          @click="openCustomerOrders(customer)"
          @keydown.enter.self="openCustomerOrders(customer)"
        >
          <div class="flex items-baseline gap-2.5">
            <span class="flex-1 min-w-0 text-base font-bold truncate"
              >{{ customer.firstName }} {{ customer.lastName }}</span
            >
            <span class="font-mono text-base font-bold tabular-nums">{{
              formatPrice(customer.totalAmount)
            }}</span>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div class="min-w-0 flex flex-col gap-0.5">
              <span class="text-[11px] text-muted truncate">{{ t('customers.totalOrders') }}</span>
              <span class="font-mono text-sm font-bold tabular-nums">{{
                customer.totalOrders
              }}</span>
            </div>
            <div class="min-w-0 flex flex-col gap-0.5">
              <span class="text-[11px] text-muted truncate">{{ t('customers.averageOrder') }}</span>
              <span class="font-mono text-sm font-bold tabular-nums">{{
                formatPrice(customer.averageOrderAmount)
              }}</span>
            </div>
            <div class="min-w-0 flex flex-col gap-0.5">
              <span class="text-[11px] text-muted truncate">{{ t('customers.last') }}</span>
              <span class="font-mono text-sm font-bold tabular-nums">{{
                formatShortDate(customer.lastOrderDate)
              }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 pt-1.5 border-t border-default">
            <a
              v-if="customer.phoneNumber"
              :href="`tel:${customer.phoneNumber}`"
              class="inline-flex items-center min-h-11 font-mono text-[13px] text-muted underline underline-offset-[3px]"
              @click.stop
              >{{ customer.phoneNumber }}</a
            >
            <span class="flex-1" />
            <PiliChip class="self-center">
              {{
                customer.preferredOrderType === 'DELIVERY'
                  ? t('customers.delivery')
                  : t('customers.pickup')
              }}
            </PiliChip>
          </div>
        </div>
      </div>

      <!-- Filters sheet -->
      <PiliBottomSheet v-model:open="showFilters" :title="t('common.filters')">
        <div class="flex flex-col gap-2">
          <span class="text-sm font-bold">{{ t('customers.sort.title') }}</span>
          <PiliChipRail
            class="-mx-4"
            :model-value="mobileSortValue"
            :options="mobileSortOptions"
            :label="t('customers.sort.title')"
            @update:model-value="selectMobileSort"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label for="m-min-orders" class="text-sm font-bold">{{
            t('customers.filters.minOrders')
          }}</label>
          <UInput
            id="m-min-orders"
            v-model.number="minOrders"
            type="number"
            :min="1"
            size="lg"
            class="w-full"
            :ui="{ base: 'h-12 text-base font-mono tabular-nums bg-accented rounded-xl' }"
          />
        </div>
        <div class="flex flex-col gap-2">
          <span class="text-sm font-bold">{{ t('customers.filters.orderType') }}</span>
          <PiliSegmented
            :model-value="selectedOrderType"
            :options="orderTypeOptions"
            surface="ardoise"
            :label="t('customers.filters.orderType')"
            @update:model-value="selectedOrderType = $event ?? ''"
          />
        </div>
        <template #footer>
          <UButton color="neutral" variant="solid" size="xl" block @click="showFilters = false">
            {{ t('common.done') }}
          </UButton>
        </template>
      </PiliBottomSheet>
    </div>

    <!-- ========== TABLET+ VIEW: Table (md+) ========== -->
    <div class="hidden md:block rounded-[14px] border border-default overflow-hidden bg-elevated">
      <UTable
        v-if="!pending && filteredCustomers.length > 0"
        :columns="columns"
        :data="paginatedCustomers"
        :ui="{
          th: 'font-mono text-xs font-medium uppercase tracking-wider text-muted py-3 px-4',
          td: 'py-3 px-4',
          tr: 'cursor-pointer hover:bg-accented transition-colors',
        }"
        @select="(_e: Event, row: any) => openCustomerOrders(row.original)"
      >
        <template v-for="column in sortableColumns" :key="column.key" #[`${column.key}-header`]>
          <button
            type="button"
            class="inline-flex items-center gap-1 uppercase tracking-wider hover:text-default transition-colors"
            :class="sort?.key === column.key ? 'text-highlighted' : ''"
            :aria-label="sortButtonLabel(column)"
            @click="toggleSort(column.key)"
          >
            {{ column.label }}
            <UIcon :name="sortIcon(column.key)" class="size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </template>

        <template #name-cell="{ row }">
          <div>
            <span class="font-medium text-highlighted"
              >{{ row.original.firstName }} {{ row.original.lastName }}</span
            >
            <p class="text-xs text-muted lg:hidden">{{ row.original.email }}</p>
          </div>
        </template>

        <template #email-cell="{ row }">
          <span class="text-sm text-muted">{{ row.original.email }}</span>
        </template>

        <template #totalOrders-cell="{ row }">
          <span class="text-sm font-semibold font-mono tabular-nums">{{
            row.original.totalOrders
          }}</span>
        </template>

        <template #totalAmount-cell="{ row }">
          <span class="text-sm font-semibold font-mono tabular-nums">{{
            formatPrice(row.original.totalAmount)
          }}</span>
        </template>

        <template #averageOrder-cell="{ row }">
          <span class="text-sm font-mono tabular-nums text-muted">{{
            formatPrice(row.original.averageOrderAmount)
          }}</span>
        </template>

        <template #lastOrder-cell="{ row }">
          <span class="text-sm text-muted font-mono tabular-nums">{{
            formatDate(row.original.lastOrderDate)
          }}</span>
        </template>

        <template #preferredType-cell="{ row }">
          <UBadge
            color="neutral"
            variant="solid"
            size="sm"
            :icon="
              row.original.preferredOrderType === 'DELIVERY'
                ? 'i-lucide-bike'
                : 'i-lucide-shopping-bag'
            "
            :ui="{ base: 'rounded-[5px] font-bold text-xs' }"
          >
            {{
              row.original.preferredOrderType === 'DELIVERY'
                ? t('customers.delivery')
                : t('customers.pickup')
            }}
          </UBadge>
        </template>

        <template #registeredAt-cell="{ row }">
          <span class="text-sm text-muted font-mono tabular-nums">{{
            formatDate(row.original.registeredAt)
          }}</span>
        </template>
      </UTable>

      <!-- Skeleton Loading -->
      <div v-if="pending" class="divide-y divide-default">
        <div v-for="i in 10" :key="i" class="flex items-center gap-4 px-4 py-3">
          <div class="flex-1 space-y-1.5">
            <USkeleton class="h-3.5 w-32" />
            <USkeleton class="h-3 w-24" />
          </div>
          <USkeleton class="h-3.5 w-12 hidden sm:block" />
          <USkeleton class="h-3.5 w-16 hidden sm:block" />
          <USkeleton class="h-3.5 w-16 hidden md:block" />
          <USkeleton class="h-3.5 w-20 hidden md:block" />
          <USkeleton class="h-5 w-16 rounded-[5px] hidden xl:block" />
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-if="!pending && filteredCustomers.length === 0"
        class="flex flex-col items-center justify-center py-16"
      >
        <UIcon name="i-lucide-users" class="size-12 mb-3 text-muted" />
        <p class="text-muted text-sm">{{ t('customers.noResults') }}</p>
      </div>
    </div>

    <!-- Pagination -->
    <div
      v-if="!pending && filteredCustomers.length > pageSize"
      class="flex justify-center mt-2 md:mt-6 px-4 pb-5 md:px-0 md:pb-0"
    >
      <UPagination
        v-model:page="page"
        :total="filteredCustomers.length"
        :items-per-page="pageSize"
        show-edges
      />
    </div>
    <!-- Customer order history: full-height bottom sheet on phones, side panel from md -->
    <PiliBottomSheet
      v-if="isMobile"
      v-model:open="showOrderHistory"
      :title="t('customers.orderHistory')"
      full
    >
      <CustomersOrdersPanel
        :customer="selectedCustomer"
        :orders="customerOrders"
        :loading="loadingOrders"
        :loading-more="loadingMoreOrders"
        :page-size="ordersPageSize"
        @load-more="loadMoreOrders"
      />
    </PiliBottomSheet>
    <USlideover
      v-else
      v-model:open="showOrderHistory"
      :title="t('customers.orderHistory')"
      side="right"
      :ui="{ content: 'max-w-md' }"
    >
      <template v-if="selectedCustomer" #body>
        <CustomersOrdersPanel
          :customer="selectedCustomer"
          :orders="customerOrders"
          :loading="loadingOrders"
          :loading-more="loadingMoreOrders"
          :page-size="ordersPageSize"
          @load-more="loadMoreOrders"
        />
      </template>
    </USlideover>
  </div>
</template>

<script lang="ts" setup>
import type { CustomerStats, CustomerStatsResponse } from '~/types'
import {
  type CustomerSort,
  type CustomerSortKey,
  nextCustomerSort,
  sortCustomers,
} from '~/utils/customers'
import { computed, ref, watch } from 'vue'
import { useGqlQuery } from '#imports'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const isMobile = useIsMobile()
const showFilters = ref(false)

const searchQuery = ref('')
const page = ref(1)
const pageSize = ref(20)

// --- Filter state ---
type PeriodKey = 'all' | 'today' | 'week' | 'month' | 'year'
const selectedPeriod = ref<PeriodKey>('all')
const selectedOrderType = ref<string>('')
const minOrders = ref<number | undefined>(undefined)

const periodPresets = computed(() => [
  { key: 'all' as PeriodKey, label: t('customers.filters.allTime') },
  { key: 'today' as PeriodKey, label: t('customers.filters.today') },
  { key: 'week' as PeriodKey, label: t('customers.filters.thisWeek') },
  { key: 'month' as PeriodKey, label: t('customers.filters.thisMonth') },
  { key: 'year' as PeriodKey, label: t('customers.filters.thisYear') },
])

const orderTypeOptions = computed(() => [
  { value: '', label: t('customers.filters.allTypes'), icon: '' },
  { value: 'DELIVERY', label: t('customers.delivery'), icon: 'i-lucide-bike' },
  { value: 'PICKUP', label: t('customers.pickup'), icon: 'i-lucide-shopping-bag' },
])

function getDateRange(period: PeriodKey): { startDate?: string; endDate?: string } {
  if (period === 'all') return {}
  const now = new Date()
  let start: Date
  switch (period) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      break
    case 'week': {
      start = new Date(now)
      const day = start.getDay()
      // Monday as start of week
      start.setDate(start.getDate() - ((day + 6) % 7))
      start.setHours(0, 0, 0, 0)
      break
    }
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'year':
      start = new Date(now.getFullYear(), 0, 1)
      break
  }
  return {
    startDate: start.toISOString(),
    endDate: now.toISOString(),
  }
}

function selectPeriod(key: PeriodKey | null) {
  if (key) selectedPeriod.value = key
}

const mobilePeriodOptions = computed(() =>
  periodPresets.value.map((p) => ({ value: p.key, label: p.label })),
)

// --- Sort (whole list, before pagination) ---
const sort = ref<CustomerSort | null>(null)

const sortableColumns = computed<{ key: CustomerSortKey; label: string }[]>(() => [
  { key: 'totalOrders', label: t('customers.totalOrders') },
  { key: 'totalAmount', label: t('customers.totalAmount') },
  { key: 'averageOrder', label: t('customers.averageOrder') },
])

function toggleSort(key: CustomerSortKey) {
  sort.value = nextCustomerSort(sort.value, key)
}

function sortIcon(key: CustomerSortKey) {
  if (sort.value?.key !== key) return 'i-lucide-arrow-up-down'
  return sort.value.direction === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up'
}

function sortButtonLabel(column: { key: CustomerSortKey; label: string }) {
  const label = t('customers.sort.byColumn', { column: column.label })
  if (sort.value?.key !== column.key) return label
  return `${label} (${t(`customers.sort.${sort.value.direction === 'desc' ? 'descending' : 'ascending'}`)})`
}

// Phones have no table headers: the filters sheet offers the same columns, largest first.
type MobileSortValue = CustomerSortKey | 'default'
const mobileSortOptions = computed<{ value: MobileSortValue; label: string }[]>(() => [
  { value: 'default', label: t('customers.sort.default') },
  { value: 'totalAmount', label: t('customers.sort.total') },
  { value: 'averageOrder', label: t('customers.sort.average') },
  { value: 'totalOrders', label: t('customers.sort.orders') },
])
const mobileSortValue = computed<MobileSortValue>(() => sort.value?.key ?? 'default')

function selectMobileSort(value: MobileSortValue) {
  sort.value = value === 'default' ? null : { key: value, direction: 'desc' }
}

const activeFilterCount = computed(
  () =>
    (minOrders.value && minOrders.value > 1 ? 1 : 0) +
    (selectedOrderType.value ? 1 : 0) +
    (sort.value ? 1 : 0),
)

const queryVariables = computed(() => {
  const { startDate, endDate } = getDateRange(selectedPeriod.value)
  const input: Record<string, unknown> = {}
  if (startDate) input.startDate = startDate
  if (endDate) input.endDate = endDate
  if (selectedOrderType.value) input.orderType = selectedOrderType.value
  if (minOrders.value && minOrders.value > 1) input.minOrders = minOrders.value
  return Object.keys(input).length > 0 ? { input } : {}
})

const CUSTOMER_STATS_QUERY = /* GraphQL */ `
  query CustomerStats($input: CustomerStatsInput) {
    customerStats(input: $input) {
      summary {
        totalCustomers
        totalRevenue
        averageOrderValue
        totalOrders
      }
      customers {
        userId
        firstName
        lastName
        email
        phoneNumber
        registeredAt
        totalOrders
        totalAmount
        averageOrderAmount
        firstOrderDate
        lastOrderDate
        preferredOrderType
        deliveryCount
        pickupCount
      }
    }
  }
`

const { data, pending, refetch } = await useGqlQuery<{ customerStats: CustomerStatsResponse }>(
  CUSTOMER_STATS_QUERY,
  () => queryVariables.value,
  { immediate: true, cache: false, server: false },
)

// Refetch when filters change
watch([selectedPeriod, selectedOrderType, minOrders], () => {
  page.value = 1
  refetch()
})

const stats = computed(() => data.value?.customerStats)
const customers = computed(() => stats.value?.customers ?? [])
const summary = computed(() => stats.value?.summary)

const filteredCustomers = computed(() => {
  const sorted = sortCustomers(customers.value, sort.value)
  if (!searchQuery.value) return sorted
  const q = searchQuery.value.toLowerCase()
  return sorted.filter(
    (c) =>
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.phoneNumber && c.phoneNumber.includes(q)),
  )
})

const paginatedCustomers = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredCustomers.value.slice(start, start + pageSize.value)
})

watch([searchQuery, sort], () => {
  page.value = 1
})

const summaryCards = computed(() => [
  {
    label: t('customers.summary.totalCustomers'),
    value: summary.value?.totalCustomers ?? 0,
    icon: 'i-lucide-users',
  },
  {
    label: t('customers.summary.totalRevenue'),
    value: formatPrice(Number(summary.value?.totalRevenue ?? 0)),
    icon: 'i-lucide-banknote',
  },
  {
    label: t('customers.summary.averageOrder'),
    value: formatPrice(Number(summary.value?.averageOrderValue ?? 0)),
    icon: 'i-lucide-calculator',
  },
  {
    label: t('customers.summary.totalOrders'),
    value: summary.value?.totalOrders ?? 0,
    icon: 'i-lucide-shopping-bag',
  },
  {
    label: t('customers.summary.avgOrdersPerCustomer'),
    value: summary.value?.totalCustomers
      ? (summary.value.totalOrders / summary.value.totalCustomers).toFixed(1)
      : '0',
    icon: 'i-lucide-repeat',
  },
])

const columns = computed(() => [
  { accessorKey: 'name', header: t('customers.name') },
  {
    accessorKey: 'email',
    header: t('customers.email'),
    meta: { class: { td: 'hidden lg:table-cell', th: 'hidden lg:table-cell' } },
  },
  {
    accessorKey: 'totalOrders',
    header: t('customers.totalOrders'),
    meta: { class: { th: 'text-right', td: 'text-right' } },
  },
  {
    accessorKey: 'totalAmount',
    header: t('customers.totalAmount'),
    meta: { class: { th: 'text-right', td: 'text-right' } },
  },
  {
    accessorKey: 'averageOrder',
    header: t('customers.averageOrder'),
    meta: {
      class: { td: 'hidden md:table-cell text-right', th: 'hidden md:table-cell text-right' },
    },
  },
  {
    accessorKey: 'lastOrder',
    header: t('customers.lastOrder'),
    meta: { class: { td: 'hidden md:table-cell', th: 'hidden md:table-cell' } },
  },
  {
    accessorKey: 'preferredType',
    header: t('customers.preferredType'),
    meta: { class: { td: 'hidden xl:table-cell', th: 'hidden xl:table-cell' } },
  },
  {
    accessorKey: 'registeredAt',
    header: t('customers.registeredAt'),
    meta: { class: { td: 'hidden xl:table-cell', th: 'hidden xl:table-cell' } },
  },
])

const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString()

const formatShortDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('fr-BE', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Brussels',
  })

const getInitials = (firstName: string, lastName: string) =>
  `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase() || '?'

// --- Customer Order History ---

import type { CustomerOrder } from '~/components/customers/OrdersPanel.vue'

const selectedCustomer = ref<CustomerStats | null>(null)
const showOrderHistory = ref(false)
const customerOrders = ref<CustomerOrder[]>([])
const loadingOrders = ref(false)
const loadingMoreOrders = ref(false)
const ordersPage = ref(1)
const ordersPageSize = 20

const CUSTOMER_ORDERS_QUERY = /* GraphQL */ `
  query CustomerOrders($userId: ID!, $first: Int, $page: Int) {
    customerOrders(userId: $userId, first: $first, page: $page) {
      id
      createdAt
      status
      type
      totalPrice
      items {
        quantity
        product {
          name
        }
      }
    }
  }
`

const { $gqlFetch } = useNuxtApp()

const fetchCustomerOrders = (userId: string, pageNum: number) =>
  $gqlFetch<{ customerOrders: CustomerOrder[] }>(CUSTOMER_ORDERS_QUERY, {
    variables: { userId, first: ordersPageSize, page: pageNum },
  })

const openCustomerOrders = async (customer: CustomerStats) => {
  selectedCustomer.value = customer
  showOrderHistory.value = true
  customerOrders.value = []
  ordersPage.value = 1
  loadingOrders.value = true

  try {
    const res = await fetchCustomerOrders(customer.userId, 1)
    customerOrders.value = res.customerOrders
  } catch {
    customerOrders.value = []
  } finally {
    loadingOrders.value = false
  }
}

const loadMoreOrders = async () => {
  if (!selectedCustomer.value) return
  loadingMoreOrders.value = true
  ordersPage.value++

  try {
    const res = await fetchCustomerOrders(selectedCustomer.value.userId, ordersPage.value)
    customerOrders.value.push(...res.customerOrders)
  } catch {
    // Keep existing orders on failure
  } finally {
    loadingMoreOrders.value = false
  }
}
</script>
