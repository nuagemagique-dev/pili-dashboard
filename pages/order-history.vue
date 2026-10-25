<template>
  <div class="md:p-6">
    <!-- Desktop: header, summary and filters (>= md) -->
    <div class="hidden md:block">
      <!-- Page Header -->
      <div class="mb-6">
        <h1 class="text-lg sm:text-2xl font-bold text-highlighted">
          {{ t('orderHistory.title') }}
        </h1>
        <p class="hidden sm:block text-sm text-muted mt-0.5">{{ t('orderHistory.subtitle') }}</p>
      </div>

      <!-- Summary Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-3 sm:mb-6">
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
                <USkeleton v-if="initialLoading" class="h-5 w-14 mt-1" />
                <template v-else>{{ card.value }}</template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Filters Bar (sticky on mobile) -->
      <div
        class="sticky top-0 z-20 -mx-3 sm:mx-0 px-3 sm:px-0 pb-3 sm:pb-4 pt-1 bg-default sm:static sm:bg-transparent space-y-2 sm:space-y-0 sm:flex sm:flex-wrap sm:items-center sm:gap-3"
      >
        <!-- Search -->
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          :placeholder="t('orderHistory.search')"
          size="lg"
          class="w-full sm:w-56 sm:order-3"
          :ui="{ base: 'h-12 text-base sm:h-10 sm:text-sm bg-accented' }"
        />

        <!-- Date Range -->
        <div class="flex items-center gap-2 sm:order-1">
          <label for="start-date" class="sr-only">{{ t('orderHistory.startDate') }}</label>
          <UInput
            id="start-date"
            v-model="startDate"
            type="date"
            size="lg"
            class="flex-1 sm:w-40 sm:flex-none"
            :ui="{ base: 'h-12 text-base sm:h-10 sm:text-sm font-mono tabular-nums bg-accented' }"
          />
          <span class="text-muted text-sm" aria-hidden="true">–</span>
          <label for="end-date" class="sr-only">{{ t('orderHistory.endDate') }}</label>
          <UInput
            id="end-date"
            v-model="endDate"
            type="date"
            size="lg"
            class="flex-1 sm:w-40 sm:flex-none"
            :ui="{ base: 'h-12 text-base sm:h-10 sm:text-sm font-mono tabular-nums bg-accented' }"
          />
        </div>

        <!-- Status filter (full-width on mobile, inline on sm+) -->
        <USelectMenu
          v-model="selectedStatus"
          :items="statusOptions"
          value-key="value"
          size="lg"
          class="w-full sm:w-auto sm:min-w-44 sm:order-2"
          :ui="{ base: 'h-12 text-base sm:h-10 sm:text-sm bg-accented' }"
        />

        <!-- Type chip rail (horizontal scroll on mobile) -->
        <div
          class="relative -mx-3 sm:mx-0 px-3 sm:px-0 flex items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible scrollbar-hide sm:order-2"
        >
          <button
            v-for="opt in typeOptions"
            :key="opt.value"
            type="button"
            class="shrink-0 inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-sm font-medium border transition-all active:scale-95"
            :class="
              selectedType === opt.value
                ? 'bg-inverted text-inverted border-transparent'
                : 'bg-accented text-muted border-default hover:text-default'
            "
            @click="selectedType = opt.value"
          >
            <UIcon v-if="opt.icon" :name="opt.icon" class="size-4" />
            <span>{{ opt.label }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Desktop: Table view (>= md) -->
    <div class="hidden md:block rounded-[14px] border border-default overflow-hidden bg-elevated">
      <UTable
        v-if="historyOrders.length > 0"
        :columns="columns"
        :data="historyOrders"
        :ui="{
          th: 'font-mono text-xs font-medium uppercase tracking-wider text-muted py-3 px-4',
          td: 'py-3 px-4',
        }"
      >
        <template #customer-cell="{ row }">
          <span class="font-medium text-highlighted">{{ row.original.displayCustomerName }}</span>
        </template>

        <template #date-cell="{ row }">
          <span class="text-sm text-muted font-mono tabular-nums">{{
            formatOrderDate(row.original.createdAt)
          }}</span>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :color="getStatusColor(row.original.status)"
            variant="solid"
            size="sm"
            :ui="{ base: 'rounded-[5px] font-bold text-xs' }"
          >
            {{ t(`orders.status.${row.original.status.toLowerCase()}`) }}
          </UBadge>
        </template>

        <template #type-cell="{ row }">
          <span class="inline-flex items-center gap-1 text-sm text-muted">
            <UIcon
              :name="row.original.type === 'DELIVERY' ? 'i-lucide-bike' : 'i-lucide-shopping-bag'"
              class="size-3.5"
            />
            {{ row.original.type === 'DELIVERY' ? t('orders.delivery') : t('orders.pickup') }}
          </span>
        </template>

        <template #total-cell="{ row }">
          <span class="text-sm font-semibold font-mono tabular-nums">{{
            formatPrice(row.original.totalPrice)
          }}</span>
        </template>

        <template #items-cell="{ row }">
          <span class="text-sm text-muted font-mono tabular-nums">{{
            row.original.items.length
          }}</span>
        </template>
      </UTable>
    </div>

    <!-- Mobile (< md) -->
    <div class="md:hidden">
      <div class="px-4 pt-4 pb-3">
        <h1 class="text-[26px] font-bold leading-[1.1]">{{ t('navigation.orderHistory') }}</h1>
      </div>

      <div class="px-4 grid grid-cols-3 gap-2">
        <PiliStatCard
          v-for="card in summaryCards"
          :key="card.label"
          :label="card.label"
          :value="initialLoading ? '-' : card.value"
        />
      </div>

      <!-- Sticky filters -->
      <div class="sticky top-0 z-20 bg-default py-3 flex flex-col gap-2.5">
        <div class="px-4">
          <UInput
            v-model="searchQuery"
            icon="i-lucide-search"
            :placeholder="t('orderHistory.search')"
            size="lg"
            class="w-full"
            :ui="{ base: 'h-12 text-base bg-elevated rounded-xl' }"
          />
        </div>
        <PiliChipRail
          :model-value="histPeriod"
          :options="periodOptions"
          :label="t('orderHistory.periods.label')"
          @update:model-value="selectPeriod"
        />
        <div class="px-4">
          <PiliSegmented
            :model-value="selectedType"
            :options="mobileTypeOptions"
            :height="40"
            muted
            :label="t('orderHistory.type')"
            @update:model-value="selectedType = $event ?? ''"
          />
        </div>
      </div>

      <!-- Skeleton -->
      <div v-if="initialLoading" class="px-4 pb-5 flex flex-col gap-2">
        <div
          v-for="i in 8"
          :key="i"
          class="flex items-center gap-3 min-h-16 px-3.5 py-3 rounded-[14px] bg-elevated border border-default"
        >
          <div class="flex-1 space-y-2">
            <USkeleton class="h-4 w-28" />
            <USkeleton class="h-3 w-36" />
          </div>
          <div class="flex flex-col items-end gap-1.5">
            <USkeleton class="h-4 w-14" />
            <USkeleton class="h-5 w-16 rounded-[5px]" />
          </div>
        </div>
      </div>

      <!-- Empty -->
      <div
        v-else-if="historyOrders.length === 0"
        class="mx-4 flex flex-col items-center justify-center py-16 rounded-[14px] border border-default bg-elevated"
      >
        <UIcon name="i-lucide-package-x" class="size-12 mb-3 text-muted" />
        <p class="text-muted text-sm">{{ t('orderHistory.noResults') }}</p>
      </div>

      <!-- Groups by Brussels day -->
      <div v-else class="px-4 pb-5 flex flex-col gap-4">
        <section v-for="group in historyGroups" :key="group.day" class="flex flex-col gap-2">
          <div
            class="flex justify-between gap-3 font-mono text-xs font-bold tracking-[0.06em] text-muted"
          >
            <span>{{ group.label }}</span>
            <span class="tabular-nums">{{ group.sum }}</span>
          </div>
          <div
            class="rounded-[14px] bg-elevated border border-default overflow-hidden divide-y divide-default"
          >
            <div
              v-for="order in group.orders"
              :key="order.id"
              class="min-h-16 px-3.5 py-3 flex items-center gap-3"
            >
              <div class="flex-1 min-w-0 flex flex-col gap-[3px]">
                <span class="text-[15px] font-bold truncate">{{ order.displayCustomerName }}</span>
                <span class="font-mono text-xs text-muted tabular-nums truncate">{{
                  orderMeta(order)
                }}</span>
              </div>
              <div class="flex flex-col items-end gap-1">
                <span class="font-mono text-[15px] font-bold tabular-nums">{{
                  formatPrice(order.totalPrice)
                }}</span>
                <PiliChip size="sm" :tone="statusTone(order.status)">
                  {{ t(`orders.status.${order.status.toLowerCase()}`) }}
                </PiliChip>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- Dates and filters sheet -->
      <PiliBottomSheet v-model:open="showFilters" :title="t('common.filters')">
        <div class="flex flex-col gap-2">
          <label for="m-start-date" class="text-sm font-bold">{{
            t('orderHistory.startDate')
          }}</label>
          <UInput
            id="m-start-date"
            v-model="startDate"
            type="date"
            size="lg"
            class="w-full"
            :ui="{ base: 'h-12 text-base font-mono tabular-nums bg-accented rounded-xl' }"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label for="m-end-date" class="text-sm font-bold">{{ t('orderHistory.endDate') }}</label>
          <UInput
            id="m-end-date"
            v-model="endDate"
            type="date"
            size="lg"
            class="w-full"
            :ui="{ base: 'h-12 text-base font-mono tabular-nums bg-accented rounded-xl' }"
          />
        </div>
        <div class="flex flex-col gap-2">
          <span class="text-sm font-bold">{{ t('orderHistory.status') }}</span>
          <USelectMenu
            v-model="selectedStatus"
            :items="statusOptions"
            value-key="value"
            size="lg"
            class="w-full"
            :ui="{ base: 'h-12 text-base bg-accented rounded-xl' }"
          />
        </div>
        <template #footer>
          <UButton color="neutral" variant="solid" size="xl" block @click="showFilters = false">
            {{ t('common.done') }}
          </UButton>
        </template>
      </PiliBottomSheet>
    </div>

    <!-- Desktop loading skeleton -->
    <div
      v-if="initialLoading"
      class="hidden md:block divide-y divide-default rounded-[14px] border border-default bg-elevated"
    >
      <div v-for="i in 10" :key="i" class="flex items-center gap-4 px-4 py-3">
        <USkeleton class="h-3.5 w-32" />
        <USkeleton class="h-3.5 w-20" />
        <USkeleton class="h-5 w-16 rounded-[5px]" />
        <USkeleton class="h-3.5 w-16" />
        <USkeleton class="h-3.5 w-14" />
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="!initialLoading && historyOrders.length === 0"
      class="hidden md:flex flex-col items-center justify-center py-16 rounded-[14px] border border-default bg-elevated"
    >
      <UIcon name="i-lucide-package-x" class="size-12 mb-3 text-muted" />
      <p class="text-muted text-sm">{{ t('orderHistory.noResults') }}</p>
    </div>

    <!-- Infinite-scroll sentinel: enters viewport → loadNextPage() -->
    <div
      v-if="hasMore && !initialLoading"
      ref="loadMoreSentinel"
      class="flex justify-center items-center py-6 min-h-12"
      aria-hidden="true"
    >
      <UIcon v-if="loadingMore" name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { brusselsDateISO, brusselsDateTimeLocalToISO, shiftBrusselsDate } from '~/utils/utils'

