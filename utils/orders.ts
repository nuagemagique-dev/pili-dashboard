import type { Translate } from '~/utils/translate'
import type { Order, OrderStatus, OrderType } from '~/types'
import { brusselsDateISO, formatTimeOnly } from '~/utils/utils'
import { toCents } from '~/utils/money'
import { hasText, isRecord } from '~/utils/guards'

/*
 * Pure order logic of the orders board (pages/orders.vue) and the mobile order page: allowed status moves, elapsed
 * time and lateness, payment chips, the discount breakdown, the kanban columns / mobile tabs and the drag & drop rules.
 * Nothing here reads the clock or the i18n instance: the caller passes `now` and `t`.
 */

export type UiColor = 'success' | 'error' | 'primary' | 'secondary' | 'info' | 'warning' | 'neutral'

// ─── Status machine ─────────────────────────────────────────────────────────────

// Define allowed transitions based on current status and delivery option
export const getAllowedStatuses = (
  current: OrderStatus,
  deliveryOption: OrderType,
): OrderStatus[] => {
  let allowed: OrderStatus[] = []
  switch (current) {
    case 'PENDING':
      allowed = ['CONFIRMED', 'PREPARING']
      break
    case 'CONFIRMED':
      allowed = ['PREPARING']
      break
    case 'PREPARING':
      allowed = ['AWAITING_PICK_UP']
      break
    case 'AWAITING_PICK_UP':
      if (deliveryOption === 'DELIVERY') {
        allowed = ['OUT_FOR_DELIVERY']
      } else if (deliveryOption === 'PICKUP') {
        allowed = ['PICKED_UP', 'FAILED']
      }
      break
    case 'OUT_FOR_DELIVERY':
      allowed = ['DELIVERED', 'FAILED']
      break
    case 'DELIVERED':
    case 'PICKED_UP':
    case 'FAILED':
    case 'CANCELLED':
      allowed = []
      break
  }
  if (current !== 'CANCELLED') {
    allowed.push('CANCELLED')
  }
  return allowed
}

// Chip tone per order status (Pili: PENDING amber, CONFIRMED cyan, PREPARING neutral, ready/done green, cancelled red)
export const ORDER_STATUS_CHIP_TONE: Record<
  string,
  'warning' | 'danger' | 'success' | 'info' | 'neutral'
> = {
  PENDING: 'warning',
  CONFIRMED: 'info',
  PREPARING: 'neutral',
  AWAITING_PICK_UP: 'success',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  PICKED_UP: 'success',
  CANCELLED: 'danger',
  FAILED: 'danger',
}

export const isActiveStatus = (status: OrderStatus): boolean =>
  ['PENDING', 'CONFIRMED', 'PREPARING'].includes(status)

/** The status the one-tap "next" button moves an order to (the first allowed one that is not cancel / failed). */
export const nextActionOf = (order: Order): OrderStatus | undefined =>
  getAllowedStatuses(order.status, order.type).find((s) => s !== 'CANCELLED' && s !== 'FAILED')

export const getStatusIcon = (status: OrderStatus): string => {
  const statusIcons: Record<string, string> = {
    PENDING: 'i-lucide-clock',
    CONFIRMED: 'i-lucide-circle-check',
    PREPARING: 'i-lucide-chef-hat',
    AWAITING_PICK_UP: 'i-lucide-hourglass',
    OUT_FOR_DELIVERY: 'i-lucide-bike',
    DELIVERED: 'i-lucide-package-check',
    PICKED_UP: 'i-lucide-circle-check-big',
    FAILED: 'i-lucide-circle-alert',
    CANCELLED: 'i-lucide-circle-x',
  }
  return statusIcons[status] ?? 'i-lucide-circle-help'
}

