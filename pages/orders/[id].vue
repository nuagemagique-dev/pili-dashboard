<template>
  <!-- Mobile order detail. Wide screens are redirected to the list, which opens the slideover. -->
  <div v-if="isMobile" class="flex-1 flex flex-col">
    <!-- Top bar -->
    <div
      class="sticky top-0 z-30 h-[60px] px-2 bg-default border-b border-default flex items-center gap-1"
    >
      <button
        type="button"
        class="size-12 rounded-xl flex items-center justify-center active:bg-accented"
        :aria-label="t('common.back')"
        @click="goBack"
      >
        <UIcon name="i-lucide-chevron-left" class="size-7" />
      </button>
      <span class="flex-1 min-w-0 text-base font-bold truncate">
        {{ t('orders.detailTitle') }}
        <span v-if="order" class="font-mono tabular-nums text-muted font-medium">{{
          formatTimeOnly(order.createdAt, locale)
        }}</span>
      </span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="p-4 grid auto-rows-max gap-4">
      <USkeleton class="h-[26px] w-48" />
      <USkeleton class="h-16 w-full rounded-xl" />
      <USkeleton class="h-40 w-full rounded-[14px]" />
    </div>

    <!-- Not found -->
    <div v-else-if="!order" class="p-4 py-14 text-center text-[15px] text-muted">
      {{ t('orders.notFound') }}
    </div>

    <div v-else class="p-4 grid auto-rows-max gap-4">
      <!-- 1. Identity -->
      <div class="flex flex-col gap-2">
        <div class="flex gap-2 flex-wrap">
          <PiliChip tone="outline" size="lg" class="uppercase">
            {{ order.type === 'DELIVERY' ? t('orders.delivery') : t('orders.pickup') }}
          </PiliChip>
          <PiliChip :tone="ORDER_STATUS_CHIP_TONE[order.status] ?? 'neutral'" size="lg">
            {{ t(`orders.status.${order.status.toLowerCase()}`) }}
          </PiliChip>
        </div>
        <h2 class="text-[26px] font-bold leading-[1.15]">{{ order.displayCustomerName }}</h2>
        <span
          class="font-mono tabular-nums text-sm font-bold"
          :class="active ? age.color : 'text-muted'"
        >
          {{ t('orders.receivedAt', { time: formatTimeOnly(order.createdAt, locale) }) }} &middot;
          {{ age.text }}
        </span>
      </div>

      <!-- 2. Late alert -->
      <div
        v-if="isLate"
        class="py-3 px-3.5 rounded-xl bg-error text-inverted text-[15px] font-bold leading-[1.4]"
      >
        {{ t('orders.staleDetailAlert', { hours: Math.floor(ageMinutes / 60) }) }}
      </div>

      <!-- 3. Contact -->
      <div
        v-if="order.customer?.phoneNumber || showDirections"
        class="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2"
      >
        <a
          v-if="order.customer?.phoneNumber"
          :href="`tel:${order.customer.phoneNumber}`"
          class="min-h-[60px] py-2.5 px-3.5 rounded-xl bg-accented active:bg-(--pili-pressed) flex flex-col justify-center gap-0.5"
        >
          <span class="text-[15px] font-bold">{{ t('orders.call') }}</span>
          <span class="font-mono tabular-nums text-xs text-muted">{{
            order.customer.phoneNumber
          }}</span>
        </a>
        <a
          v-if="showDirections"
          :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.displayAddress)}`"
          target="_blank"
          rel="noopener"
          class="min-h-[60px] py-2.5 px-3.5 rounded-xl bg-accented active:bg-(--pili-pressed) flex flex-col justify-center gap-0.5 min-w-0"
        >
          <span class="flex items-center gap-2">
            <span class="text-[15px] font-bold">{{ t('orders.directions') }}</span>
            <PiliChip
              v-if="order.isManualAddress && order.status === 'PENDING'"
              tone="warning"
              size="sm"
            >
              {{ t('orders.manualAddress') }}
            </PiliChip>
          </span>
          <span class="text-xs text-muted truncate">{{ order.displayAddress }}</span>
        </a>
      </div>

      <!-- 4. Customer note (before the items) -->
      <p
        v-if="order.orderNote"
        class="py-3 px-3.5 rounded-xl border border-warning text-[15px] leading-[1.45]"
      >
        <span
          class="block font-mono text-[11px] font-bold tracking-[0.06em] text-warning mb-1 uppercase"
          >{{ t('orders.customerNote') }}</span
        >
        {{ order.orderNote }}
      </p>

      <!-- 5. Items -->
      <div class="bg-elevated border border-default rounded-[14px] overflow-hidden">
        <div
          v-for="(item, idx) in order.items"
          :key="`${item.product.id}-${item.choice?.id ?? idx}`"
          class="grid grid-cols-[36px_1fr_auto] gap-2.5 items-start py-3 px-3.5 border-b border-default"
        >
          <span class="font-mono tabular-nums text-[17px] font-bold"
            >{{ item.quantity }}&times;</span
          >
          <div class="min-w-0 flex flex-col gap-0.5">
            <span class="text-base font-bold leading-[1.3]">{{ itemNames(item).main }}</span>
            <span v-if="item.product.code || itemNames(item).zh" class="text-[13px] text-muted">
              <span v-if="item.product.code" class="font-mono tabular-nums">{{
                item.product.code
              }}</span>
              <template v-if="item.product.code && itemNames(item).zh"> &middot; </template>
              <span v-if="itemNames(item).zh" class="font-(family-name:--font-zh)">{{
                itemNames(item).zh
              }}</span>
            </span>
            <span v-if="item.choice" class="text-sm text-warning font-bold"
              >+ {{ item.choice.name }}</span
            >
          </div>
          <span class="font-mono tabular-nums text-[15px]">{{ formatPrice(item.totalPrice) }}</span>
        </div>
        <div class="py-2.5 px-3.5 flex flex-col gap-1.5 text-sm text-muted">
          <div class="flex justify-between">
            <span>{{ t('orders.subtotal') }}</span>
            <span class="font-mono tabular-nums">{{ formatPrice(itemsSubtotal) }}</span>
          </div>
          <div
            v-if="parseFloat(order.discountAmount) > 0"
            class="flex justify-between text-success"
          >
            <span
              >{{ t('orders.discount')
              }}{{ order.couponCode ? ` (${order.couponCode})` : '' }}</span
            >
            <span class="font-mono tabular-nums"
              >&minus;{{ formatPrice(order.discountAmount) }}</span
            >
          </div>
          <div
            v-if="order.deliveryFee && parseFloat(order.deliveryFee) > 0"
            class="flex justify-between"
          >
            <span>{{ t('orders.deliveryFeeLabel') }}</span>
            <span class="font-mono tabular-nums">{{ formatPrice(order.deliveryFee) }}</span>
          </div>
        </div>
        <div class="p-3.5 bg-accented flex justify-between items-baseline">
          <span class="text-base font-bold">{{ t('orders.total') }}</span>
          <span class="font-mono tabular-nums text-[22px] font-bold">{{
            formatPrice(order.totalPrice)
          }}</span>
        </div>
      </div>

      <!-- 6. Payment -->
      <div
        class="min-h-[60px] py-2.5 pr-2.5 pl-3.5 rounded-[14px] bg-elevated border border-default flex items-center gap-2.5 flex-wrap"
      >
        <span class="text-[15px] font-bold">
          {{
            order.isOnlinePayment
              ? t('orders.paymentMethod.online')
              : t('orders.paymentMethod.cash')
          }}
        </span>
        <PiliChip :tone="paymentTone" size="lg">{{ paymentLabel }}</PiliChip>
        <button
          v-if="!isPaid"
          type="button"
          class="ml-auto h-11 px-3.5 rounded-[10px] bg-accented active:bg-(--pili-pressed) text-sm font-bold flex items-center gap-2 disabled:opacity-60"
          :disabled="isUpdatingPayment"
          @click="markAsPaid"
        >
          <span class="size-2 rounded-full bg-success" />
          {{ t('orders.markPaid') }}
        </button>
      </div>

      <!-- 7. Time -->
      <div class="p-3.5 rounded-[14px] bg-elevated border border-default flex flex-col gap-3">
        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-muted">{{ t('orders.preferredTime') }}</span>
            <span class="font-mono tabular-nums text-[17px] font-bold">
              {{
                order.preferredReadyTime
                  ? formatTimeOnly(order.preferredReadyTime, locale)
                  : t('orders.asap')
              }}
            </span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-muted">{{
              estimateChanged ? t('orders.newEstimate') : t('orders.currentEstimate')
            }}</span>
            <span class="font-mono tabular-nums text-[17px] font-bold">{{ estimateShown }}</span>
          </div>
        </div>
        <PiliSegmented
          v-model="deltaModel"
          :options="deltaOptions"
          :height="48"
          surface="ardoise"
          mono
          deselectable
          :label="t('orders.timeManagement')"
        />
      </div>

      <!-- 8. Cancel -->
      <button
        v-if="secondaryStatuses.includes('CANCELLED')"
        type="button"
        class="h-[52px] rounded-xl border border-error text-error text-[15px] font-bold"
        @click="openCancelDialog"
      >
        {{ t('orders.cancelOrder') }}
      </button>
      <button
        v-if="secondaryStatuses.includes('FAILED')"
        type="button"
        class="justify-self-center min-h-11 px-3 text-sm text-muted underline underline-offset-2"
        :disabled="quickActionLoading"
        @click="quickStatusAdvance('FAILED')"
      >
        {{ t('orders.status.failed') }}
      </button>
    </div>

    <!-- Cancel confirmation -->
    <PiliBottomSheet
      :open="showCancelDialog"
      :title="t('orders.confirmCancelTitle')"
      @update:open="onCancelSheet"
    >
      <p class="text-[15px] text-muted leading-[1.45]">{{ t('orders.confirmCancelMessage') }}</p>
      <p v-if="order?.isOnlinePayment" class="text-[15px] text-error font-bold leading-[1.4]">
        {{ t('orders.refundNotice') }}
      </p>
      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          class="h-14 rounded-xl bg-accented active:bg-(--pili-pressed) text-base font-bold disabled:opacity-60"
          :disabled="isCancelling"
          @click="cancelCancellation"
        >
          {{ t('orders.back') }}
        </button>
        <button
          type="button"
          class="h-14 rounded-xl text-base font-bold font-mono tabular-nums"
          :class="confirmDisabled ? 'bg-(--pili-pressed) text-muted' : 'bg-error text-inverted'"
          :disabled="confirmDisabled || isCancelling"
          @click="confirmCancellation"
        >
          {{ confirmDisabled ? `${t('orders.confirm')} (${cancelDelay})` : t('orders.confirm') }}
        </button>
      </div>
    </PiliBottomSheet>

    <!-- Action bar (last child: sticks above the safe area, the tab bar is hidden here) -->
    <PiliStickyBar v-if="order && (hasDelta || primaryStatuses.length)">
      <div class="flex gap-2">
        <button
          v-if="hasDelta"
          type="button"
          class="flex-1 h-14 rounded-xl bg-inverted text-inverted flex flex-col items-center justify-center leading-[1.2] text-[15px] font-bold disabled:opacity-60"
          :disabled="isSaving"
          @click="saveTime"
        >
          <span>{{ t('common.save') }}</span>
          <span class="font-mono tabular-nums text-[13px]">{{ newEstimatedTime }}</span>
        </button>
        <template v-for="(status, idx) in barStatuses" :key="status">
          <button
            type="button"
            class="h-14 rounded-xl text-base font-bold active:scale-[0.97] transition-transform disabled:opacity-60"
            :class="
              idx === barStatuses.length - 1
                ? 'flex-[2] bg-primary text-inverted'
                : 'flex-1 bg-accented text-default'
            "
            :disabled="quickActionLoading"
            @click="quickStatusAdvance(status)"
          >
            {{
              idx === barStatuses.length - 1
                ? t(`orders.status.${status.toLowerCase()}`)
                : t(`orders.nextAction.${status.toLowerCase()}`)
            }}
          </button>
        </template>
      </div>
    </PiliStickyBar>
  </div>
</template>

<script setup lang="ts">
import type { Order, OrderStatus } from '~/types'
import { ORDER_BY_ID_QUERY, useOrderActions } from '~/composables/useOrderActions'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatPrice, formatTimeOnly } from '~/utils/utils'
import {
  ORDER_STATUS_CHIP_TONE,
  isActiveStatus,
  itemNames,
  itemsSubtotalCents,
} from '~/utils/orders'
import { centsToEuros } from '~/utils/money'

definePageMeta({ hideTabBar: true })

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()
const toast = useToast()
const isMobile = useIsMobile()
const ordersStore = useOrdersStore()
const { $gqlFetch } = useNuxtApp()

const orderId = computed(() => String(route.params.id ?? ''))

// Wide screens keep the slideover: hand the order over to the list page
if (!isMobile.value) {
  useState<string>('orders-open-request', () => '').value = orderId.value
  navigateTo(localePath('/orders'), { replace: true })
}

const goBack = () => {
  if (window.history.state?.back) {
    router.back()
  } else {
    navigateTo(localePath('/orders'))
  }
}

// A delta the operator picked (the PENDING default of +30 does not count)
const deltaTouched = ref(false)

const {
  selectedOrder,
  sliderDeltaMinutes,
  initialSliderValue,
  isUpdatingPayment,
  quickActionLoading,
  isSaving,
  isCancelling,
  primaryStatuses,
  secondaryStatuses,
  selectOrder,
  initTime,
  newEstimatedTime,
  quickStatusAdvance,
  updateOrder,
  markAsPaid,
  showCancelDialog,
  cancelDelay,
  confirmDisabled,
  openCancelDialog,
  confirmCancellation,
  cancelCancellation,
} = useOrderActions({
  onDone: (kind) => {
    if (kind === 'save') {
      // Stay on the page: the store now holds the saved estimate
      deltaTouched.value = false
      if (selectedOrder.value) initTime(selectedOrder.value)
      toast.add({ title: t('orders.estimateSaved'), color: 'success' })
      return
    }
    goBack()
  },
})

// Order: from the store, or fetched once when the page is reloaded directly
const order = computed<Order | null>(
  () => ordersStore.orders.find((o) => o.id === orderId.value) ?? null,
)
const loading = ref(!order.value)

const fetchOrder = async () => {
  try {
    const data = await $gqlFetch<{ order: Order }>(ORDER_BY_ID_QUERY, {
      variables: { id: orderId.value },
    })
    if (data?.order && !ordersStore.orders.some((o) => o.id === data.order.id)) {
      ordersStore.addOrder(data.order)
      ordersStore.acknowledgeOrder(data.order.id)
    }
  } catch {
    // Not found: the empty state is shown
  } finally {
    loading.value = false
  }
}

if (isMobile.value && !order.value) fetchOrder()

// Initialise the time controls once per order, then keep the selected order in sync with the store
watch(
  () => order.value?.id,
  (id) => {
    if (id && order.value) {
      deltaTouched.value = false
      selectOrder(order.value)
      loading.value = false
    }
  },
  { immediate: true },
)
watch(order, (o) => {
  if (o) selectedOrder.value = o
})

// Elapsed time
const now = ref(new Date())
let nowInterval: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  nowInterval = setInterval(() => {
    now.value = new Date()
  }, 30000)
})
onUnmounted(() => {
  if (nowInterval) clearInterval(nowInterval)
})

const ageMinutes = computed(() => {
  if (!order.value) return 0
  return Math.max(
    0,
    Math.floor((now.value.getTime() - new Date(order.value.createdAt).getTime()) / 60000),
  )
})

const age = computed(() => {
  const min = ageMinutes.value
  const text =
    min < 60
      ? t('orders.timeSince.minutes', { count: min })
      : t('orders.timeSince.hours', { count: Math.floor(min / 60) })
  const color = min < 5 ? 'text-success' : min < 15 ? 'text-warning' : 'text-error'
  return { text, color }
})

const active = computed(() => order.value !== null && isActiveStatus(order.value.status))
const isLate = computed(() => active.value && ageMinutes.value > 120)

const showDirections = computed(
  () => order.value?.type === 'DELIVERY' && Boolean(order.value.displayAddress),
)

// Items
const itemsSubtotal = computed(() => centsToEuros(itemsSubtotalCents(order.value)))

// Payment
const paymentStatus = computed(() => order.value?.payment?.status?.toLowerCase())
const isPaid = computed(() => paymentStatus.value === 'paid')
const paymentTone = computed(() =>
  isPaid.value ? 'success' : paymentStatus.value === 'failed' ? 'danger' : 'warning',
)
const paymentLabel = computed(() =>
  t(
    `orders.payment.status.${isPaid.value ? 'paid' : paymentStatus.value === 'failed' ? 'failed' : 'notPaid'}`,
  ),
)

// Time
const DELTAS = [15, 30, 45, 60]
const deltaOptions = DELTAS.map((m) => ({ value: m, label: `+${m}` }))
const deltaModel = computed<number | null>({
  get: () => (DELTAS.includes(sliderDeltaMinutes.value) ? sliderDeltaMinutes.value : null),
  set: (value) => {
    deltaTouched.value = true
    sliderDeltaMinutes.value = value ?? 0
  },
})

const estimateChanged = computed(() => sliderDeltaMinutes.value !== initialSliderValue.value)
const estimateShown = computed(() => {
  if (estimateChanged.value && newEstimatedTime.value) return newEstimatedTime.value
  return order.value?.estimatedReadyTime
    ? formatTimeOnly(order.value.estimatedReadyTime, locale.value)
    : '-'
})

const hasDelta = computed(() => deltaTouched.value && estimateChanged.value)

const saveTime = () => updateOrder()

// With a delta, only the main next step is offered next to Save
const barStatuses = computed<OrderStatus[]>(() =>
  hasDelta.value ? primaryStatuses.value.slice(-1) : primaryStatuses.value,
)

const onCancelSheet = (open: boolean) => {
  if (!open) cancelCancellation()
}
</script>