const { t, locale } = useI18n()
const isMobile = useIsMobile()
const { $gqlFetch } = useNuxtApp()

// --- State ---
const currentPage = ref(1)
const pageSize = 20
const searchQuery = ref('')
const selectedStatus = ref('')
const selectedType = ref('')
const startDate = ref('')
const endDate = ref('')

interface HistoryOrder {
  id: string
  createdAt: string
  status: string
  type: string
  totalPrice: string
  displayCustomerName: string
  items: { quantity: number }[]
}

interface HistorySummary {
  totalOrders: number
  totalRevenue: string
  averageOrder: string
}

const historyOrders = ref<HistoryOrder[]>([])
const summary = ref<HistorySummary | null>(null)
const initialLoading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(true)

// --- Filter options ---
// Cancelled and failed orders are filtered out server-side, hence omitted from this dropdown.
const statusOptions = computed(() => [
  { label: t('orderHistory.allStatuses'), value: '' },
  { label: t('orders.status.pending'), value: 'PENDING' },
  { label: t('orders.status.confirmed'), value: 'CONFIRMED' },
  { label: t('orders.status.preparing'), value: 'PREPARING' },
  { label: t('orders.status.awaiting_pick_up'), value: 'AWAITING_PICK_UP' },
  { label: t('orders.status.out_for_delivery'), value: 'OUT_FOR_DELIVERY' },
  { label: t('orders.status.delivered'), value: 'DELIVERED' },
  { label: t('orders.status.picked_up'), value: 'PICKED_UP' },
])

