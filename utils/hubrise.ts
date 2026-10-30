import { isRecord } from '~/utils/guards'
import { gqlErrorEntries } from '~/utils/orders'

/*
 * HubRise integration: the GraphQL shapes (docs/hubrise/PUBLISH_CONTRACT.graphql in tsb-service) and the pure logic of the
 * HubRise page, the layout banner, the product dialog and the order screens. Nothing here reads the clock or the i18n
 * instance: the callers pass `now` and translate the keys that come back.
 */

// ─── GraphQL shapes ─────────────────────────────────────────────────────────────

export type HubriseCatalogDirection = 'NONE' | 'IMPORT' | 'PUBLISH'

export type HubrisePublishErrorCode =
  | 'WRITE_SCOPE_MISSING'
  | 'ACCOUNT_CATALOG'
  | 'CATALOG_NOT_FOUND'
  | 'REJECTED'
  | 'INVALID_MENU'
  | 'UNAVAILABLE'
  | 'AUTH'
  | 'REMOVALS_NEED_CONFIRM'

export type HubrisePublishAction = 'ADD' | 'UPDATE' | 'REMOVE'
export type HubrisePublishState = 'PUBLISHED' | 'PENDING' | 'NOT_PUBLISHED'
export type HubriseCatalogEntity = 'CATEGORY' | 'PRODUCT' | 'CHOICE_GROUP' | 'CHOICE'
export type HubriseSyncMode = 'DRY_RUN' | 'LINK_ONLY' | 'FULL'
export type HubriseCatalogAction = 'CREATE' | 'UPDATE' | 'LINK' | 'RETIRE' | 'REVIVE'
export type HubriseOutboxState = 'PENDING' | 'SENDING' | 'SENT' | 'PARKED' | 'SKIPPED'
export type HubriseOutboxKind =
  | 'ORDER_CREATE'
  | 'ORDER_STATUS'
  | 'INVENTORY'
  | 'CUSTOMER'
  | 'CUSTOMER_ANONYMISE'

export interface HubriseFeatures {
  pushOrders: boolean
  syncStatus: boolean
  syncInventory: boolean
  syncCatalog: boolean
  publishCatalog: boolean
}

export interface HubriseBacklog {
  pending: number
  parked: number
}

export interface HubrisePublishStatus {
  enabled: boolean
  active: boolean
  pending: boolean
  pendingSince: string | null
  nextPublishAt: string | null
  publishing: boolean
  lastPublishedAt: string | null
  firstPublishConfirmedAt: string | null
  awaitingFirstPublish: boolean
  lastError: string | null
  lastErrorCode: HubrisePublishErrorCode | null
  lastErrorAt: string | null
  externalChangeAt: string | null
  needsReconnectForWrite: boolean
  accountCatalogDetected: boolean
  publishImages: boolean
  publishedProducts: number
  pendingProducts: number
}

export interface HubriseStatus {
  available: boolean
  connected: boolean
  enabled: boolean
  accountId: string | null
  accountName: string | null
  locationId: string | null
  locationName: string | null
  catalogId: string | null
  catalogName: string | null
  customerListId: string | null
  customerListName: string | null
  features: HubriseFeatures
  syncCustomers: boolean
  catalogAutoImport: boolean
  catalogUpdateAvailable: boolean
  catalogPendingReview: boolean
  autoRefundOnCancel: boolean
  catalogLanguage: string
  variantRef: string | null
  channelName: string | null
  deliveryChargeRef: string | null
  paymentFeeChargeRef: string | null
  platformPrices: HubrisePlatformPrice[]
  importImages: boolean
  lastCatalogSyncAt: string | null
  lastEventAt: string | null
  authErrorAt: string | null
  lastError: string | null
  relinkRequired: boolean
  backlog: HubriseBacklog
  unlinkedProducts: number
  attention: number
  catalogDirection: HubriseCatalogDirection
  publish: HubrisePublishStatus
}

export interface HubriseOutboxItem {
  id: string
  kind: HubriseOutboxKind
  orderId: string | null
  state: HubriseOutboxState
  attempts: number
  lastError: string | null
  nextAttemptAt: string
  createdAt: string
  sentAt: string | null
  parkedAt: string | null
}

