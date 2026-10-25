<template>
  <div class="md:p-6 max-md:flex-1 max-md:flex max-md:flex-col">
    <!-- Order detail page (mobile only): the list below stays mounted and is just hidden -->
    <NuxtPage />

    <!-- Page Header -->
    <div class="hidden md:block mb-6">
      <h1 class="text-2xl font-bold text-highlighted">{{ t('navigation.orders') }}</h1>
      <p class="text-muted">{{ t('orders.subtitle') }}</p>
    </div>

    <!-- Stale order alert banner (Phase 8) -->
    <div
      v-if="staleOrderCount > 0"
      class="hidden md:flex items-center gap-2 px-4 py-3 mb-6 rounded-lg bg-warning text-inverted text-base font-medium"
    >
      <UIcon name="i-lucide-alert-triangle" class="size-5 shrink-0" />
      <i18n-t keypath="orders.staleAlert" :plural="staleOrderCount" tag="span" class="flex-1">
        <template #count>
          <span class="font-mono font-bold tabular-nums">{{ staleOrderCount }}</span>
        </template>
      </i18n-t>
      <UButton
        v-if="firstStaleOrder"
        size="xs"
        variant="solid"
        color="neutral"
        :label="t('orders.orderDetails')"
        @click="openOrderDetails(firstStaleOrder)"
      />
    </div>

    <!-- ========== MOBILE VIEW (< md) ========== -->
    <div v-show="!route.params.id" class="md:hidden">
      <!-- Header -->
      <div class="flex items-center justify-between gap-3 px-4 pt-4 pb-1">
        <h1 class="text-[26px] font-bold leading-[1.1]">{{ t('navigation.orders') }}</h1>
        <button
          v-if="orderingEnabled !== null"
          type="button"
          class="h-9 px-3.5 rounded-full border border-default flex items-center gap-2 font-mono text-xs font-bold tracking-[0.05em] disabled:opacity-60"
          :disabled="orderingUpdating"
          :aria-label="orderingEnabled ? t('orders.online') : t('orders.onPause')"
          @click="toggleOrdering"
        >
          <span class="size-2 rounded-full" :class="orderingEnabled ? 'bg-success' : 'bg-error'" />
          {{ orderingEnabled ? t('orders.online') : t('orders.onPause') }}
        </button>
      </div>
      <p class="px-4 font-mono tabular-nums text-[13px] text-muted">
        {{ nowLabel }} &middot; {{ t('orders.inProgress', { count: ordersInProgress }) }}
      </p>

      <!-- Sticky tabs -->
      <div class="sticky top-0 z-20 bg-default px-4 py-3">
        <PiliSegmented
          v-model="mobileTab"
          :options="mobileTabOptions"
          :height="56"
          :label="t('navigation.orders')"
        />
      </div>

      <!-- Paused banner -->
      <div
        v-if="orderingEnabled === false"
        class="mx-4 mb-2.5 py-2.5 pr-2.5 pl-3.5 rounded-xl bg-error text-inverted flex items-center gap-2.5"
      >
        <span class="flex-1 text-sm font-bold leading-[1.35]">{{ t('orders.paused') }}</span>
        <button
          type="button"
          class="h-10 px-3.5 rounded-lg bg-default text-default text-sm font-bold disabled:opacity-60"
          :disabled="orderingUpdating"
          @click="applyOrdering(true)"
        >
          {{ t('orders.resume') }}
        </button>
      </div>

      <!-- Late orders banner -->
      <button
        v-if="staleOrderCount > 0 && oldestLateOrder"
        type="button"
        class="mx-4 mb-2.5 w-[calc(100%-32px)] min-h-12 py-2.5 px-3.5 rounded-xl bg-warning text-inverted flex items-center gap-2.5 text-left"
        @click="openOrderDetails(oldestLateOrder)"
      >
        <i18n-t
          keypath="orders.staleAlert"
          :plural="staleOrderCount"
          tag="span"
          class="flex-1 text-sm font-bold leading-[1.35]"
        >
          <template #count>
            <span class="font-mono tabular-nums text-[17px] font-bold">{{ staleOrderCount }}</span>
          </template>
        </i18n-t>
        <span class="font-mono font-bold" aria-hidden="true">&rarr;</span>
      </button>

      <!-- Skeleton Loading -->
      <div v-if="pending" class="px-4 pb-5 flex flex-col gap-2.5">
        <div
          v-for="i in 4"
          :key="i"
          class="p-3.5 rounded-[14px] bg-elevated border border-default space-y-2"
        >
          <div class="flex justify-between">
            <USkeleton class="h-5 w-32" />
            <USkeleton class="h-5 w-16" />
          </div>
          <USkeleton class="h-[22px] w-24" />
          <USkeleton class="h-4 w-48" />
        </div>
      </div>

      <!-- Orders list -->
      <div v-else class="px-4 pb-5 flex flex-col gap-2.5">
        <div
          v-for="order in mobileCards"
          :key="order.id"
          class="bg-elevated border rounded-[14px] overflow-hidden"
          :class="isLateOrder(order) ? 'border-error' : 'border-default'"
        >
          <button
            type="button"
            class="w-full p-3.5 flex flex-col gap-2 text-left"
            @click="openOrderDetails(order)"
          >
            <div class="w-full flex items-baseline gap-2.5">
              <span class="flex-1 min-w-0 text-[17px] font-bold truncate">{{
                order.displayCustomerName
              }}</span>
              <span class="font-mono tabular-nums text-[17px] font-bold">{{
                formatPrice(order.totalPrice)
              }}</span>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <PiliChip tone="outline" class="uppercase">
                {{ order.type === 'DELIVERY' ? t('orders.delivery') : t('orders.pickup') }}
              </PiliChip>
              <span
                v-if="isActiveStatus(order.status)"
                class="font-mono tabular-nums text-sm font-bold"
                :class="getTimeSince(order.createdAt).color"
              >
                {{ getTimeSince(order.createdAt).text }}
              </span>
              <PiliChip
                v-if="!isActiveStatus(order.status) || order.status === 'CONFIRMED'"
                :tone="ORDER_STATUS_CHIP_TONE[order.status] ?? 'neutral'"
              >
                {{ t(`orders.status.${order.status.toLowerCase()}`) }}
              </PiliChip>
              <PiliChip v-if="isLateOrder(order)" tone="danger" mono class="uppercase">
                {{ t('orders.lateChip') }}
              </PiliChip>
              <PiliChip v-if="isUnpaidCash(order)" tone="warning">
                {{ t('orders.payment.status.notPaid') }}
              </PiliChip>
            </div>
            <span class="text-sm text-muted leading-[1.4]">{{ cardMeta(order) }}</span>
          </button>
          <button
            v-if="nextActionOf(order)"
            type="button"
            class="w-full h-[52px] border-t border-default bg-accented active:bg-(--pili-pressed) text-[15px] font-bold flex items-center justify-center gap-2"
            @click="quickAdvanceStatus(order)"
          >
            {{ t(`orders.nextAction.${nextActionOf(order)!.toLowerCase()}`) }}
            <span class="font-mono" aria-hidden="true">&rarr;</span>
          </button>
        </div>

        <p v-if="!mobileCards.length" class="py-14 px-4 text-center text-[15px] text-muted">
          {{ t('orders.noOrders') }}
        </p>
      </div>
    </div>

    <!-- ========== TABLET+ VIEW: Kanban board (md:) ========== -->
    <div class="hidden md:block">
      <!-- Skeleton Loading -->
      <div v-if="pending" class="flex gap-3 pb-4">
        <div v-for="i in 5" :key="i" class="kanban-column flex-1 min-w-0">
          <div class="kanban-column-header">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <USkeleton class="size-8 rounded-lg" />
                <div class="space-y-1">
                  <USkeleton class="h-4 w-24" />
                  <USkeleton class="h-3 w-16" />
                </div>
              </div>
              <USkeleton class="h-6 w-8 rounded-full" />
            </div>
          </div>
          <div class="kanban-column-body space-y-3">
            <UCard v-for="j in 2" :key="j">
              <div class="space-y-2">
                <div class="flex items-start justify-between">
                  <div class="space-y-1">
                    <USkeleton class="h-4 w-28" />
                    <USkeleton class="h-3 w-20" />
                  </div>
                  <USkeleton class="h-5 w-14 rounded-full" />
                </div>
                <USkeleton class="h-5 w-20 rounded-full" />
                <div class="flex justify-between pt-2 border-t border-default">
                  <USkeleton class="h-3 w-16" />
                  <USkeleton class="h-4 w-14" />
                </div>
              </div>
            </UCard>
          </div>
        </div>
      </div>

      <!-- Kanban Board -->
      <div v-else class="flex gap-3 pb-4 min-h-[calc(100vh-200px)]">
        <div
          v-for="column in kanbanColumns"
          :key="column.key"
          :data-column-key="column.key"
          class="kanban-column flex-1 min-w-0 flex flex-col transition-all duration-200"
          :class="[
            dragOverColumnKey === column.key ? 'kanban-drop-target' : '',
            draggedOrder && column.statuses.includes(draggedOrder.status)
              ? 'kanban-drag-source'
              : '',
          ]"
          @dragover="(e: DragEvent) => onColumnDragOver(e, column)"
          @dragleave="onColumnDragLeave"
          @drop="(e: DragEvent) => onColumnDrop(e, column)"
        >
          <!-- Column Header -->
          <div class="kanban-column-header">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <UIcon :name="column.icon" class="size-4.5 text-muted" />
                <h3 class="font-mono uppercase text-sm font-bold text-highlighted leading-tight">
                  {{ column.label }}
                </h3>
              </div>
              <span class="font-mono tabular-nums text-sm font-bold text-muted">
                {{ column.orders.length }}
              </span>
            </div>

            <!-- Date filter for completed column -->
            <div
              v-if="column.key === 'COMPLETED'"
              class="flex items-center justify-between mt-2 pt-2 border-t border-default"
            >
              <UButton
                icon="i-lucide-chevron-left"
                size="xs"
                variant="ghost"
                color="neutral"
                square
                @click="shiftCompletedDate(-1)"
              />
              <button
                class="text-xs font-medium text-muted hover:text-highlighted transition-colors"
                :class="isCompletedFilterToday ? '' : 'underline'"
                @click="completedFilterDate = brusselsDateISO()"
              >
                {{ completedFilterLabel }}
              </button>
              <UButton
                icon="i-lucide-chevron-right"
                size="xs"
                variant="ghost"
                color="neutral"
                square
                :disabled="isCompletedFilterToday"
                @click="shiftCompletedDate(1)"
              />
            </div>
          </div>

          <!-- Column Body -->
          <div class="kanban-column-body flex-1 overflow-y-auto space-y-3">
            <UCard
              v-for="order in column.orders"
              :key="order.id"
              :draggable="column.key !== 'COMPLETED' ? 'true' : 'false'"
              :class="[
                'bg-elevated ring-0 border border-default cursor-pointer hover:border-accented transition-all',
                column.key !== 'COMPLETED' ? 'kanban-touch-draggable' : '',
                draggedOrder?.id === order.id ? 'opacity-40 scale-95' : '',
              ]"
              @dragstart="(e: DragEvent) => onDragStart(e, order)"
              @dragend="onDragEnd"
              @touchstart="(e: TouchEvent) => onCardTouchStart(e, order, column)"
              @click="openOrderDetails(order)"
            >
              <div class="space-y-2">
                <!-- Row 1: Type icon + name + total -->
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="order.type === 'DELIVERY' ? 'i-lucide-bike' : 'i-lucide-shopping-bag'"
                    class="size-4 shrink-0 text-muted"
                  />
                  <span class="font-bold text-sm text-highlighted truncate flex-1">{{
                    order.displayCustomerName
                  }}</span>
                  <span
                    class="font-bold text-sm text-highlighted shrink-0 font-mono tabular-nums"
                    >{{ formatPrice(order.totalPrice) }}</span
                  >
                </div>

                <!-- Address (delivery only) -->
                <p
                  v-if="order.type === 'DELIVERY' && order.displayAddress"
                  class="text-xs text-muted truncate"
                >
                  {{ order.displayAddress }}
                </p>

                <!-- Row 2: Items + payment icon + time-since -->
                <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
                  <div class="flex items-center gap-2 text-muted">
                    <span class="whitespace-nowrap"
                      ><span class="font-mono tabular-nums">{{ order.items.length }}</span>
                      {{ t('orders.items') }}</span
                    >
                    <UIcon
                      :name="order.isOnlinePayment ? 'i-lucide-credit-card' : 'i-lucide-banknote'"
                      :class="['size-3.5', getPaymentIconClass(order)]"
                    />
                  </div>
                  <div
                    v-if="isActiveStatus(order.status)"
                    class="flex flex-wrap items-center gap-x-1.5 gap-y-1"
                  >
                    <UBadge
                      v-if="getTimeSince(order.createdAt).isStale"
                      color="error"
                      variant="solid"
                      size="xs"
                      :class="[chipClass, 'whitespace-nowrap shrink-0']"
                      >{{ t('orders.lateChip') }}</UBadge
                    >
                    <UBadge
                      v-else-if="order.status === 'PENDING'"
                      color="warning"
                      variant="solid"
                      size="xs"
                      :class="[chipClass, 'whitespace-nowrap shrink-0']"
                    >
                      {{ t('orders.status.pending') }}
                    </UBadge>
                    <span
                      :class="[
                        'font-bold font-mono tabular-nums whitespace-nowrap shrink-0',
                        getTimeSince(order.createdAt).color,
                      ]"
                    >
                      {{ getTimeSince(order.createdAt).text }}
                    </span>
                  </div>
                  <UBadge
                    v-else-if="column.statuses.length > 1"
                    :color="getStatusColor(order.status)"
                    variant="solid"
                    size="xs"
                    :class="[chipClass, 'whitespace-nowrap shrink-0']"
                  >
                    {{ t(`orders.status.${order.status.toLowerCase()}`) }}
                  </UBadge>
                </div>

                <!-- Row 3: Estimated time + payment status (only when noteworthy) -->
                <div
                  v-if="order.estimatedReadyTime || paymentChip(order)"
                  class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-1.5 border-t border-default"
                >
                  <span
                    v-if="order.estimatedReadyTime"
                    class="text-xs text-muted flex items-center gap-1 font-mono tabular-nums whitespace-nowrap"
                  >
                    <UIcon name="i-lucide-clock" class="size-3" />
                    {{ formatTimeOnly(order.estimatedReadyTime, locale) }}
                  </span>
                  <span v-else />
                  <UBadge
                    v-if="paymentChip(order)"
                    :color="paymentChip(order)!.color"
                    variant="solid"
                    size="xs"
                    :class="[chipClass, 'whitespace-nowrap shrink-0']"
                  >
                    {{ paymentChip(order)!.label }}
                  </UBadge>
                </div>
              </div>
            </UCard>

            <!-- Empty column -->
            <div v-if="column.orders.length === 0" class="text-center py-12 text-muted text-sm">
              <UIcon :name="column.icon" class="size-10 mx-auto mb-2 opacity-30" />
              <p>{{ t('orders.noOrders') }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Order Details Slideover -->
    <USlideover
      v-model:open="showOrderDetails"
      :title="t('orders.orderDetails')"
      :description="t('orders.orderDetailsDescription')"
      side="right"
      :ui="slideoverUi"
    >
      <template v-if="selectedOrder" #body>
        <div class="space-y-5">
          <!-- 1. Header: identity + status -->
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <UIcon
                  :name="
                    selectedOrder.type === 'DELIVERY' ? 'i-lucide-bike' : 'i-lucide-shopping-bag'
                  "
                  class="size-5 shrink-0 text-muted"
                />
                <h2 class="text-lg font-bold text-highlighted truncate">
                  {{ selectedOrder.displayCustomerName }}
                </h2>
              </div>
              <div class="flex items-center gap-2 text-sm text-muted">
                <span class="font-mono tabular-nums">{{
                  formatDate(selectedOrder.createdAt, locale)
                }}</span>
                <UBadge
                  :color="getStatusColor(selectedOrder.status)"
                  variant="solid"
                  size="xs"
                  :class="chipClass"
                >
                  {{ t(`orders.status.${selectedOrder.status?.toLowerCase()}`) }}
                </UBadge>
              </div>
            </div>
          </div>

          <!-- 2. Stale order alert (Phase 8) -->
          <div
            v-if="
              isActiveStatus(selectedOrder.status) && getTimeSince(selectedOrder.createdAt).isStale
            "
            class="flex items-center gap-2 px-3 py-2 rounded-lg bg-error text-inverted text-sm font-medium"
          >
            <UIcon name="i-lucide-alert-triangle" class="size-4 shrink-0" />
            <i18n-t keypath="orders.staleDetailAlert" tag="span">
              <template #hours>
                <span class="font-mono font-bold tabular-nums">{{
                  hoursSince(selectedOrder.createdAt, now)
                }}</span>
              </template>
            </i18n-t>
          </div>

          <!-- 3. Primary Quick Actions -->
          <div
            v-if="primaryStatuses.length"
            class="grid gap-2"
            :class="primaryStatuses.length > 1 ? 'grid-cols-2' : ''"
          >
            <UButton
              v-for="(status, idx) in primaryStatuses"
              :key="status"
              size="xl"
              block
              :color="idx === 0 ? 'primary' : 'neutral'"
              :loading="quickActionLoading"
              @click="quickStatusAdvance(status)"
            >
              <UIcon :name="getStatusIcon(status)" class="mr-2" />
              {{ t(`orders.status.${status.toLowerCase()}`) }}
            </UButton>
          </div>

          <!-- 4. Order Items with discount breakdown -->
          <div class="border border-default rounded-lg overflow-hidden bg-elevated">
            <div class="divide-y divide-default">
              <div
                v-for="(item, idx) in selectedOrder.items"
                :key="`${item.product.id}-${item.choice?.id ?? idx}`"
                class="flex items-center justify-between px-3 py-2"
              >
                <div class="flex items-center gap-2 min-w-0 flex-1">
                  <span class="text-sm font-bold text-highlighted shrink-0 font-mono tabular-nums"
                    >{{ item.quantity }}x</span
                  >
                  <div class="min-w-0">
                    <p class="text-sm truncate">
                      <span v-if="item.product.code" class="font-mono tabular-nums"
                        >{{ item.product.code }} -</span
                      >
                      {{ itemNames(item).main }}
                      <span v-if="item.choice" class="text-muted">({{ item.choice.name }})</span>
                    </p>
                    <p
                      v-if="itemNames(item).zh"
                      class="text-sm text-muted truncate font-(family-name:--font-zh)"
                    >
                      {{ itemNames(item).zh }}
                    </p>
                  </div>
                </div>
                <span
                  class="text-sm font-medium text-highlighted shrink-0 ml-2 font-mono tabular-nums"
                  >{{ formatPrice(item.totalPrice) }}</span
                >
              </div>
            </div>
            <!-- Subtotal / Discount / Delivery fee breakdown -->
            <template v-if="hasBreakdown">
              <div
                class="flex items-center justify-between px-3 py-1.5 border-t border-default text-sm text-muted"
              >
                <span>{{ t('orders.subtotal') }}</span>
                <span class="font-mono tabular-nums">{{ formatPrice(itemsSubtotal) }}</span>
              </div>
              <div
                v-if="toCents(selectedOrder.discountAmount) > 0"
                class="flex items-center justify-between px-3 py-1.5 text-sm text-success"
              >
                <span
                  >{{ t('orders.discount')
                  }}{{ selectedOrder.couponCode ? ` (${selectedOrder.couponCode})` : '' }}</span
                >
                <span class="font-mono tabular-nums"
                  >-{{ formatPrice(selectedOrder.discountAmount) }}</span
                >
              </div>
              <div
                v-if="selectedOrder.deliveryFee && toCents(selectedOrder.deliveryFee) > 0"
                class="flex items-center justify-between px-3 py-1.5 text-sm text-muted"
              >
                <span>{{ t('orders.deliveryFeeLabel') }}</span>
                <span class="font-mono tabular-nums">{{
                  formatPrice(selectedOrder.deliveryFee)
                }}</span>
              </div>
            </template>
            <div
              class="flex items-center justify-between px-3 py-2.5 bg-accented border-t border-default"
            >
              <span class="text-sm font-bold text-highlighted">{{ t('orders.total') }}</span>
              <span class="text-xl font-bold text-highlighted font-mono tabular-nums">{{
                formatPrice(selectedOrder.totalPrice)
              }}</span>
            </div>
          </div>

          <!-- 5. Customer & Delivery Info + Payment -->
          <div class="space-y-1.5 text-sm">
            <a
              v-if="selectedOrder.customer?.phoneNumber"
              :href="`tel:${selectedOrder.customer.phoneNumber}`"
              class="flex items-center gap-2 text-muted hover:text-highlighted transition-colors"
            >
              <UIcon name="i-lucide-phone" class="size-4 shrink-0" />
              <span class="underline underline-offset-2 font-mono tabular-nums">{{
                selectedOrder.customer.phoneNumber
              }}</span>
            </a>
            <div
              v-if="selectedOrder.type === 'DELIVERY' && selectedOrder.displayAddress"
              class="flex items-center gap-2"
            >
              <a
                :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedOrder.displayAddress)}`"
                target="_blank"
                class="flex items-center gap-2 text-muted hover:text-highlighted transition-colors"
              >
                <UIcon name="i-lucide-map-pin" class="size-4 shrink-0" />
                <span class="underline underline-offset-2">{{ selectedOrder.displayAddress }}</span>
              </a>
              <UBadge
                v-if="selectedOrder.isManualAddress && selectedOrder.status === 'PENDING'"
                color="warning"
                variant="solid"
                size="xs"
                :class="chipClass"
              >
                {{ t('orders.manualAddress') }}
              </UBadge>
            </div>
            <div class="flex items-center gap-2 text-muted">
              <UIcon
                :name="selectedOrder.isOnlinePayment ? 'i-lucide-credit-card' : 'i-lucide-banknote'"
                class="size-4 shrink-0"
              />
              <span>{{
                selectedOrder.isOnlinePayment
                  ? t('orders.paymentMethod.online')
                  : t('orders.paymentMethod.cash')
              }}</span>
              <UBadge
                :color="paymentChip(selectedOrder, true)!.color"
                variant="solid"
                size="xs"
                :class="chipClass"
              >
                {{ paymentChip(selectedOrder, true)!.label }}
              </UBadge>
            </div>
            <div v-if="selectedOrder.orderNote" class="flex items-start gap-2 text-muted">
              <UIcon name="i-lucide-message-square" class="size-4 shrink-0 mt-0.5" />
              <span class="italic">{{ selectedOrder.orderNote }}</span>
            </div>
            <!-- Inline payment action -->
            <UButton
              v-if="selectedOrder.payment?.status?.toLowerCase() !== 'paid'"
              color="success"
              size="sm"
              :loading="isUpdatingPayment"
              class="mt-1"
              @click="markAsPaid"
            >
              <UIcon name="i-lucide-check-circle" class="mr-1" />
              {{ t('orders.payment.markAsPaid') }}
            </UButton>
          </div>

          <!-- 6. Time Management (simplified: buttons only, no slider) -->
          <div class="border border-default rounded-lg p-3 space-y-3">
            <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span class="text-sm text-muted">
                {{ t('orders.preferredTime') }}:
                <span class="font-medium text-highlighted font-mono tabular-nums">
                  {{
                    selectedOrder.preferredReadyTime
                      ? formatTimeOnly(selectedOrder.preferredReadyTime, locale)
                      : t('orders.asap')
                  }}
                </span>
              </span>
              <span v-if="selectedOrder.estimatedReadyTime" class="text-sm text-muted">
                {{ t('orders.currentEstimate') }}:
                <span class="font-bold text-highlighted font-mono tabular-nums">{{
                  formatTimeOnly(selectedOrder.estimatedReadyTime, locale)
                }}</span>
              </span>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <UButton
                v-for="minutes in [15, 30, 45, 60]"
                :key="minutes"
                size="sm"
                class="font-mono tabular-nums"
                :variant="sliderDeltaMinutes === minutes ? 'solid' : 'outline'"
                :color="sliderDeltaMinutes === minutes ? 'secondary' : 'neutral'"
                @click="sliderDeltaMinutes = sliderDeltaMinutes === minutes ? 0 : minutes"
              >
                +{{ minutes }}m
              </UButton>
            </div>

            <div v-if="newEstimatedTime" class="text-sm text-center">
              <span class="text-muted">{{ t('orders.newEstimatedTime') }}: </span>
              <span class="font-bold text-highlighted text-base font-mono tabular-nums">{{
                newEstimatedTime
              }}</span>
            </div>
          </div>

          <!-- 7. Other Actions (collapsible) -->
          <details v-if="secondaryStatuses.length" class="group">
            <summary
              class="text-sm font-medium text-muted cursor-pointer select-none flex items-center gap-1 hover:text-highlighted transition-colors"
            >
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 transition-transform group-open:rotate-90"
              />
              {{ t('orders.otherActions') }}
            </summary>
            <div class="grid grid-cols-2 gap-2 mt-2">
              <UButton
                v-for="status in secondaryStatuses"
                :key="status"
                size="md"
                :variant="status === 'CANCELLED' || stagedStatus !== status ? 'outline' : 'solid'"
                :color="status === 'CANCELLED' || stagedStatus === status ? 'error' : 'neutral'"
                :class="status === 'CANCELLED' ? 'col-span-2' : ''"
                @click="handleStatusButton(status)"
              >
                <UIcon :name="getStatusIcon(status)" class="mr-1" />
                {{ t(`orders.status.${status.toLowerCase()}`) }}
              </UButton>
            </div>
          </details>
        </div>
      </template>

      <template #footer>
        <div class="flex flex-col sm:flex-row gap-2 pb-[env(safe-area-inset-bottom)]">
          <UButton
            color="neutral"
            variant="solid"
            block
            size="lg"
            @click="showOrderDetails = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            v-if="canSave"
            block
            size="lg"
            :color="primaryStatuses.length ? 'neutral' : 'primary'"
            :disabled="isSaving"
            :loading="isSaving"
            @click="updateOrder(stagedStatus)"
          >
            <UIcon name="i-lucide-save" class="mr-2" />
            {{ t('common.save') }}
          </UButton>
        </div>
      </template>
    </USlideover>

    <!-- Confirmation Dialog for Cancellation -->
    <UModal
      v-model:open="showCancelDialog"
      :title="t('orders.confirmCancelTitle')"
      :description="t('orders.confirmCancelMessage')"
      :dismissible="!isCancelling"
      :ui="{ footer: 'flex justify-end gap-2' }"
    >
      <template #body>
        <div class="space-y-3">
          <p v-if="selectedOrder" class="text-sm text-muted">
            {{ formatDate(selectedOrder.createdAt, locale) }} -
            {{ formatOrderSummary(selectedOrder) }}
          </p>
          <p v-if="selectedOrder?.isOnlinePayment" class="text-error">
            {{ t('orders.refundNotice') }}
          </p>
          <p v-if="confirmDisabled" class="text-sm">
            {{ t('orders.waitMessage', { seconds: cancelDelay }) }}
          </p>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="solid"
          :disabled="isCancelling"
          @click="cancelCancellation"
        >
          {{ t('orders.back') }}
        </UButton>
        <UButton
          color="error"
          :disabled="confirmDisabled || isCancelling"
          :loading="isCancelling"
          @click="confirmCancellation"
        >
          {{ t('orders.confirm') }}
        </UButton>
      </template>
    </UModal>

    <!-- Pause confirmation (mobile) -->
    <PiliBottomSheet v-model:open="showPauseConfirm" :title="t('orders.pauseConfirmTitle')">
      <p class="text-[15px] text-muted leading-[1.45]">{{ t('orders.pauseConfirmMessage') }}</p>
      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          class="h-14 rounded-xl bg-accented active:bg-(--pili-pressed) text-base font-bold"
          @click="showPauseConfirm = false"
        >
          {{ t('orders.back') }}
        </button>
        <button
          type="button"
          class="h-14 rounded-xl bg-error text-inverted text-base font-bold disabled:opacity-60"
          :disabled="orderingUpdating"
          @click="applyOrdering(false)"
        >
          {{ t('orders.pauseConfirm') }}
        </button>
      </div>
    </PiliBottomSheet>
  </div>
</template>

<script setup lang="ts">
import type { Order, OrderStatus } from '~/types'
import { useOrderActions } from '~/composables/useOrderActions'
import {
  KANBAN_COLUMN_DEFS,
  MOBILE_TABS,
  ORDER_STATUS_CHIP_TONE,
  cardMeta as buildCardMeta,
  buildKanbanColumns,
  mobileCards as buildMobileCards,
  mobileTabOrders as buildMobileTabOrders,
  paymentChip as buildPaymentChip,
  getTimeSince as buildTimeSince,
  canDropOnColumn,
  oldestLateOrder as findOldestLateOrder,
  staleOrders as findStaleOrders,
  getPaymentIconClass,
  getStatusColor,
  getStatusIcon,
  hoursSince,
  isActiveStatus,
  isLateOrder as isLateAt,
  isUnpaidCash,
  itemNames,
  itemsSubtotalCents,
  nextActionOf,
  hasBreakdown as orderHasBreakdown,
  resolveDrop,
  type KanbanColumnDef,
  type MobileTab,
} from '~/utils/orders'
import { centsToEuros, toCents } from '~/utils/money'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  brusselsDateISO,
  formatDate,
  formatPrice,
  formatTimeOnly,
  shiftBrusselsDate,
} from '~/utils/utils'
import gql from 'graphql-tag'
import { print } from 'graphql'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()

// Pili chip: solid, 5px radius, 12px bold
const chipClass = 'rounded-[5px] font-bold text-xs uppercase'
const toast = useToast()
const ordersStore = useOrdersStore()
const route = useRoute()
const localePath = useLocalePath()
const isMobile = useIsMobile()

// The order details slideover is desktop/tablet only; phones use the /orders/:id page
const slideoverUi = { content: 'min-h-full' }

// Actions shared with the mobile detail page (pages/orders/[id].vue)
const {
  selectedOrder,
  sliderDeltaMinutes,
  stagedStatus,
  isUpdatingPayment,
  quickActionLoading,
  isSaving,
  isCancelling,
  primaryStatuses,
  secondaryStatuses,
  handleStatusButton,
  selectOrder,
  newEstimatedTime,
  canSave,
  quickStatusAdvance,
  quickAdvanceStatus,
  dropOrderStatus,
  updateOrder,
  markAsPaid,
  showCancelDialog,
  cancelDelay,
  confirmDisabled,
  confirmCancellation,
  cancelCancellation,
} = useOrderActions({
  onDone: () => {
    showOrderDetails.value = false
  },
})

const kanbanColumnDefs = KANBAN_COLUMN_DEFS

// Completed-column filter anchored to Europe/Brussels (UTC slicing would list yesterday's orders just past Brussels midnight).
const completedFilterDate = ref<string>(brusselsDateISO())

const completedFilterLabel = computed(() => {
  const date = new Date(`${completedFilterDate.value}T12:00:00Z`)
  if (completedFilterDate.value === brusselsDateISO()) {
    return new Intl.DateTimeFormat(locale.value, {
      weekday: 'short',
      timeZone: 'Europe/Brussels',
    }).format(date)
  }
  return new Intl.DateTimeFormat(locale.value, {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Brussels',
  }).format(date)
})

const isCompletedFilterToday = computed(() => completedFilterDate.value === brusselsDateISO())

const shiftCompletedDate = (days: number) => {
  completedFilterDate.value = shiftBrusselsDate(completedFilterDate.value, days)
}

// Drag state (kanban)
const draggedOrder = ref<Order | null>(null)
const dragOverColumnKey = ref<string | null>(null)

const performDrop = async (order: Order, column: KanbanColumnDef) => {
  const decision = resolveDrop(order, column)
  if (decision.kind === 'ignore') return
  if (decision.kind === 'invalid') {
    toast.add({ title: t('orders.errors.invalidTransition'), color: 'warning' })
    return
  }
  await dropOrderStatus(order, decision.status)
}

// HTML5 Drag & Drop handlers (desktop)
const onDragStart = (e: DragEvent, order: Order) => {
  draggedOrder.value = order
  e.dataTransfer?.setData('text/plain', order.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

const onDragEnd = () => {
  draggedOrder.value = null
  dragOverColumnKey.value = null
}

const onColumnDragOver = (e: DragEvent, column: KanbanColumnDef) => {
  if (!draggedOrder.value || !canDropOnColumn(draggedOrder.value.status, column)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverColumnKey.value = column.key
}

const onColumnDragLeave = () => {
  dragOverColumnKey.value = null
}

const onColumnDrop = (e: DragEvent, column: KanbanColumnDef) => {
  e.preventDefault()
  dragOverColumnKey.value = null
  if (!draggedOrder.value || !canDropOnColumn(draggedOrder.value.status, column)) return

  const order = draggedOrder.value
  draggedOrder.value = null
  performDrop(order, column)
}

// Touch drag handlers (tablet/touch devices)
// Uses a drag handle with touch-action:none so the browser doesn't intercept for scrolling
const touchDragJustEnded = ref(false)

const onDocTouchMove = (e: TouchEvent) => {
  e.preventDefault()
  const [touch] = e.touches
  if (!touch) return

  // Find which column the finger is over
  const el = document.elementFromPoint(touch.clientX, touch.clientY)
  const columnEl = el?.closest('[data-column-key]') as HTMLElement | null
  if (columnEl) {
    const key = columnEl.dataset.columnKey!
    const column = kanbanColumnDefs.find((c) => c.key === key)
    if (column && draggedOrder.value && canDropOnColumn(draggedOrder.value.status, column)) {
      dragOverColumnKey.value = key
    } else {
      dragOverColumnKey.value = null
    }
  } else {
    dragOverColumnKey.value = null
  }
}

const onDocTouchEnd = (e: TouchEvent) => {
  document.removeEventListener('touchmove', onDocTouchMove)
  document.removeEventListener('touchend', onDocTouchEnd)
  document.removeEventListener('touchcancel', onDocTouchEnd)

  if (!draggedOrder.value) return

  // Find drop target
  const [touch] = e.changedTouches
  if (!touch) return
  const el = document.elementFromPoint(touch.clientX, touch.clientY)
  const columnEl = el?.closest('[data-column-key]') as HTMLElement | null

  if (columnEl) {
    const key = columnEl.dataset.columnKey!
    const column = kanbanColumnDefs.find((c) => c.key === key)
    if (column && canDropOnColumn(draggedOrder.value.status, column)) {
      performDrop(draggedOrder.value, column)
    }
  }

  // Clean up
  draggedOrder.value = null
  dragOverColumnKey.value = null

  // Prevent the subsequent click event from opening order details
  touchDragJustEnded.value = true
  setTimeout(() => {
    touchDragJustEnded.value = false
  }, 50)
}

const onCardTouchStart = (_e: TouchEvent, order: Order, column: KanbanColumnDef) => {
  if (!column.dropStatus) return
  draggedOrder.value = order
  navigator.vibrate?.(30)

  // Register document-level listeners (non-passive so we can preventDefault)
  document.addEventListener('touchmove', onDocTouchMove, { passive: false })
  document.addEventListener('touchend', onDocTouchEnd)
  document.addEventListener('touchcancel', onDocTouchEnd)
}

// Order details state
const showOrderDetails = ref(false)

// Time-since tracking (updates every 30s)
const now = ref(new Date())
let nowInterval: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  nowInterval = setInterval(() => {
    now.value = new Date()
  }, 30000)
})

onUnmounted(() => {
  if (nowInterval) clearInterval(nowInterval)
  // Clean up any in-progress touch drag listeners
  document.removeEventListener('touchmove', onDocTouchMove)
  document.removeEventListener('touchend', onDocTouchEnd)
  document.removeEventListener('touchcancel', onDocTouchEnd)
})

const getTimeSince = (createdAt: string) => buildTimeSince(createdAt, now.value, t)

// Discount breakdown helpers
const itemsSubtotal = computed(() => centsToEuros(itemsSubtotalCents(selectedOrder.value)))

const hasBreakdown = computed(() => orderHasBreakdown(selectedOrder.value))

// Stale orders count (for banner)
const staleOrders = computed(() => findStaleOrders(orders.value, now.value))
const staleOrderCount = computed(() => staleOrders.value.length)
const firstStaleOrder = computed(() => staleOrders.value[0] ?? null)

// Payment chip: unpaid cash = amber "to collect", paid online = green.
// `detail` also returns a chip for paid cash and for every other payment state.
const paymentChip = (order: Order, detail = false) => buildPaymentChip(order, t, detail)

// GraphQL Queries and Mutations
const ORDERS_QUERY = gql`
  query {
    orders {
      id
      createdAt
      updatedAt
      status
      type
      isOnlinePayment
      couponCode
      discountAmount
      deliveryFee
      totalPrice
      preferredReadyTime
      estimatedReadyTime
      addressExtra
      orderNote
      orderExtra
      isManualAddress
      displayCustomerName
      displayAddress
      address {
        id
        streetName
        houseNumber
        boxNumber
        municipalityName
        postcode
        distance
      }
      customer {
        id
        firstName
        lastName
        phoneNumber
      }
      payment {
        status
      }
      items {
        unitPrice
        quantity
        totalPrice
        product {
          id
          code
          name
          translations {
            language
            name
          }
          category {
            id
            name
            translations {
              language
              name
            }
          }
        }
        choice {
          id
          name
        }
      }
    }
  }