const typeOptions = computed(() => [
  { value: '', label: t('orderHistory.allTypes'), icon: '' },
  { value: 'DELIVERY', label: t('orders.delivery'), icon: 'i-lucide-bike' },
  { value: 'PICKUP', label: t('orders.pickup'), icon: 'i-lucide-shopping-bag' },
])

// --- Mobile: period presets (Brussels dates), day groups ---
type HistPeriod = 'today' | '7' | '30' | 'custom'
const histPeriod = ref<HistPeriod>('today')
const showFilters = ref(false)

const periodOptions = computed(() => [
  { value: 'today' as HistPeriod, label: t('orderHistory.periods.today') },
  { value: '7' as HistPeriod, label: t('orderHistory.periods.days7') },
  { value: '30' as HistPeriod, label: t('orderHistory.periods.days30') },
  { value: 'custom' as HistPeriod, label: t('orderHistory.periods.dates') },
])

const mobileTypeOptions = computed(() => [
  { value: '', label: t('orderHistory.allTypes') },
  { value: 'DELIVERY', label: t('orders.delivery') },
  { value: 'PICKUP', label: t('orders.pickup') },
])

const applyPreset = (period: Exclude<HistPeriod, 'custom'>) => {
  const today = brusselsDateISO()
  endDate.value = today
  startDate.value = period === 'today' ? today : shiftBrusselsDate(today, period === '7' ? -6 : -29)
}