export interface HubriseSettingsInput {
  enabled?: boolean
  pushOrders?: boolean
  syncStatus?: boolean
  syncInventory?: boolean
  syncCatalog?: boolean
  syncCustomers?: boolean
  catalogAutoImport?: boolean
  autoRefundOnCancel?: boolean
  importImages?: boolean
  publishImages?: boolean
  catalogLanguage?: string
  variantRef?: string
  channelName?: string
  deliveryChargeRef?: string
  paymentFeeChargeRef?: string
  platformPrices?: HubrisePlatformPrice[]
}

/** A delivery platform's price list: a HubRise variant with the published prices plus a markup. */
export interface HubrisePlatformPrice {
  variantRef: string
  name: string
  markupPercent: number
  /** The marked up price is rounded up to a multiple of this many cents. */
  roundToCents: number
}

export const newPlatformPrice = (): HubrisePlatformPrice => ({
  variantRef: '',
  name: '',
  markupPercent: 0,
  roundToCents: 10,
})

/** The rows as the API takes them: only what it knows, the texts trimmed. */
export const cleanPlatformPrices = (
  rows: readonly HubrisePlatformPrice[],
): HubrisePlatformPrice[] =>
  rows.map((row) => ({
    variantRef: row.variantRef.trim(),
    name: row.name.trim(),
    markupPercent: row.markupPercent,
    roundToCents: row.roundToCents,
  }))

export const platformPricesChanged = (
  stored: readonly HubrisePlatformPrice[],
  rows: readonly HubrisePlatformPrice[],
): boolean =>
  JSON.stringify(cleanPlatformPrices(stored)) !== JSON.stringify(cleanPlatformPrices(rows))

export interface HubriseCatalogChange {
  entity: HubriseCatalogEntity
  action: HubriseCatalogAction
  key: string
  name: string
  fields: string[]
}

export interface HubriseCatalogIssue {
  code: string
  key: string | null
  message: string
}

export interface HubriseCatalogDiff {
  catalogHash: string
  changes: HubriseCatalogChange[]
  warnings: HubriseCatalogIssue[]
  conflicts: HubriseCatalogIssue[]
  unchanged: number
  retiringProducts: number
  linkedProducts: number
  retireNeedsConfirm: boolean
}

export interface HubriseSyncResult {
  mode: HubriseSyncMode
  applied: boolean
  pendingReview: boolean
  diff: HubriseCatalogDiff
  failedBatches: string[]
}

export interface HubrisePublishCount {
  entity: HubriseCatalogEntity
  added: number
  updated: number
  removed: number
}

export interface HubrisePublishChange {
  entity: HubriseCatalogEntity
  action: HubrisePublishAction
  key: string
  ref: string
  name: string
  fields: string[]
}

export interface HubrisePublishForeignItem {
  entity: HubriseCatalogEntity
  ref: string
  name: string
}

export interface HubrisePublishPreview {
  planHash: string
  firstPublish: boolean
  added: number
  updated: number
  removed: number
  unchanged: number
  foreign: number
  counts: HubrisePublishCount[]
  changes: HubrisePublishChange[]
  truncated: boolean
  foreignItems: HubrisePublishForeignItem[]
  preserved: string[]
  warnings: HubriseCatalogIssue[]
  blockers: HubriseCatalogIssue[]
  removalsNeedConfirm: boolean
  generatedAt: string
}

export interface HubrisePublishResult {
  published: boolean
  queued: boolean
  status: HubrisePublishStatus
}

export interface HubriseProductPublishInfo {
  state: HubrisePublishState
  publishedAt: string | null
  ref: string | null
}

export interface HubriseOrderInfo {
  hubriseOrderId: string | null
  pushState: string
  pushedAt: string | null
  remoteStatus: string | null
  remoteTotal: string | null
  needsAttention: string | null
}

/** The HubRise fields a product query asks for (only when the integration is available). */
export interface HubriseProductFields {
  hubriseManaged?: boolean
  hubriseLockedFields?: string[]
  hubrisePublish?: HubriseProductPublishInfo | null
}

/**
 * The selection of the HubRise fields of a product. Asked only when the server has HubRise (`available`): a server
 * without it, or an older one, does not know the fields and would refuse the whole query.
 */