export const getStatusColor = (status: OrderStatus): UiColor => {
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

// ─── Elapsed time and lateness ──────────────────────────────────────────────────

const MINUTE_MS = 60_000
/** An active order waiting longer than this is "late" (banner, red border, late chip). */
export const LATE_AFTER_MS = 2 * 60 * MINUTE_MS
/** Minutes after which the elapsed time turns amber, then red. */
export const WARNING_AFTER_MIN = 5
export const ERROR_AFTER_MIN = 15
/** Minutes after which an order counts as stale in the time-since badge (24 h). */
export const STALE_AFTER_MIN = 1440

/**
 * Elapsed time since `createdAt`: label ("il y a 12 min" / "il y a 3h"), colour class (green < 5 min, amber < 15 min,
 * red beyond) and whether the order is stale (24 h). A creation date in the future counts as 0 minutes.
 */
export const getTimeSince = (
  createdAt: string,
  now: Date | number,
  t: Translate,
): { text: string; color: string; isStale: boolean } => {
  const diffMs = (typeof now === 'number' ? now : now.getTime()) - new Date(createdAt).getTime()
  const diffMin = Math.max(0, Math.floor(diffMs / MINUTE_MS))

  const text =
    diffMin < 60
      ? t('orders.timeSince.minutes', { count: diffMin })
      : t('orders.timeSince.hours', { count: Math.floor(diffMin / 60) })

  let color: string
  if (diffMin < WARNING_AFTER_MIN) {
    color = 'text-success'
  } else if (diffMin < ERROR_AFTER_MIN) {
    color = 'text-warning'
  } else {
    color = 'text-error'
  }

  return { text, color, isStale: diffMin >= STALE_AFTER_MIN }
}

/** Late = active order waiting for more than 2 hours. */
export const isLateOrder = (order: Order, now: Date | number): boolean =>
  isActiveStatus(order.status) &&
  (typeof now === 'number' ? now : now.getTime()) - new Date(order.createdAt).getTime() >
    LATE_AFTER_MS

/** The late orders of the list, in list order. */
export const staleOrders = (orders: Order[], now: Date | number): Order[] =>
  orders.filter((order) => isLateOrder(order, now))

/** The late order that has waited longest (null when none is late). */
export const oldestLateOrder = (orders: Order[], now: Date | number): Order | null =>
  [...staleOrders(orders, now)].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )[0] ?? null

/** Whole hours an order has waited (for the "late since N hours" alert). */
export const hoursSince = (createdAt: string, now: Date | number): number =>
  Math.floor(
    ((typeof now === 'number' ? now : now.getTime()) - new Date(createdAt).getTime()) / 3_600_000,
  )

// ─── Payment ────────────────────────────────────────────────────────────────────

const paymentStatusOf = (order: Order): string | undefined => order.payment?.status?.toLowerCase()

/** Unpaid cash order still to collect (a cancelled one is not). */
export const isUnpaidCash = (order: Order): boolean =>
  !order.isOnlinePayment && paymentStatusOf(order) !== 'paid' && order.status !== 'CANCELLED'

/** Colour class of the payment icon: red when the payment failed, amber for cash not yet collected. */
export const getPaymentIconClass = (order: Order): string => {
  if (paymentStatusOf(order) === 'failed') return 'text-error'
  if (!order.isOnlinePayment && paymentStatusOf(order) !== 'paid') return 'text-warning'
  return ''
}

export const getPaymentStatusColor = (status: string | undefined): UiColor => {
  if (!hasText(status)) return 'error'
  const colors: Record<string, UiColor> = {
    open: 'warning',
    cancelled: 'neutral',
    canceled: 'neutral',
    pending: 'neutral',
    expired: 'neutral',
    failed: 'error',
    paid: 'success',
  }
  return colors[status.toLowerCase()] ?? 'neutral'
}

/**
 * Payment chip: unpaid cash = amber "to collect", paid online = green.
 * `detail` also returns a chip for paid cash and for every other payment state.
 */
export const paymentChip = (
  order: Order,
  t: Translate,
  detail = false,
): { color: UiColor; label: string } | null => {
  const status = paymentStatusOf(order)
  if (status === 'paid') {
    return detail || order.isOnlinePayment
      ? { color: 'success', label: t('orders.payment.status.paid') }
      : null
  }
  if (!order.isOnlinePayment && (!hasText(status) || status === 'open' || status === 'pending')) {
    return { color: 'warning', label: t('orders.toCollect') }
  }
  return {
    color: getPaymentStatusColor(order.payment?.status),
    label: t(`orders.payment.status.${status ?? 'notPaid'}`),
  }
}

// ─── Items and amounts ──────────────────────────────────────────────────────────

/** Item names: French first, Chinese translation below when it exists and differs. */
export const itemNames = (item: Order['items'][number]): { main: string; zh: string } => {
  const translations = item.product.translations ?? []
  const frName = translations.find((tr) => tr.language === 'fr')?.name
  const main = hasText(frName) ? frName : item.product.name
  const zh = translations.find((tr) => tr.language === 'zh')?.name
  return { main, zh: hasText(zh) && zh !== main ? zh : '' }
}

/** Sum of the line totals, in integer cents. */
export const itemsSubtotalCents = (order: Pick<Order, 'items'> | null | undefined): number =>
  (order?.items ?? []).reduce((sum, item) => sum + toCents(item.totalPrice), 0)

/** Whether the order has a discount or a delivery fee to show between the items and the total. */
export const hasBreakdown = (
  order: Pick<Order, 'discountAmount' | 'deliveryFee'> | null | undefined,
): boolean => {
  if (!order) return false
  return toCents(order.discountAmount) > 0 || toCents(order.deliveryFee) > 0
}