const selectPeriod = (period: HistPeriod | null) => {
  if (!period) return
  histPeriod.value = period
  if (period === 'custom') showFilters.value = true
  else applyPreset(period)
}

// The phone layout opens on today; the desktop keeps loading everything.
if (isMobile.value) applyPreset('today')

// --- GraphQL ---
const ORDER_HISTORY_QUERY = /* GraphQL */ `
  query OrderHistory($input: OrderHistoryInput) {
    orderHistory(input: $input) {
      summary {
        totalOrders
        totalRevenue
        averageOrder
      }
      orders {
        id
        createdAt
        status
        type
        totalPrice
        displayCustomerName
        items {
          quantity
        }
      }
    }
  }
`

const buildInput = (page: number): Record<string, unknown> => {
  const input: Record<string, unknown> = {
    first: pageSize,
    page,
  }
  if (startDate.value) input.startDate = brusselsDateTimeLocalToISO(`${startDate.value}T00:00`)
  if (endDate.value) {
    const end = brusselsDateTimeLocalToISO(`${endDate.value}T23:59`)
    if (end) input.endDate = new Date(new Date(end).getTime() + 59_000).toISOString()
  }
  if (selectedStatus.value) input.status = selectedStatus.value
  if (selectedType.value) input.orderType = selectedType.value
  if (searchQuery.value) input.search = searchQuery.value
  return input
}

const fetchOrders = async () => {
  initialLoading.value = true
  currentPage.value = 1
  hasMore.value = true

  try {
    const res = await $gqlFetch<{
      orderHistory: { orders: HistoryOrder[]; summary: HistorySummary }
    }>(ORDER_HISTORY_QUERY, { variables: { input: buildInput(1) } })
    historyOrders.value = res.orderHistory.orders
    summary.value = res.orderHistory.summary
    hasMore.value = res.orderHistory.orders.length >= pageSize
  } catch {
    historyOrders.value = []
    summary.value = null
    hasMore.value = false
  } finally {
    initialLoading.value = false
  }
}

const loadNextPage = async () => {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  currentPage.value++

  try {
    const res = await $gqlFetch<{
      orderHistory: { orders: HistoryOrder[]; summary: HistorySummary }
    }>(ORDER_HISTORY_QUERY, { variables: { input: buildInput(currentPage.value) } })
    historyOrders.value.push(...res.orderHistory.orders)
    hasMore.value = res.orderHistory.orders.length >= pageSize
  } catch {
    hasMore.value = false
  } finally {
    loadingMore.value = false
  }
}

// Initial fetch
await fetchOrders()

// --- Infinite scroll ---
// IntersectionObserver triggers loadNextPage when the bottom sentinel enters the viewport; rootMargin pre-fetches ~one viewport early so the spinner is rarely visible.
const loadMoreSentinel = ref<HTMLElement | null>(null)
let scrollObserver: IntersectionObserver | null = null

watch(loadMoreSentinel, (el, _prev, onCleanup) => {
  if (!el || typeof IntersectionObserver === 'undefined') return
  scrollObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadNextPage()
    },
    { rootMargin: '400px 0px' },
  )
  scrollObserver.observe(el)
  onCleanup(() => {
    scrollObserver?.disconnect()
    scrollObserver = null
  })
})

onBeforeUnmount(() => scrollObserver?.disconnect())