export const HUBRISE_PRODUCT_FIELDS = `
  hubriseManaged
  hubriseLockedFields
  hubrisePublish {
    state
    publishedAt
    ref
  }
`

/**
 * A product document for this server. Documents are written with the HubRise fields, so the contract
 * check validates them; a server without HubRise does not know them and would refuse the whole query.
 */
export const productDocument = (document: string, status: HubriseStatus | null): string =>
  status?.available === true ? document : document.replaceAll(HUBRISE_PRODUCT_FIELDS, '')

/** The selection of the HubRise state of an order, asked only where the server has HubRise. */
export const HUBRISE_ORDER_FIELDS = `
  hubrise {
    hubriseOrderId
    pushState
    pushedAt
    remoteStatus
    remoteTotal
    needsAttention
  }
`

/** An order document for this server, see productDocument. */
export const orderDocument = (document: string, status: HubriseStatus | null): string =>
  status?.available === true ? document : document.replaceAll(HUBRISE_ORDER_FIELDS, '')

// ─── Error codes ────────────────────────────────────────────────────────────────

/** Every `extensions.code` the HubRise operations answer with. */
export const HUBRISE_ERROR_CODES = [
  'HUBRISE_NOT_CONFIGURED',
  'HUBRISE_NOT_CONNECTED',
  'HUBRISE_NOT_ENABLED',
  'HUBRISE_RELINK_REQUIRED',
  'HUBRISE_PREVIEW_REQUIRED',
  'HUBRISE_RETIRE_CONFIRM_REQUIRED',
  'HUBRISE_EMPTY_CATALOG',
  'HUBRISE_BUSY',
  'HUBRISE_SKU_LINKED',
  'HUBRISE_MANAGED',
  'HUBRISE_UPSTREAM',
  'HUBRISE_PUBLISH_MODE',
  'HUBRISE_DIRECTION_CONFLICT',
  'HUBRISE_RECONNECT_REQUIRED',
  'HUBRISE_ACCOUNT_CATALOG',
  'HUBRISE_NOT_PUBLISH_MODE',
  'HUBRISE_PREVIEW_STALE',
  'HUBRISE_PUBLISH_CONFIRM_REQUIRED',
  'HUBRISE_PUBLISH_BLOCKED',
  'HUBRISE_PUBLISH_PENDING_CHANGES',
  'HUBRISE_RATE_LIMITED',
  'HUBRISE_EMPTY_MENU',
] as const

export type HubriseErrorCode = (typeof HUBRISE_ERROR_CODES)[number]

export const HUBRISE_PUBLISH_ERROR_CODES: readonly HubrisePublishErrorCode[] = [
  'WRITE_SCOPE_MISSING',
  'ACCOUNT_CATALOG',
  'CATALOG_NOT_FOUND',
  'REJECTED',
  'INVALID_MENU',
  'UNAVAILABLE',
  'AUTH',
  'REMOVALS_NEED_CONFIRM',
]

/** `HUBRISE_PREVIEW_STALE` -> `previewStale`, `WRITE_SCOPE_MISSING` -> `writeScopeMissing`. */
const lowerCamel = (code: string, prefix = ''): string =>
  code
    .slice(prefix.length)
    .toLowerCase()
    .split('_')
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('')

/** Seconds to wait when HubRise rate limits a call and does not say for how long. */
export const DEFAULT_RETRY_SECONDS = 60

const isKnownErrorCode = (code: string): code is HubriseErrorCode =>
  (HUBRISE_ERROR_CODES as readonly string[]).includes(code)

/** The i18n key of the message of a HubRise error code; unknown codes get the generic message. */
export const hubriseErrorKey = (code: string | null): string =>
  code !== null && isKnownErrorCode(code)
    ? `hubrise.errors.${lowerCamel(code, 'HUBRISE_')}`
    : 'hubrise.errors.generic'

/** The i18n key of the message of a publish error code (HubrisePublishStatus.lastErrorCode). */
export const publishErrorKey = (code: HubrisePublishErrorCode): string =>
  `hubrise.publish.errors.${lowerCamel(code)}`