// ─── Mobile card ────────────────────────────────────────────────────────────────

/** Second line of a mobile order card: "3 articles · prête vers 19:30 · Rue Saint-Gilles 12". */
export const cardMeta = (order: Order, t: Translate, locale: string): string => {
  const readyAt = hasText(order.estimatedReadyTime)
    ? t('orders.readyAround', { time: formatTimeOnly(order.estimatedReadyTime, locale) })
    : hasText(order.preferredReadyTime)
      ? t('orders.wantedAt', { time: formatTimeOnly(order.preferredReadyTime, locale) })
      : ''
  const street =
    order.type === 'DELIVERY'
      ? order.address
        ? `${order.address.streetName} ${order.address.houseNumber}`.trim()
        : (order.displayAddress ?? '').replace(/,[\s\S]*$/u, '')
      : ''
  return [t('orders.articles', { count: order.items.length }, order.items.length), readyAt, street]
    .filter(Boolean)
    .join(' · ')
}

// ─── Kanban board and mobile tabs ───────────────────────────────────────────────

export interface KanbanColumnDef {
  key: string
  statuses: OrderStatus[]
  dropStatus: OrderStatus | null
  icon: string
}

export const KANBAN_COLUMN_DEFS: KanbanColumnDef[] = [
  { key: 'NEW', statuses: ['PENDING', 'CONFIRMED'], dropStatus: null, icon: 'i-lucide-inbox' },
  { key: 'PREPARING', statuses: ['PREPARING'], dropStatus: 'PREPARING', icon: 'i-lucide-chef-hat' },
  {
    key: 'AWAITING_PICK_UP',
    statuses: ['AWAITING_PICK_UP'],
    dropStatus: 'AWAITING_PICK_UP',
    icon: 'i-lucide-hourglass',
  },
  {
    key: 'OUT_FOR_DELIVERY',
    statuses: ['OUT_FOR_DELIVERY'],
    dropStatus: 'OUT_FOR_DELIVERY',
    icon: 'i-lucide-bike',
  },
  {
    key: 'COMPLETED',
    statuses: ['DELIVERED', 'PICKED_UP', 'CANCELLED'],
    dropStatus: 'DELIVERED',
    icon: 'i-lucide-circle-check-big',
  },
]

/** Orders of the "completed" views last updated on the given Brussels calendar day. */
const updatedOnDay = (orders: Order[], day: string): Order[] =>
  orders.filter((o) => hasText(o.updatedAt) && brusselsDateISO(new Date(o.updatedAt)) === day)

/**
 * The kanban columns with their label and orders. The completed column only lists the orders updated on
 * `completedDate` (a Europe/Brussels YYYY-MM-DD).
 */
export const buildKanbanColumns = (orders: Order[], completedDate: string, t: Translate) =>
  KANBAN_COLUMN_DEFS.map((def) => {
    let filtered = orders.filter((o) => def.statuses.includes(o.status))
    if (def.key === 'COMPLETED') {
      filtered = updatedOnDay(filtered, completedDate)
    }
    return {
      ...def,
      label:
        def.key === 'COMPLETED'
          ? t('orders.statusShort.completed')
          : def.key === 'NEW'
            ? t('orders.statusShort.new')
            : t(`orders.status.${def.key.toLowerCase()}`),
      orders: filtered,
    }
  })

/** Whether an order of this status can be dropped on the column: the column accepts drops and is not where it already is. */
export const canDropOnColumn = (status: OrderStatus, column: KanbanColumnDef): boolean =>
  Boolean(column.dropStatus) && !column.statuses.includes(status)

export type DropDecision =
  | { kind: 'ignore' }
  | { kind: 'invalid' }
  | { kind: 'move'; status: OrderStatus }

/**
 * What dropping an order on a column does: nothing (the column takes no drops, or the order is already in it), a
 * refusal (the status machine does not allow that move) or the move to the target status. The completed column
 * resolves the terminal status from the order type (pickup -> PICKED_UP, delivery -> DELIVERED).
 */
export const resolveDrop = (order: Order, column: KanbanColumnDef): DropDecision => {
  if (!column.dropStatus || column.statuses.includes(order.status)) return { kind: 'ignore' }

  let targetStatus = column.dropStatus
  if (column.key === 'COMPLETED') {
    targetStatus = order.type === 'PICKUP' ? 'PICKED_UP' : 'DELIVERED'
  }

  if (!getAllowedStatuses(order.status, order.type).includes(targetStatus)) {
    return { kind: 'invalid' }
  }
  return { kind: 'move', status: targetStatus }
}