// Refetch on filter changes (reset to page 1)
let debounceTimer: ReturnType<typeof setTimeout> | undefined
watch([selectedStatus, selectedType, startDate, endDate], () => {
  fetchOrders()
})
watch(searchQuery, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    fetchOrders()
  }, 400)
})

// --- Summary cards ---
const summaryCards = computed(() => [
  {
    label: t('orderHistory.totalOrders'),
    value: summary.value?.totalOrders ?? 0,
    icon: 'i-lucide-shopping-bag',
  },
  {
    label: t('orderHistory.totalRevenue'),
    value: formatPrice(Number(summary.value?.totalRevenue ?? 0)),
    icon: 'i-lucide-banknote',
  },
  {
    label: t('orderHistory.averageOrder'),
    value: formatPrice(Number(summary.value?.averageOrder ?? 0)),
    icon: 'i-lucide-calculator',
  },
])

// --- Table (desktop only) ---
const columns = computed(() => [
  { accessorKey: 'customer', header: t('orderHistory.customer') },
  { accessorKey: 'date', header: t('orderHistory.date') },
  { accessorKey: 'status', header: t('orderHistory.status') },
  { accessorKey: 'type', header: t('orderHistory.type') },
  {
    accessorKey: 'total',
    header: t('orderHistory.total'),
    meta: { class: { th: 'text-right', td: 'text-right' } },
  },
  {
    accessorKey: 'items',
    header: t('orderHistory.items'),
    meta: { class: { th: 'text-right', td: 'text-right' } },
  },
])

type UiColor = 'success' | 'error' | 'primary' | 'secondary' | 'info' | 'warning' | 'neutral'

const getStatusColor = (status: string): UiColor => {
  const colors: Record<string, UiColor> = {
    PENDING: 'warning',
    CONFIRMED: 'info',
    PREPARING: 'neutral',
    AWAITING_PICK_UP: 'success',
    OUT_FOR_DELIVERY: 'info',
    DELIVERED: 'success',
    PICKED_UP: 'success',
    FAILED: 'error',
    CANCELLED: 'error',
  }
  return colors[status] ?? 'neutral'
}

const formatOrderDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('fr-BE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

const statusTone = (status: string): 'warning' | 'danger' | 'success' | 'info' | 'neutral' => {
  const color = getStatusColor(status)
  if (color === 'error') return 'danger'
  if (color === 'warning' || color === 'success' || color === 'info') return color
  return 'neutral'
}

const dayFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      timeZone: 'Europe/Brussels',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }),
)
const dayYearFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      timeZone: 'Europe/Brussels',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
)
const timeFormatter = new Intl.DateTimeFormat('fr-BE', {
  timeZone: 'Europe/Brussels',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const dayLabel = (day: string, sample: Date) => {
  const today = brusselsDateISO()
  const upper = (v: string) => v.toUpperCase()
  if (day === today)
    return `${upper(t('orderHistory.groups.today'))} · ${upper(dayFormatter.value.format(sample))}`
  if (day === shiftBrusselsDate(today, -1))
    return `${upper(t('orderHistory.groups.yesterday'))} · ${upper(dayFormatter.value.format(sample))}`
  return upper(dayYearFormatter.value.format(sample))
}

// Orders arrive newest first; consecutive orders of the same Brussels day share a group, across pages.
const historyGroups = computed(() => {
  const groups: { day: string; label: string; sum: string; orders: HistoryOrder[] }[] = []
  const totals = new Map<string, number>()
  for (const order of historyOrders.value) {
    const date = new Date(order.createdAt)
    const day = brusselsDateISO(date)
    let group = groups[groups.length - 1]
    if (!group || group.day !== day) {
      group = { day, label: dayLabel(day, date), sum: '', orders: [] }
      groups.push(group)
    }
    group.orders.push(order)
    if (order.status !== 'CANCELLED' && order.status !== 'FAILED') {
      totals.set(day, (totals.get(day) ?? 0) + Number(order.totalPrice))
    }
  }
  for (const group of groups) group.sum = formatPrice(totals.get(group.day) ?? 0)
  return groups
})

const orderMeta = (order: HistoryOrder) => {
  const count = order.items.reduce((acc, item) => acc + item.quantity, 0)
  const type = (order.type === 'DELIVERY' ? t('orders.delivery') : t('orders.pickup')).toUpperCase()
  return `${timeFormatter.format(new Date(order.createdAt))} · ${type} · ${count} ${t('orderHistory.itemsShort')}`
}
</script>