`

const { data: dataOrders, pending } = await useGqlQuery<{ orders: Order[] }>(
  ORDERS_QUERY,
  {},
  { immediate: true, cache: true },
)

// Populate the Pinia store with orders fetched from the server
if (dataOrders.value?.orders) {
  ordersStore.setOrders(dataOrders.value?.orders)
}

// Use store data for reactive updates and SSR support
const orders = computed(() => ordersStore.orders)

// Kanban columns (tablet+ view)
const kanbanColumns = computed(() => buildKanbanColumns(orders.value, completedFilterDate.value, t))

// Watch for data changes and update store
watch(
  dataOrders,
  (newData) => {
    if (newData?.orders) {
      ordersStore.setOrders(newData.orders)
    }
  },
  { deep: true },
)

// ORDER UPDATED SUBSCRIPTION
const { data: orderUpdated } = useGqlSubscription<{
  orderUpdated: Partial<Order>
}>(
  print(gql`
    subscription {
      orderUpdated {
        id
        status
        updatedAt
        estimatedReadyTime
        payment {
          status
        }
      }
    }
  `),
  {},
)

watch(orderUpdated, (val) => {
  if (val?.orderUpdated) {
    ordersStore.updateOrder(val.orderUpdated)
  }
})

// ORDER CREATED SUBSCRIPTION
const { data: orderCreated } = useGqlSubscription<{
  orderCreated: Order
}>(
  print(gql`
    subscription {
      orderCreated {
        id
        createdAt
        updatedAt
        status
        type
        isOnlinePayment
        couponCode
        discountAmount
        deliveryFee
        totalPrice
        preferredReadyTime
        estimatedReadyTime
        addressExtra
        orderNote
        orderExtra
        isManualAddress
        displayCustomerName
        displayAddress
        address {
          id
          streetName
          houseNumber
          boxNumber
          municipalityName
          postcode
          distance
        }
        customer {
          id
          firstName
          lastName
          phoneNumber
        }
        payment {
          status
        }
        items {
          unitPrice
          quantity
          totalPrice
          product {
            id
            code
            name
            translations {
              language
              name
            }
            category {
              id
              name
              translations {
                language
                name
              }
            }
          }
          choice {
            id
            name
          }
        }
      }
    }
  `),
  {},
)

watch(orderCreated, (val) => {
  if (val?.orderCreated) {
    ordersStore.addOrder(val.orderCreated)
    notificationSound()
  }
})

// Component methods
const openOrderDetails = (order: Order) => {
  // Skip if a touch drag just ended (prevent accidental opening)
  if (touchDragJustEnded.value) return
  if (isMobile.value) {
    ordersStore.acknowledgeOrder(order.id)
    navigateTo(localePath(`/orders/${order.id}`))
    return
  }
  selectOrder(order)
  showOrderDetails.value = true
}

// /orders/:id opened on a wide screen: the detail page redirects here and asks for the slideover
const openRequest = useState<string>('orders-open-request', () => '')
watch(
  [openRequest, orders],
  ([id]) => {
    if (!id || isMobile.value) return
    const order = orders.value.find((o) => o.id === id)
    if (!order) return
    openRequest.value = ''
    openOrderDetails(order)
  },
  { immediate: true },
)

// ===== Mobile list (< md) =====
const mobileTab = ref<MobileTab>('new')

const mobileTabOrders = (key: MobileTab): Order[] =>
  buildMobileTabOrders(orders.value, key, completedFilterDate.value)

const mobileTabOptions = computed(() =>
  MOBILE_TABS.map((tab) => ({
    value: tab.key,
    label: t(`orders.tabs.${tab.key}`),
    count: mobileTabOrders(tab.key).length,
    countTone: tab.key === 'new' ? ('warning' as const) : undefined,
  })),
)

// Oldest first in the active tabs, newest first in "done"
const mobileCards = computed(() =>
  buildMobileCards(orders.value, mobileTab.value, completedFilterDate.value),
)

const ordersInProgress = computed(() => orders.value.filter((o) => isActiveStatus(o.status)).length)
const nowLabel = computed(() => formatTimeOnly(now.value.toISOString(), locale.value))

// Late = active order waiting for more than 2 hours
const isLateOrder = (order: Order): boolean => isLateAt(order, now.value)

const oldestLateOrder = computed(() => findOldestLateOrder(orders.value, now.value))

const cardMeta = (order: Order): string => buildCardMeta(order, t, locale.value)

// Online ordering open / paused
const {
  enabled: orderingEnabled,
  updating: orderingUpdating,
  setEnabled: setOrderingEnabled,
} = useOrderingStatus()
const showPauseConfirm = ref(false)

const applyOrdering = async (value: boolean) => {
  try {
    await setOrderingEnabled(value)
  } catch {
    toast.add({ title: t('orders.errors.orderingUpdateFailed'), color: 'error' })
  }
  showPauseConfirm.value = false
}

// Pausing asks for confirmation, resuming does not
const toggleOrdering = () => {
  if (orderingEnabled.value) {
    showPauseConfirm.value = true
  } else {
    applyOrdering(true)
  }
}

const formatOrderSummary = (order: Order) =>
  order.type === 'DELIVERY' ? t('orders.delivery') : t('orders.pickup')

// Single AudioContext reused across chimes, creating one per call leaks on
// Android WebView, where Chromium caps the number of live contexts per page.
let sharedAudioCtx: AudioContext | null = null

const getAudioCtx = (): AudioContext | null => {
  if (sharedAudioCtx) return sharedAudioCtx
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    sharedAudioCtx = new Ctx()
    return sharedAudioCtx
  } catch {
    return null
  }
}

const notificationSound = () => {
  const audioCtx = getAudioCtx()
  if (!audioCtx) return
  // WebViews suspend the context until a user gesture, resume each time.
  const play = () => {
    const t0 = audioCtx.currentTime
    const frequencies = [523.25, 659.25]
    for (let i = 0; i < frequencies.length; i++) {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.value = frequencies[i]!
      gain.gain.setValueAtTime(0.3, t0 + i * 0.15)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.15 + 0.4)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start(t0 + i * 0.15)
      osc.stop(t0 + i * 0.15 + 0.4)
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx
      .resume()
      .then(play)
      .catch(() => {
        /* Autoplay blocked */
      })
  } else {
    play()
  }
}

// Unlock the AudioContext on the first user interaction so later subscription
// Events can play immediately. Android WebView + Chromium autoplay policy
// Requires a gesture before any audio can be generated.
onMounted(() => {
  const unlock = () => {
    const audioCtx = getAudioCtx()
    if (audioCtx?.state === 'suspended') {
      audioCtx.resume().catch(() => {
        /* Ignore */
      })
    }
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock, { once: false })
  window.addEventListener('keydown', unlock, { once: false })
})

// Keep chiming every few seconds as long as any pending order is still
// Unacknowledged (user hasn't opened it or changed its status).
const PENDING_CHIME_INTERVAL_MS = 8000
let pendingChimeTimer: ReturnType<typeof setInterval> | null = null

watch(
  () => ordersStore.unacknowledgedPendingCount,
  (count, prev) => {
    if (count > 0 && !pendingChimeTimer) {
      pendingChimeTimer = setInterval(notificationSound, PENDING_CHIME_INTERVAL_MS)
    } else if (count === 0 && pendingChimeTimer) {
      clearInterval(pendingChimeTimer)
      pendingChimeTimer = null
    }
    // First unacknowledged pending arriving while loop was dormant: ensure one
    // Immediate tick (notificationSound is already fired by orderCreated watcher
    // For genuinely new orders; this covers the edge case of a refresh leaving
    // An unacknowledged pending order behind).
    if (prev === 0 && count > 0) {
      notificationSound()
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (pendingChimeTimer) {
    clearInterval(pendingChimeTimer)
    pendingChimeTimer = null
  }
})
</script>