export interface HubriseErrorInfo {
  /** The HubRise code, or null when the failure is not one of ours (network, forbidden...). */
  code: HubriseErrorCode | null
  key: string
  params: Record<string, string | number>
  /** Set for HUBRISE_RATE_LIMITED: how long to wait before asking again. */
  retryAfterSeconds: number | null
}

/** Reads a failed HubRise operation: the first error carrying one of our codes, its message key and parameters. */
export const hubriseError = (error: unknown): HubriseErrorInfo => {
  for (const entry of gqlErrorEntries(error)) {
    const extensions = isRecord(entry) && isRecord(entry.extensions) ? entry.extensions : null
    const code = extensions?.code
    if (extensions === null || typeof code !== 'string' || !isKnownErrorCode(code)) continue
    const retry = extensions.retryAfterSeconds
    const retryAfterSeconds =
      code === 'HUBRISE_RATE_LIMITED'
        ? typeof retry === 'number' && retry > 0
          ? Math.ceil(retry)
          : DEFAULT_RETRY_SECONDS
        : null
    const params: Record<string, string | number> = {}
    if (retryAfterSeconds !== null) params.seconds = retryAfterSeconds
    if (code === 'HUBRISE_UPSTREAM') {
      const { status } = extensions
      params.status = typeof status === 'number' || typeof status === 'string' ? status : ''
    }
    return { code, key: hubriseErrorKey(code), params, retryAfterSeconds }
  }
  return { code: null, key: hubriseErrorKey(null), params: {}, retryAfterSeconds: null }
}

// ─── Banners ────────────────────────────────────────────────────────────────────

export type HubriseBannerId =
  | 'authError'
  | 'relinkRequired'
  | 'reconnectForWrite'
  | 'accountCatalog'
  | 'pendingReview'
  | 'externalChange'
  | 'publishError'
  | 'removalsConfirm'
  | 'updateAvailable'

export type HubriseBannerAction =
  | 'reconnect'
  | 'forgetLinks'
  | 'reviewImport'
  | 'acknowledge'
  | 'preview'
  | 'import'

export interface HubriseBanner {
  id: HubriseBannerId
  tone: 'error' | 'warning' | 'info'
  key: string
  params: Record<string, string>
  action: HubriseBannerAction | null
}

/** Publish errors another banner already tells (same cause, same remedy). */
const COVERED_PUBLISH_ERRORS: readonly HubrisePublishErrorCode[] = [
  'WRITE_SCOPE_MISSING',
  'ACCOUNT_CATALOG',
  'AUTH',
  'REMOVALS_NEED_CONFIRM',
]

/**
 * The banners of the HubRise page, most urgent first: the token is refused, the links belong to another catalog, the
 * connection cannot write, the catalog is not ours to write, an import waits for a person, HubRise was edited
 * elsewhere, the last publish failed, a publish needs a typed confirmation, an import is available. Nothing is shown
 * until a HubRise location is connected.
 */
export const statusBanners = (status: HubriseStatus | null): HubriseBanner[] => {
  if (status === null || !status.available || !status.connected) return []
  const { publish } = status
  const publishing = status.catalogDirection === 'PUBLISH'
  const banners: HubriseBanner[] = []
  const add = (
    id: HubriseBannerId,
    tone: HubriseBanner['tone'],
    extra: { key?: string; action?: HubriseBannerAction; params?: Record<string, string> } = {},
  ) =>
    banners.push({
      id,
      tone,
      key: extra.key ?? `hubrise.banners.${id}`,
      params: extra.params ?? {},
      action: extra.action ?? null,
    })

  if (status.authErrorAt !== null) {
    add('authError', 'error', {
      action: 'reconnect',
      params: { since: status.authErrorAt },
    })
  }
  if (status.relinkRequired) add('relinkRequired', 'error', { action: 'forgetLinks' })
  if (publishing && publish.needsReconnectForWrite) {
    add('reconnectForWrite', 'warning', {
      action: 'reconnect',
    })
  }
  if (publishing && publish.accountCatalogDetected) {
    add('accountCatalog', 'warning')
  }
  if (!publishing && status.catalogPendingReview) {
    add('pendingReview', 'warning', { action: 'reviewImport' })
  }
  if (publishing && publish.externalChangeAt !== null) {
    add('externalChange', 'warning', {
      action: 'acknowledge',
      params: { at: publish.externalChangeAt },
    })
  }
  const code = publish.lastErrorCode
  if (publishing && code !== null && !COVERED_PUBLISH_ERRORS.includes(code)) {
    add('publishError', code === 'UNAVAILABLE' ? 'warning' : 'error', {
      key: publishErrorKey(code),
      params: { detail: publish.lastError ?? '' },
    })
  }
  if (publishing && code === 'REMOVALS_NEED_CONFIRM') {
    add('removalsConfirm', 'warning', { action: 'preview' })
  }
  if (!publishing && status.catalogUpdateAvailable) {
    add('updateAvailable', 'info', { action: 'import' })
  }
  return banners
}

