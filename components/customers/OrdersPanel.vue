<template>
  <div v-if="customer" class="space-y-5">
    <!-- Customer Header -->
    <div>
      <h2 class="text-lg font-bold text-highlighted">
        {{ customer.firstName }} {{ customer.lastName }}
      </h2>
      <div class="space-y-1 mt-1 text-sm text-muted">
        <p>{{ customer.email }}</p>
        <p v-if="customer.phoneNumber" class="font-mono tabular-nums">{{ customer.phoneNumber }}</p>
        <p>
          {{ t('customers.memberSince') }}:
          <span class="font-mono tabular-nums">{{ formatDate(customer.registeredAt) }}</span>
        </p>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-3 gap-3">
      <div class="rounded-[14px] bg-accented p-3 text-center">
        <p class="text-lg font-bold text-highlighted font-mono tabular-nums">
          {{ customer.totalOrders }}
        </p>
        <p class="text-xs text-muted">{{ t('customers.totalOrders') }}</p>
      </div>
      <div class="rounded-[14px] bg-accented p-3 text-center">
        <p class="text-lg font-bold text-highlighted font-mono tabular-nums">
          {{ formatPrice(customer.totalAmount) }}
        </p>
        <p class="text-xs text-muted">{{ t('customers.totalAmount') }}</p>
      </div>
      <div class="rounded-[14px] bg-accented p-3 text-center">
        <p class="text-lg font-bold text-highlighted font-mono tabular-nums">
          {{ formatPrice(customer.averageOrderAmount) }}
        </p>
        <p class="text-xs text-muted">{{ t('customers.averageOrder') }}</p>
      </div>
    </div>

    <!-- Orders List -->
    <div class="space-y-2">
      <h3 class="hidden md:block text-sm font-medium text-muted">
        {{ t('customers.orderHistory') }}
      </h3>

      <div v-if="loading" class="space-y-2">
        <div
          v-for="i in 5"
          :key="i"
          class="flex items-center gap-3 p-3 rounded-[14px] bg-elevated border border-default"
        >
          <USkeleton class="size-5 rounded shrink-0" />
          <div class="flex-1 space-y-1">
            <USkeleton class="h-3.5 w-24" />
            <USkeleton class="h-3 w-16" />
          </div>
          <USkeleton class="h-4 w-14" />
        </div>
      </div>

      <template v-else-if="orders.length">
        <div
          v-for="order in orders"
          :key="order.id"
          class="flex items-center gap-3 p-3 rounded-[14px] bg-elevated border border-default"
        >
          <UIcon
            :name="order.type === 'DELIVERY' ? 'i-lucide-bike' : 'i-lucide-shopping-bag'"
            class="size-5 shrink-0 text-muted"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-medium text-highlighted font-mono tabular-nums">{{
                formatOrderDate(order.createdAt)
              }}</span>
              <span class="text-sm font-bold text-highlighted shrink-0 font-mono tabular-nums">{{
                formatPrice(order.totalPrice)
              }}</span>
            </div>
            <div class="flex items-center gap-2 mt-0.5">
              <PiliChip size="sm" :tone="statusTone(order.status)">
                {{ t(`orders.status.${order.status.toLowerCase()}`) }}
              </PiliChip>
              <span class="text-xs text-muted font-mono tabular-nums"
                >{{ order.items.length }} {{ t('orderHistory.itemsShort') }}</span
              >
            </div>
          </div>
        </div>

        <!-- Load More -->
        <UButton
          v-if="orders.length >= pageSize"
          variant="ghost"
          color="neutral"
          block
          size="sm"
          :loading="loadingMore"
          @click="emit('loadMore')"
        >
          {{ t('common.loadMore') }}
        </UButton>
      </template>

      <div v-else class="text-center py-8">
        <UIcon name="i-lucide-package-x" class="size-10 mx-auto mb-2 text-muted" />
        <p class="text-sm text-muted">{{ t('customers.noOrdersFound') }}</p>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { CustomerStats } from '~/types'
import { useI18n } from 'vue-i18n'

export interface CustomerOrder {
  id: string
  createdAt: string
  status: string
  type: string
  totalPrice: string
  items: { quantity: number; product: { name: string } }[]
}

defineProps<{
  customer: CustomerStats | null
  orders: CustomerOrder[]
  loading: boolean
  loadingMore: boolean
  pageSize: number
}>()

const emit = defineEmits<{ loadMore: [] }>()

const { t } = useI18n()

const statusTone = (status: string): 'warning' | 'danger' | 'success' | 'info' | 'neutral' => {
  switch (status) {
    case 'PENDING':
      return 'warning'
    case 'OUT_FOR_DELIVERY':
      return 'info'
    case 'AWAITING_PICK_UP':
    case 'DELIVERED':
    case 'PICKED_UP':
      return 'success'
    case 'FAILED':
    case 'CANCELLED':
      return 'danger'
    default:
      return 'neutral'
  }
}

const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString()

const formatOrderDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('fr-BE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
</script>