export type MobileTab = 'new' | 'kitchen' | 'out' | 'done'

export const MOBILE_TABS: { key: MobileTab; statuses: OrderStatus[] }[] = [
  { key: 'new', statuses: ['PENDING', 'CONFIRMED'] },
  { key: 'kitchen', statuses: ['PREPARING'] },
  { key: 'out', statuses: ['AWAITING_PICK_UP', 'OUT_FOR_DELIVERY'] },
  { key: 'done', statuses: ['DELIVERED', 'PICKED_UP', 'CANCELLED'] },
]

/** The orders of a mobile tab; "done" only lists the orders updated on `completedDate` (Brussels YYYY-MM-DD). */
export const mobileTabOrders = (
  orders: Order[],
  key: MobileTab,
  completedDate: string,
): Order[] => {
  const tab = MOBILE_TABS.find((x) => x.key === key)!
  const list = orders.filter((o) => tab.statuses.includes(o.status))
  return key === 'done' ? updatedOnDay(list, completedDate) : list
}

/** Cards of a mobile tab: oldest first in the active tabs, newest first in "done". */
export const mobileCards = (orders: Order[], key: MobileTab, completedDate: string): Order[] => {
  const byDate = (o: Order) => new Date(o.createdAt).getTime()
  return [...mobileTabOrders(orders, key, completedDate)].sort((a, b) =>
    key === 'done' ? byDate(b) - byDate(a) : byDate(a) - byDate(b),
  )
}

// ─── Why an order update failed ─────────────────────────────────────────────────

/** Backend error codes of `updateOrder` with their own message for the staff (the order is left unchanged by all of them). */
const UPDATE_ORDER_ERROR_KEYS: Record<string, string> = {
  // The payment could not be refunded / cancelled at Mollie: nothing was changed, trying again can work.
  PAYMENT_SETTLEMENT_FAILED: 'orders.errors.paymentSettlementFailed',
  // Mollie cannot refund this payment (voucher, expired refund window...): retrying cannot work, refund by hand.
  PAYMENT_NOT_REFUNDABLE: 'orders.errors.paymentNotRefundable',
}

/** The GraphQL errors of a failed request (`$gqlFetch` throws the raw `errors` array, or an object carrying it). */
export const gqlErrorEntries = (error: unknown): unknown[] => {
  if (Array.isArray(error)) return error
  const errors = isRecord(error) ? error.errors : undefined
  return Array.isArray(errors) ? errors : [error]
}

/** The `extensions.code` of every GraphQL error of a failed request. */
export const gqlErrorCodes = (error: unknown): string[] => {
  const codes: string[] = []
  for (const entry of gqlErrorEntries(error)) {
    const code = isRecord(entry) && isRecord(entry.extensions) ? entry.extensions.code : undefined
    if (typeof code === 'string') codes.push(code)
  }
  return codes
}

/**
 * tsb-service refuses to reopen a cancelled order whose payment was refunded or cancelled with a plain USER_ERROR whose
 * message says "... so it cannot be reopened; create a new order instead" (resolver `refuseReopeningSettledOrder`): it
 * has no code of its own, so the message is the only thing that tells this case from any other USER_ERROR.
 */
const isReopenRefusal = (error: unknown): boolean =>
  gqlErrorEntries(error).some((entry) => {
    if (!isRecord(entry)) return false
    const { message, extensions } = entry
    return (
      isRecord(extensions) &&
      extensions.code === 'USER_ERROR' &&
      typeof message === 'string' &&
      /cannot be reopened/iu.test(message)
    )
  })

/**
 * The i18n key of the message to show when `updateOrder` fails: a specific one for a payment that could not be
 * refunded or cancelled, one for reopening a cancelled order whose payment was settled (only when moving a cancelled
 * order to another status AND the backend's USER_ERROR says it cannot be reopened; the UI offers no such move today,
 * `getAllowedStatuses('CANCELLED')` is empty, so this is defensive), the generic "failed to update" for everything else
 * (network, server, any other USER_ERROR...).
 */
export const updateOrderErrorKey = (
  error: unknown,
  context: { currentStatus?: OrderStatus; targetStatus?: OrderStatus } = {},
): string => {
  const codes = gqlErrorCodes(error)
  for (const code of codes) {
    const key = UPDATE_ORDER_ERROR_KEYS[code]
    if (hasText(key)) return key
  }
  const reopening =
    context.currentStatus === 'CANCELLED' &&
    context.targetStatus !== undefined &&
    context.targetStatus !== 'CANCELLED'
  if (reopening && isReopenRefusal(error)) return 'orders.errors.refundedNotReopenable'
  return 'orders.errors.updateFailed'
}