/** The banners that belong to the publish panel; the page shows the others. */
export const PUBLISH_BANNER_IDS: readonly HubriseBannerId[] = [
  'reconnectForWrite',
  'accountCatalog',
  'externalChange',
  'publishError',
  'removalsConfirm',
]

export const splitBanners = (
  banners: readonly HubriseBanner[],
): { general: HubriseBanner[]; publish: HubriseBanner[] } => ({
  general: banners.filter((banner) => !PUBLISH_BANNER_IDS.includes(banner.id)),
  publish: banners.filter((banner) => PUBLISH_BANNER_IDS.includes(banner.id)),
})

/** A banner parameter that is an instant is shown in Brussels time, in the language of the screen. */
export const formatInstant = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Brussels',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))

const INSTANT_PARAMS: readonly string[] = ['since', 'at']

/** The parameters of a banner message, its instants formatted. */
export const bannerParams = (banner: HubriseBanner, locale: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(banner.params).map(([name, value]) => [
      name,
      INSTANT_PARAMS.includes(name) ? formatInstant(value, locale) : value,
    ]),
  )

/** What the banner above every page (except the HubRise page itself) warns about. */
export type HubriseLayoutBanner = 'authError' | 'parked'

export const layoutBanner = (
  status: HubriseStatus | null,
  path: string,
): HubriseLayoutBanner | null => {
  if (status === null || !status.available || !status.connected) return null
  if (path.includes('/hubrise')) return null
  if (status.authErrorAt !== null) return 'authError'
  return status.backlog.parked > 0 ? 'parked' : null
}

/** The HubRise entry of the navigation exists only where the server has the integration configured. */
export const hubriseNavVisible = (status: HubriseStatus | null): boolean =>
  status?.available === true

/** The short line of the "More" menu: the direction when connected, nothing otherwise. */
export const hubriseNavHintKey = (status: HubriseStatus | null): string | null => {
  if (status === null || !status.available) return null
  if (!status.connected) return 'hubrise.status.notConnected'
  return status.enabled ? 'hubrise.status.enabled' : 'hubrise.status.paused'
}

// ─── Catalog direction ──────────────────────────────────────────────────────────

export const CATALOG_DIRECTIONS: readonly HubriseCatalogDirection[] = ['NONE', 'IMPORT', 'PUBLISH']

export type DirectionBlock = 'sameDirection' | 'notConnected' | 'reconnectRequired'

export interface DirectionPlan {
  allowed: boolean
  blocked: DirectionBlock | null
  /** The i18n key of the confirmation text, null when the switch is refused. */
  confirmKey: string | null
  /** Leaving PUBLISH with unpublished edits: the admin must accept that HubRise keeps its last version. */
  needsLocalOverwriteAck: boolean
  /** Switching to IMPORT needs the dry-run diff first (HUBRISE_PREVIEW_REQUIRED otherwise). */
  needsImportPreview: boolean
}

/** What switching who owns the menu takes: whether it can be done, what to confirm and what to show first. */
export const planDirectionChange = (
  status: HubriseStatus,
  target: HubriseCatalogDirection,
): DirectionPlan => {
  const from = status.catalogDirection
  const refuse = (blocked: DirectionBlock): DirectionPlan => ({
    allowed: false,
    blocked,
    confirmKey: null,
    needsLocalOverwriteAck: false,
    needsImportPreview: false,
  })
  if (from === target) return refuse('sameDirection')
  if (!status.connected) return refuse('notConnected')
  if (target === 'PUBLISH' && status.publish.needsReconnectForWrite) {
    return refuse('reconnectRequired')
  }
  return {
    allowed: true,
    blocked: null,
    confirmKey: `hubrise.direction.confirm.${lowerCamel(`${from}_TO_${target}`)}`,
    needsLocalOverwriteAck: from === 'PUBLISH' && status.publish.pending,
    needsImportPreview: target === 'IMPORT',
  }
}

