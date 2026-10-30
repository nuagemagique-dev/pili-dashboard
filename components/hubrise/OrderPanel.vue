<template>
  <div v-if="info" class="flex flex-col gap-3" data-testid="order-hubrise">
    <!-- A paid order was cancelled at the EPOS: staff cancel it here, which refunds the customer -->
    <div
      v-if="staffMustCancel"
      role="alert"
      class="p-3.5 rounded-xl bg-error text-inverted flex flex-col gap-2.5"
      data-testid="order-hubrise-cancelled-paid"
    >
      <span class="text-base font-bold leading-snug">{{
        t(`${attentionKey('REMOTE_CANCELLED_PAID')}.title`)
      }}</span>
      <span class="text-sm leading-snug">{{
        t(`${attentionKey('REMOTE_CANCELLED_PAID')}.body`)
      }}</span>
      <UButton
        :label="t('orders.hubrise.cancelAndRefund')"
        icon="i-lucide-circle-x"
        color="neutral"
        variant="solid"
        class="self-start"
        :loading="cancelling"
        @click="emit('cancel')"
      />
    </div>

    <div
      v-else-if="card"
      role="status"
      class="p-3.5 rounded-xl border border-error flex flex-col gap-1"
      data-testid="order-hubrise-attention"
      :data-attention="card"
    >
      <span class="font-mono text-[11px] font-bold tracking-[0.06em] text-error uppercase">{{
        t('orders.hubrise.needsAttention')
      }}</span>
      <span class="text-sm font-bold leading-snug">{{ t(`${attentionKey(card)}.title`) }}</span>
      <span class="text-sm text-muted leading-snug">{{ t(`${attentionKey(card)}.body`) }}</span>
    </div>

    <div class="p-3.5 rounded-xl bg-elevated border border-default flex flex-col gap-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-sm font-bold">{{ t('orders.hubrise.title') }}</span>
        <HubriseOrderBadges :info="info" />
      </div>
      <dl
        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
        data-testid="order-hubrise-details"
      >
        <dt class="text-muted">{{ t('orders.hubrise.orderId') }}</dt>
        <dd class="font-mono text-xs break-all">{{ info.hubriseOrderId ?? '-' }}</dd>
        <dt class="text-muted">{{ t('orders.hubrise.pushedAt') }}</dt>
        <dd>{{ info.pushedAt ? formatInstant(info.pushedAt, locale) : '-' }}</dd>
        <dt class="text-muted">{{ t('orders.hubrise.remoteStatus') }}</dt>
        <dd>{{ info.remoteStatus ?? '-' }}</dd>
        <dt class="text-muted">{{ t('orders.hubrise.remoteTotal') }}</dt>
        <dd class="font-mono tabular-nums">
          {{ info.remoteTotal ? formatPrice(info.remoteTotal) : '-' }}
        </dd>
      </dl>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import HubriseOrderBadges from '~/components/hubrise/OrderBadges.vue'
import type { Order } from '~/types'
import { attentionCard, attentionKey, formatInstant, needsStaffCancel } from '~/utils/hubrise'
import { formatPrice } from '~/utils/utils'

const { order, cancelling = false } = defineProps<{
  order: Order
  /** The cancellation the button started is running. */
  cancelling?: boolean
}>()

const emit = defineEmits<{ cancel: [] }>()

const { t, locale } = useI18n()

const info = computed(() => order.hubrise ?? null)
const staffMustCancel = computed(() => needsStaffCancel(order.hubrise, order.status))
const card = computed(() => attentionCard(order.hubrise))
</script>
