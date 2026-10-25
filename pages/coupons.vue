<template>
  <div class="md:p-6">
    <!-- Desktop: header and filters (>= md) -->
    <div class="hidden md:block">
      <!-- Page Header -->
      <div class="mb-6 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-lg sm:text-2xl font-bold text-highlighted truncate">
            {{ t('coupons.title') }}
          </h1>
          <p class="text-xs sm:text-sm text-muted mt-0.5">
            <span class="font-mono tabular-nums">{{ filteredCoupons.length }}</span>
            {{ t('coupons.title').toLowerCase() }}
          </p>
        </div>
        <UButton icon="i-lucide-plus" color="primary" @click="openCreateDialog">
          {{ t('coupons.add') }}
        </UButton>
      </div>

      <!-- Filters Bar (sticky on mobile) -->
      <div
        class="sticky top-0 z-20 -mx-3 sm:mx-0 px-3 sm:px-0 pb-3 sm:pb-4 pt-1 bg-default sm:static sm:bg-transparent"
      >
        <UInput
          v-model="searchQuery"
          icon="i-lucide-search"
          :placeholder="t('coupons.search')"
          size="lg"
          class="w-full"
          :ui="{ base: 'h-12 text-base bg-accented' }"
        />

        <!-- Combined chip rail: status + type -->
        <div
          class="relative mt-2 sm:mt-3 -mx-3 sm:mx-0 px-3 sm:px-0 flex items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible scrollbar-hide"
        >
          <button
            v-for="opt in statusFilterOptions"
            :key="`s-${opt.value}`"
            type="button"
            class="shrink-0 inline-flex items-center h-10 px-4 rounded-lg text-sm font-medium border transition-all active:scale-95"
            :class="
              filterStatus === opt.value
                ? 'bg-inverted text-inverted border-transparent'
                : 'bg-accented text-muted border-default hover:text-default'
            "
            @click="filterStatus = opt.value as typeof filterStatus"
          >
            {{ opt.label }}
          </button>

          <span class="shrink-0 h-6 w-px bg-(--ui-border)" aria-hidden="true" />

          <button
            v-for="opt in typeFilterOptions"
            :key="`t-${opt.value}`"
            type="button"
            class="shrink-0 inline-flex items-center h-10 px-4 rounded-lg text-sm font-medium border transition-all active:scale-95"
            :class="
              filterType === opt.value
                ? 'bg-inverted text-inverted border-transparent'
                : 'bg-accented text-muted border-default hover:text-default'
            "
            @click="filterType = opt.value as typeof filterType"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- ========== MOBILE VIEW (< md) ========== -->
    <div class="md:hidden">
      <PiliSubHeader :title="t('navigation.coupons')">
        <UButton icon="i-lucide-plus" color="primary" size="lg" @click="openCreateDialog">
          {{ t('coupons.addShort') }}
        </UButton>
      </PiliSubHeader>

      <!-- Sticky search and status chips -->
      <div class="sticky top-[60px] z-20 bg-default pt-1 pb-3 flex flex-col gap-2.5">
        <div class="px-4 flex items-center gap-2">
          <UInput
            v-model="searchQuery"
            icon="i-lucide-search"
            :placeholder="t('coupons.search')"
            size="lg"
            class="flex-1"
            :ui="{ base: 'h-12 text-base bg-elevated rounded-xl' }"
          />
          <button
            type="button"
            class="shrink-0 h-12 px-4 rounded-xl border text-sm font-bold inline-flex items-center gap-2"
            :class="
              filterType !== 'all'
                ? 'bg-inverted text-inverted border-inverted'
                : 'bg-elevated border-default'
            "
            @click="showFilters = true"
          >
            <UIcon name="i-lucide-sliders-horizontal" class="size-4" />
            {{ t('common.filters') }}
            <span v-if="filterType !== 'all'" class="font-mono tabular-nums">1</span>
          </button>
        </div>
        <PiliChipRail
          :model-value="mobileStatus"
          :options="mobileStatusOptions"
          :label="t('orderHistory.status')"
          @update:model-value="mobileStatus = $event"
        />
      </div>

      <!-- Skeleton -->
      <div v-if="pending" class="px-4 pb-5 flex flex-col gap-2.5">
        <div
          v-for="i in 4"
          :key="i"
          class="rounded-[14px] bg-elevated border border-default overflow-hidden"
        >
          <div class="p-3.5 space-y-2.5">
            <USkeleton class="h-5 w-32" />
            <USkeleton class="h-4 w-44" />
            <USkeleton class="h-8 w-full" />
          </div>
          <USkeleton class="h-[52px] rounded-none border-t border-default" />
        </div>
      </div>

      <!-- Empty -->
      <div
        v-else-if="filteredCoupons.length === 0"
        class="mx-4 flex flex-col items-center justify-center py-16 px-6 text-center rounded-[14px] bg-elevated border border-default"
      >
        <UIcon name="i-lucide-ticket" class="size-14 mb-3 text-muted" />
        <p class="text-muted text-sm">{{ t('coupons.noResults') }}</p>
      </div>

      <!-- Cards -->
      <div v-else class="px-4 pb-5 flex flex-col gap-2.5">
        <div
          v-for="coupon in filteredCoupons"
          :key="coupon.id"
          class="rounded-[14px] bg-elevated border border-default overflow-hidden"
        >
          <button
            type="button"
            class="w-full p-3.5 text-left flex flex-col gap-2.5 active:bg-accented transition-colors"
            @click="openEditDialog(coupon)"
          >
            <div class="flex items-center gap-2.5">
              <span class="flex-1 min-w-0 font-mono text-lg font-bold tracking-[0.04em] truncate">{{
                coupon.code
              }}</span>
              <span class="font-mono text-xl font-bold tabular-nums">{{
                discountLabel(coupon)
              }}</span>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <PiliChip :tone="statusMeta(coupon.status).chip">{{
                statusMeta(coupon.status).label
              }}</PiliChip>
              <PiliChip v-if="coupon.appOnly" tone="outline" data-testid="coupon-app-only">
                <UIcon name="i-lucide-smartphone" class="size-3 mr-1" />{{ t('coupons.appOnly') }}
              </PiliChip>
              <span class="text-[13px] text-muted font-mono tabular-nums">{{
                periodLabel(coupon)
              }}</span>
            </div>
            <div class="grid grid-cols-3 gap-2 w-full">
              <div class="min-w-0 flex flex-col gap-0.5">
                <span class="text-[11px] text-muted truncate">{{ t('coupons.used') }}</span>
                <span class="font-mono text-sm font-bold tabular-nums"
                  >{{ coupon.usedCount }} / {{ coupon.maxUses ?? '∞' }}</span
                >
              </div>
              <div class="min-w-0 flex flex-col gap-0.5">
                <span class="text-[11px] text-muted truncate">{{ t('coupons.minOrder') }}</span>
                <span class="font-mono text-sm font-bold tabular-nums">{{
                  coupon.minOrderAmount ? formatPrice(coupon.minOrderAmount) : '-'
                }}</span>
              </div>
              <div class="min-w-0 flex flex-col gap-0.5">
                <span class="text-[11px] text-muted truncate">{{ t('coupons.perUser') }}</span>
                <span class="font-mono text-sm font-bold tabular-nums">{{
                  coupon.maxUsesPerUser ?? t('coupons.unlimited')
                }}</span>
              </div>
            </div>
          </button>

          <button
            type="button"
            role="switch"
            :aria-checked="coupon.isActive"
            class="w-full h-[52px] px-3.5 border-t border-default flex items-center justify-between text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="
              togglingId === coupon.id ||
              (coupon.status !== 'ACTIVE' && coupon.status !== 'INACTIVE')
            "
            @click="toggleActive(coupon)"
          >
            <span>{{ t('coupons.active') }}</span>
            <PiliSwitch
              presentational
              :model-value="coupon.isActive"
              :loading="togglingId === coupon.id"
            />
          </button>
        </div>
      </div>

      <!-- Type filter sheet -->
      <PiliBottomSheet v-model:open="showFilters" :title="t('common.filters')">
        <div class="flex flex-col gap-2">
          <span class="text-sm font-bold">{{ t('coupons.type') }}</span>
          <PiliSegmented
            :model-value="filterType"
            :options="typeSheetOptions"
            surface="ardoise"
            :label="t('coupons.type')"
            @update:model-value="filterType = ($event ?? 'all') as typeof filterType"
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
        v-if="!pending && filteredCoupons.length > 0"
        :columns="columns"
        :data="paginatedCoupons"
        :ui="{
          th: 'font-mono text-xs font-medium uppercase tracking-wider text-muted py-3 px-4',
          td: 'py-3 px-4',
        }"
        @select="(_e: Event, row: any) => openEditDialog(row.original)"
      >
        <template #code-cell="{ row }">
          <div class="flex items-center gap-2">
            <span class="font-mono font-medium text-highlighted">{{ row.original.code }}</span>
            <PiliChip
              v-if="row.original.appOnly"
              tone="outline"
              size="sm"
              data-testid="coupon-app-only"
            >
              <UIcon name="i-lucide-smartphone" class="size-3 mr-1" />{{ t('coupons.appOnly') }}
            </PiliChip>
          </div>
        </template>

        <template #discountType-cell="{ row }">
          <span class="text-sm">{{
            row.original.discountType === 'PERCENTAGE'
              ? t('coupons.percentage')
              : t('coupons.fixed')
          }}</span>
        </template>

        <template #discountValue-cell="{ row }">
          <span class="text-sm font-semibold font-mono tabular-nums">
            {{
              row.original.discountType === 'PERCENTAGE'
                ? `${row.original.discountValue}%`
                : formatPrice(row.original.discountValue)
            }}
          </span>
        </template>

        <template #minOrderAmount-cell="{ row }">
          <span class="text-sm font-mono tabular-nums text-muted">
            {{ row.original.minOrderAmount ? formatPrice(row.original.minOrderAmount) : '-' }}
          </span>
        </template>

        <template #maxUses-cell="{ row }">
          <span class="text-sm font-mono tabular-nums text-muted">
            {{ row.original.usedCount }} / {{ row.original.maxUses ?? t('coupons.unlimited') }}
          </span>
        </template>

        <template #maxUsesPerUser-cell="{ row }">
          <span class="text-sm font-mono tabular-nums text-muted">{{
            row.original.maxUsesPerUser ?? t('coupons.unlimited')
          }}</span>
        </template>

        <template #isActive-cell="{ row }">
          <button
            class="inline-flex items-center gap-1.5 px-2 py-1 rounded-[5px] text-xs font-bold transition-all active:scale-95 cursor-pointer disabled:cursor-not-allowed"
            :class="statusMeta(row.original.status).tone"
            :disabled="
              togglingId === row.original.id ||
              (row.original.status !== 'ACTIVE' && row.original.status !== 'INACTIVE')
            "
            @click.stop="toggleActive(row.original)"
          >
            <UIcon
              :name="
                togglingId === row.original.id
                  ? 'i-lucide-loader-2'
                  : statusMeta(row.original.status).icon
              "
              class="size-3.5"
              :class="{ 'animate-spin': togglingId === row.original.id }"
            />
            {{ statusMeta(row.original.status).label }}
          </button>
        </template>

        <template #validPeriod-cell="{ row }">
          <span class="text-sm text-muted font-mono tabular-nums">
            {{ formatDateRange(row.original.validFrom, row.original.validUntil) }}
          </span>
        </template>

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
          <div class="flex-1 space-y-1.5">
            <USkeleton class="h-3.5 w-24" />
          </div>
          <USkeleton class="h-3.5 w-16 hidden sm:block" />
          <USkeleton class="h-3.5 w-16 hidden sm:block" />
          <USkeleton class="h-6 w-20 rounded-[5px] hidden md:block" />
          <USkeleton class="h-3.5 w-24 hidden lg:block" />
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-if="!pending && filteredCoupons.length === 0"
        class="flex flex-col items-center justify-center py-16"
      >
        <UIcon name="i-lucide-ticket" class="size-12 mb-3 text-muted" />
        <p class="text-muted text-sm">{{ t('coupons.noResults') }}</p>
      </div>

      <!-- Pagination -->
      <div
        v-if="!pending && filteredCoupons.length > pageSize"
        class="flex justify-center py-4 border-t border-default"
      >
        <UPagination
          v-model:page="page"
          :total="filteredCoupons.length"
          :items-per-page="pageSize"
          show-edges
        />
      </div>
    </div>

    <!-- Create / edit: dialog from md, full-screen sheet on phones -->
    <PiliBottomSheet
      v-if="isMobile"
      v-model:open="showDialog"
      :title="isEditing ? t('coupons.editTitle') : t('coupons.createTitle')"
      full
    >
      <CouponsCouponForm
        v-model="form"
        :discount-type-options="discountTypeOptions"
        :validation-error="validationError"
      />
      <template #footer>
        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="solid"
            size="xl"
            class="flex-1 justify-center"
            @click="showDialog = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="primary"
            size="xl"
            class="flex-[2] justify-center"
            :loading="isSaving"
            @click="handleSubmit"
          >
            {{ isEditing ? t('common.save') : t('common.create') }}
          </UButton>
        </div>
      </template>
    </PiliBottomSheet>
    <UModal v-else v-model:open="showDialog">
      <template #content>
        <div class="p-6 space-y-4">
          <h2 class="text-xl font-bold">
            {{ isEditing ? t('coupons.editTitle') : t('coupons.createTitle') }}
          </h2>

          <CouponsCouponForm
            v-model="form"
            :discount-type-options="discountTypeOptions"
            :validation-error="validationError"
          />

          <!-- Actions -->
          <div class="flex justify-end gap-2 pt-4">
            <UButton color="neutral" variant="ghost" @click="showDialog = false">
              {{ t('common.cancel') }}
            </UButton>
            <UButton color="primary" :loading="isSaving" @click="handleSubmit">
              {{ isEditing ? t('common.save') : t('common.create') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script lang="ts" setup>
import type { Coupon } from '~/types'
import {
  buildCouponInput,
  periodLabel as buildPeriodLabel,
  statusMeta as buildStatusMeta,
  couponToForm,
  defaultCouponForm,
  discountLabel,
  filterCoupons,
  formatDateRange,
  paginate,
  validateCouponForm,
  type MobileCouponStatus,
} from '~/utils/coupons'
import { computed, ref, watch } from 'vue'
import { useGqlMutation, useGqlQuery, useGqlSubscription } from '#imports'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const isMobile = useIsMobile()
const toast = useToast()

const searchQuery = ref('')
const filterStatus = ref<'all' | 'active' | 'inactive'>('all')
const filterType = ref<'all' | 'PERCENTAGE' | 'FIXED'>('all')
const page = ref(1)
const pageSize = ref(10)

// Phone layout: one chip rail for the status, the type filter lives in a sheet
type MobileStatus = MobileCouponStatus
const mobileStatus = ref<MobileStatus>('all')
const showFilters = ref(false)

// Table columns (same pattern as products page)
const columns = computed(() => [
  { accessorKey: 'code', header: t('coupons.code') },
  {
    accessorKey: 'discountType',
    header: t('coupons.type'),
    meta: { class: { td: 'hidden sm:table-cell', th: 'hidden sm:table-cell' } },
  },
  {
    accessorKey: 'discountValue',
    header: t('coupons.value'),
    meta: { class: { td: 'text-right', th: 'text-right' } },
  },
  {
    accessorKey: 'minOrderAmount',
    header: t('coupons.minOrder'),
    meta: {
      class: { td: 'hidden lg:table-cell text-right', th: 'hidden lg:table-cell text-right' },
    },
  },
  {
    accessorKey: 'maxUses',
    header: `${t('coupons.used')} / ${t('coupons.maxUses')}`,
    meta: {
      class: { td: 'hidden lg:table-cell text-right', th: 'hidden lg:table-cell text-right' },
    },
  },
  {
    accessorKey: 'maxUsesPerUser',
    header: t('coupons.maxUsesPerUser'),
    meta: {
      class: { td: 'hidden lg:table-cell text-right', th: 'hidden lg:table-cell text-right' },
    },
  },
  {
    accessorKey: 'isActive',
    header: t('coupons.active'),
    meta: { class: { td: 'hidden md:table-cell', th: 'hidden md:table-cell' } },
  },
  {
    accessorKey: 'validPeriod',
    header: t('coupons.validUntil'),
    enableSorting: false,
    meta: { class: { td: 'hidden xl:table-cell', th: 'hidden xl:table-cell' } },
  },
  { accessorKey: 'actions', header: '', enableSorting: false },
])

const COUPONS_QUERY = /* GraphQL */ `
  query {
    coupons {
      id
      code
      discountType
      discountValue
      minOrderAmount
      maxUses
      maxUsesPerUser
      usedCount
      isActive
      appOnly
      status
      validFrom
      validUntil
      createdAt
    }
  }
`

const CREATE_COUPON_MUTATION = /* GraphQL */ `
  mutation ($input: CreateCouponInput!) {
    createCoupon(input: $input) {
      id
      code
      discountType
      discountValue
      minOrderAmount
      maxUses
      maxUsesPerUser
      usedCount
      isActive
      appOnly
      status
      validFrom
      validUntil
      createdAt
    }
  }
`

const UPDATE_COUPON_MUTATION = /* GraphQL */ `
  mutation ($id: ID!, $input: UpdateCouponInput!) {
    updateCoupon(id: $id, input: $input) {
      id
      code
      discountType
      discountValue
      minOrderAmount
      maxUses
      maxUsesPerUser
      usedCount
      isActive
      appOnly
      status
      validFrom
      validUntil
      createdAt
    }
  }
`

const TOGGLE_COUPON_MUTATION = /* GraphQL */ `
  mutation ($id: ID!, $input: UpdateCouponInput!) {
    updateCoupon(id: $id, input: $input) {
      id
      isActive
      status
    }
  }
`

const SUB_COUPON_UPDATED = /* GraphQL */ `
  subscription CouponUpdated {
    couponUpdated {
      id
      code
      discountType
      discountValue
      minOrderAmount
      maxUses
      maxUsesPerUser
      usedCount
      isActive
      appOnly
      status
      validFrom
      validUntil
      createdAt
    }
  }
`

const { data: dataCoupons, pending } = await useGqlQuery<{ coupons: Coupon[] }>(
  COUPONS_QUERY,
  {},
  { immediate: true, cache: true },
)

const coupons = computed(() => dataCoupons.value?.coupons ?? [])

const filteredCoupons = computed(() =>
  filterCoupons(coupons.value, {
    search: searchQuery.value,
    isMobile: isMobile.value,
    mobileStatus: mobileStatus.value,
    status: filterStatus.value,
    type: filterType.value,
  }),
)

const statusMeta = (status: Coupon['status']) => buildStatusMeta(status, t)

const paginatedCoupons = computed(() => paginate(filteredCoupons.value, page.value, pageSize.value))

watch([searchQuery, filterStatus, filterType, mobileStatus], () => {
  page.value = 1
})

// Inline toggle state
const togglingId = ref<string | null>(null)

const toggleActive = async (coupon: Coupon) => {
  togglingId.value = coupon.id
  try {
    const { mutate } = useGqlMutation<{ updateCoupon: Coupon }>(TOGGLE_COUPON_MUTATION)
    const res = await mutate({ id: coupon.id, input: { isActive: !coupon.isActive } })

    if (dataCoupons.value?.coupons) {
      const idx = dataCoupons.value.coupons.findIndex((c) => c.id === coupon.id)
      if (idx !== -1) {
        dataCoupons.value.coupons.splice(idx, 1, {
          ...dataCoupons.value.coupons[idx],
          ...res.updateCoupon,
        })
      }
    }
  } catch {
    toast.add({ title: t('orders.errors.updateFailed'), color: 'error' })
  } finally {
    togglingId.value = null
  }
}

// Dialog state
const showDialog = ref(false)
const isEditing = ref(false)
const editingCouponId = ref<string | null>(null)
const isSaving = ref(false)
const validationError = ref('')

const mobileStatusOptions = computed(() => [
  { value: 'all' as MobileStatus, label: t('orderHistory.allTypes') },
  { value: 'ACTIVE' as MobileStatus, label: t('coupons.active') },
  { value: 'SCHEDULED' as MobileStatus, label: t('coupons.scheduled') },
  { value: 'INACTIVE' as MobileStatus, label: t('coupons.inactive') },
  { value: 'EXPIRED' as MobileStatus, label: t('coupons.expired') },
])

const typeSheetOptions = computed(() => [
  { value: 'all', label: t('orderHistory.allTypes') },
  { value: 'PERCENTAGE', label: t('coupons.percentage') },
  { value: 'FIXED', label: t('coupons.fixed') },
])

const discountTypeOptions = computed(() => [
  { label: t('coupons.percentage'), value: 'PERCENTAGE' },
  { label: t('coupons.fixed'), value: 'FIXED' },
])

const statusFilterOptions = computed(() => [
  { label: t('orderHistory.allTypes'), value: 'all' },
  { label: t('coupons.active'), value: 'active' },
  { label: t('coupons.inactive'), value: 'inactive' },
])

const typeFilterOptions = computed(() => [
  { label: t('orderHistory.allTypes'), value: 'all' },
  { label: t('coupons.percentage'), value: 'PERCENTAGE' },
  { label: t('coupons.fixed'), value: 'FIXED' },
])

const form = ref(defaultCouponForm())

const periodLabel = (coupon: Coupon) => buildPeriodLabel(coupon, t)

const openCreateDialog = () => {
  isEditing.value = false
  editingCouponId.value = null
  form.value = defaultCouponForm()
  validationError.value = ''
  showDialog.value = true
}

const openEditDialog = (coupon: Coupon) => {
  isEditing.value = true
  editingCouponId.value = coupon.id
  form.value = couponToForm(coupon)
  validationError.value = ''
  showDialog.value = true
}

const validate = (): boolean => {
  validationError.value = validateCouponForm(form.value, t)
  return validationError.value === ''
}

const handleSubmit = async () => {
  if (!validate()) return
  isSaving.value = true

  try {
    if (isEditing.value && editingCouponId.value) {
      const input = buildCouponInput(form.value)

      const { mutate } = useGqlMutation<{ updateCoupon: Coupon }>(UPDATE_COUPON_MUTATION)
      const res = await mutate({ id: editingCouponId.value, input })

      if (dataCoupons.value?.coupons) {
        dataCoupons.value = {
          ...dataCoupons.value,
          coupons: dataCoupons.value.coupons.map((c) =>
            c.id === res.updateCoupon.id ? res.updateCoupon : c,
          ),
        }
      }
    } else {
      const input = buildCouponInput(form.value)

      const { mutate } = useGqlMutation<{ createCoupon: Coupon }>(CREATE_COUPON_MUTATION)
      const res = await mutate({ input })

      // The couponUpdated push usually arrives before this answer and has already added the coupon: keep one row.
      const others = (dataCoupons.value?.coupons ?? []).filter((c) => c.id !== res.createCoupon.id)
      dataCoupons.value = {
        ...dataCoupons.value,
        coupons: [res.createCoupon, ...others],
      }
    }

    showDialog.value = false
  } catch (err) {
    if (import.meta.dev) console.error('Coupon save failed:', err)
    toast.add({ title: t('coupons.errors.saveFailed'), color: 'error' })
  } finally {
    isSaving.value = false
  }
}

// Subscribe in setup so onScopeDispose ties to the component scope; in onMounted it leaks the WebSocket.
const { data: liveCoupon } = useGqlSubscription<{ couponUpdated: Coupon }>(SUB_COUPON_UPDATED)
watch(liveCoupon, (val) => {
  if (!val?.couponUpdated?.id || !dataCoupons.value?.coupons) return
  const idx = dataCoupons.value.coupons.findIndex((c) => c.id === val.couponUpdated.id)
  if (idx === -1) {
    dataCoupons.value.coupons.unshift(val.couponUpdated)
  } else {
    dataCoupons.value.coupons.splice(idx, 1, val.couponUpdated)
  }
})
</script>