// ─── Publish status and preview ─────────────────────────────────────────────────

export type PublishPhase = 'awaitingFirst' | 'paused' | 'publishing' | 'pending' | 'upToDate'

export interface PublishPhaseInfo {
  phase: PublishPhase
  /** Seconds until the debounced publish runs, for the `pending` phase when the time is known. */
  seconds: number | null
}

/** Whole seconds from `now` to the ISO instant, never negative; null without an instant. */
export const secondsUntil = (iso: string | null, now: number): number | null => {
  if (iso === null) return null
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000))
}

/** `75` -> `1:15`, `5` -> `0:05`. */
export const formatCountdown = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const publishPhase = (publish: HubrisePublishStatus, now: number): PublishPhaseInfo => {
  if (publish.awaitingFirstPublish) return { phase: 'awaitingFirst', seconds: null }
  if (!publish.active) return { phase: 'paused', seconds: null }
  if (publish.publishing) return { phase: 'publishing', seconds: null }
  if (publish.pending)
    return { phase: 'pending', seconds: secondsUntil(publish.nextPublishAt, now) }
  return { phase: 'upToDate', seconds: null }
}

/** Removals first: that is what the admin must read before confirming. */
export const PUBLISH_ACTION_ORDER: readonly HubrisePublishAction[] = ['REMOVE', 'UPDATE', 'ADD']

export interface PublishChangeGroup {
  action: HubrisePublishAction
  changes: HubrisePublishChange[]
}

export const groupPublishChanges = (
  changes: readonly HubrisePublishChange[],
): PublishChangeGroup[] =>
  PUBLISH_ACTION_ORDER.map((action) => ({
    action,
    changes: changes.filter((change) => change.action === action),
  })).filter((group) => group.changes.length > 0)

/** The per-entity counts that changed something. */
export const publishCountRows = (preview: HubrisePublishPreview): HubrisePublishCount[] =>
  preview.counts.filter((row) => row.added + row.updated + row.removed > 0)

export const previewHasChanges = (preview: HubrisePublishPreview): boolean =>
  preview.added + preview.updated + preview.removed > 0

/** What the admin types to confirm a publish that removes many items: the number of removals. Null when not needed. */
export const typedConfirmation = (preview: HubrisePublishPreview): string | null =>
  preview.removalsNeedConfirm ? String(preview.removed) : null

export const canConfirmPublish = (
  preview: HubrisePublishPreview,
  typed: string,
  busy: boolean,
): boolean => {
  if (busy || preview.blockers.length > 0) return false
  const expected = typedConfirmation(preview)
  return expected === null || typed.trim() === expected
}

export interface PublishVariables {
  confirmRemovals: boolean
  removeForeign: boolean
  planHash: string
}

/** The publish the admin confirmed in the dialog: exactly the plan they saw. */
export const publishVariables = (
  preview: HubrisePublishPreview,
  removeForeign: boolean,
): PublishVariables => ({ confirmRemovals: true, removeForeign, planHash: preview.planHash })

// ─── Import ─────────────────────────────────────────────────────────────────────

export interface ImportChangeGroup {
  action: HubriseCatalogAction
  changes: HubriseCatalogChange[]
}

/** Retirements first, like the publish preview. */
export const IMPORT_ACTION_ORDER: readonly HubriseCatalogAction[] = [
  'RETIRE',
  'UPDATE',
  'CREATE',
  'LINK',
  'REVIVE',
]

/** The import modes the page offers: adopting the existing SKUs is always possible, a full import only when HubRise may own the menu. */
export const importModes = (direction: HubriseCatalogDirection): HubriseSyncMode[] =>
  direction === 'PUBLISH' ? ['LINK_ONLY'] : ['LINK_ONLY', 'FULL']

export const groupImportChanges = (changes: readonly HubriseCatalogChange[]): ImportChangeGroup[] =>
  IMPORT_ACTION_ORDER.map((action) => ({
    action,
    changes: changes.filter((change) => change.action === action),
  })).filter((group) => group.changes.length > 0)

// ─── Settings ───────────────────────────────────────────────────────────────────

export const CATALOG_LANGUAGES = ['fr', 'en', 'nl', 'zh'] as const

export interface HubriseSettingsForm {
  catalogLanguage: string
  variantRef: string
  channelName: string
  deliveryChargeRef: string
  paymentFeeChargeRef: string
}

export const settingsFormFrom = (status: HubriseStatus): HubriseSettingsForm => ({
  catalogLanguage: status.catalogLanguage,
  variantRef: status.variantRef ?? '',
  channelName: status.channelName ?? '',
  deliveryChargeRef: status.deliveryChargeRef ?? '',
  paymentFeeChargeRef: status.paymentFeeChargeRef ?? '',
})

const SETTINGS_FORM_KEYS: readonly (keyof HubriseSettingsForm)[] = [
  'catalogLanguage',
  'variantRef',
  'channelName',
  'deliveryChargeRef',
  'paymentFeeChargeRef',
]

/** The settings that differ from the stored ones (an empty text clears the option). */
export const settingsPatch = (
  status: HubriseStatus,
  form: HubriseSettingsForm,
): HubriseSettingsInput => {
  const stored = settingsFormFrom(status)
  const patch: HubriseSettingsInput = {}
  for (const key of SETTINGS_FORM_KEYS) {
    const value = form[key].trim()
    if (value !== stored[key]) patch[key] = value
  }
  return patch
}

export type HubriseToggleId =
  | 'pushOrders'
  | 'syncStatus'
  | 'syncInventory'
  | 'syncCustomers'
  | 'autoRefundOnCancel'
  | 'catalogAutoImport'
  | 'importImages'
  | 'publishImages'

export interface HubriseToggleRow {
  id: HubriseToggleId
  value: boolean
  /** Locked while the integration is paused: nothing leaves until it is enabled. */
  disabled: boolean
  hintKey: string
  hintParams: Record<string, number>
}

/** The feature switches in rollout order, with the hint of their step. Direction-specific ones only in their mode. */
export const toggleRows = (status: HubriseStatus): HubriseToggleRow[] => {
  const direction = status.catalogDirection
  const disabled = !status.enabled
  const row = (
    id: HubriseToggleId,
    value: boolean,
    hint: { key: string; params: Record<string, number> } = {
      key: `hubrise.hints.${id}`,
      params: {},
    },
  ): HubriseToggleRow => ({ id, value, disabled, hintKey: hint.key, hintParams: hint.params })

  const rows: HubriseToggleRow[] = [
    status.unlinkedProducts > 0
      ? row('pushOrders', status.features.pushOrders, {
          key: 'hubrise.hints.pushOrdersUnlinked',
          params: { count: status.unlinkedProducts },
        })
      : row('pushOrders', status.features.pushOrders),
    row('syncStatus', status.features.syncStatus),
    row('syncCustomers', status.syncCustomers),
    row('syncInventory', status.features.syncInventory),
    row('autoRefundOnCancel', status.autoRefundOnCancel),
  ]
  if (direction === 'IMPORT') {
    rows.push(
      row('catalogAutoImport', status.catalogAutoImport),
      row('importImages', status.importImages),
    )
  }
  if (direction === 'PUBLISH') rows.push(row('publishImages', status.publish.publishImages))
  return rows
}

// ─── OAuth return ───────────────────────────────────────────────────────────────

export const OAUTH_OUTCOMES = [
  'connected',
  'relink_required',
  'denied',
  'invalid_state',
  'authorization_failed',
  'error',
] as const

export type HubriseOAuthOutcome = (typeof OAUTH_OUTCOMES)[number]

export interface OAuthToast {
  outcome: HubriseOAuthOutcome
  color: 'success' | 'warning' | 'error'
  key: string
}

/** The toast of `?hubrise=<outcome>` on the way back from HubRise; null for a missing or unknown value. */
export const oauthToast = (value: unknown): OAuthToast | null => {
  const raw: unknown = Array.isArray(value) ? (value as unknown[])[0] : value
  const outcome = OAUTH_OUTCOMES.find((candidate) => candidate === raw)
  if (outcome === undefined) return null
  let color: OAuthToast['color'] = 'error'
  if (outcome === 'connected') color = 'success'
  else if (outcome === 'relink_required' || outcome === 'denied') color = 'warning'
  return { outcome, color, key: `hubrise.oauth.${outcome}` }
}

// ─── Products ───────────────────────────────────────────────────────────────────

export type ChipTone = 'warning' | 'danger' | 'success' | 'info' | 'neutral'

export interface PublishChip {
  tone: ChipTone
  key: string
}

const PUBLISH_CHIPS: Record<HubrisePublishState, PublishChip> = {
  PUBLISHED: { tone: 'success', key: 'products.hubrise.published' },
  PENDING: { tone: 'warning', key: 'products.hubrise.pending' },
  NOT_PUBLISHED: { tone: 'neutral', key: 'products.hubrise.notPublished' },
}

/** The chip of a product in PUBLISH mode; null elsewhere (the field is null outside PUBLISH). */
export const publishChip = (
  info: HubriseProductPublishInfo | null | undefined,
): PublishChip | null => (info === null || info === undefined ? null : PUBLISH_CHIPS[info.state])

/** The product is owned by HubRise (IMPORT mode): the dashboard cannot edit its locked fields. */
export const isHubriseManaged = (product: HubriseProductFields | null | undefined): boolean =>
  product?.hubriseManaged === true

export const isFieldLocked = (
  product: HubriseProductFields | null | undefined,
  field: string,
): boolean => isHubriseManaged(product) && (product?.hubriseLockedFields ?? []).includes(field)

// ─── Orders ─────────────────────────────────────────────────────────────────────

const PUSH_STATE_TONES: Record<string, ChipTone> = {
  pending: 'warning',
  sent: 'success',
  parked: 'danger',
  skipped: 'neutral',
}

export const ORDER_ATTENTION_CODES = [
  'UNLINKED_ITEM',
  'TOTAL_MISMATCH',
  'NOT_ACCEPTED',
  'STATUS_CONFLICT',
  'DELIVERY_FAILED',
  'REMOTE_CANCEL_FAILED',
  'REMOTE_CANCELLED_PAID',
] as const

export type OrderAttentionCode = (typeof ORDER_ATTENTION_CODES)[number]

const isAttentionCode = (code: string): code is OrderAttentionCode =>
  (ORDER_ATTENTION_CODES as readonly string[]).includes(code)

/** Key of the explanation card of an attention code; unknown codes get a generic one. */
export const attentionKey = (code: string): string =>
  `orders.hubrise.attention.${isAttentionCode(code) ? lowerCamel(code) : 'unknown'}`

export interface OrderBadge {
  id: 'push' | 'attention'
  tone: ChipTone
  key: string
}

/** The badges of an order row: its push state, and the reason staff must look at it. Empty when it never reached HubRise. */
export const orderHubriseBadges = (info: HubriseOrderInfo | null | undefined): OrderBadge[] => {
  if (info === null || info === undefined) return []
  const badges: OrderBadge[] = [
    {
      id: 'push',
      tone: PUSH_STATE_TONES[info.pushState] ?? 'neutral',
      key: `orders.hubrise.push.${Object.hasOwn(PUSH_STATE_TONES, info.pushState) ? info.pushState : 'unknown'}`,
    },
  ]
  if (info.needsAttention !== null) {
    badges.push({ id: 'attention', tone: 'danger', key: 'orders.hubrise.needsAttention' })
  }
  return badges
}

/** A paid order was cancelled at the EPOS: staff must cancel it here too, which refunds the customer. */
export const needsStaffCancel = (
  info: HubriseOrderInfo | null | undefined,
  orderStatus: string,
): boolean => info?.needsAttention === 'REMOTE_CANCELLED_PAID' && orderStatus !== 'CANCELLED'

/** The attention code to explain on the order page (the paid cancel also has its own banner while it is open). */
export const attentionCard = (info: HubriseOrderInfo | null | undefined): string | null =>
  info?.needsAttention ?? null
