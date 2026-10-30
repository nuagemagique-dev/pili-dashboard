// Builders for the HubRise shapes (`~/utils/hubrise`). Every builder returns a complete, valid object; a test overrides
// only what it is about. `makeStatus({ publish: {...} })` merges the nested publish block.
import type {
  HubriseCatalogChange,
  HubriseCatalogDiff,
  HubriseOrderInfo,
  HubriseOutboxItem,
  HubrisePublishChange,
  HubrisePublishPreview,
  HubrisePublishStatus,
  HubriseStatus,
} from '~/utils/hubrise'

export function makePublish(overrides: Partial<HubrisePublishStatus> = {}): HubrisePublishStatus {
  return {
    enabled: false,
    active: false,
    pending: false,
    pendingSince: null,
    nextPublishAt: null,
    publishing: false,
    lastPublishedAt: null,
    firstPublishConfirmedAt: null,
    awaitingFirstPublish: false,
    lastError: null,
    lastErrorCode: null,
    lastErrorAt: null,
    externalChangeAt: null,
    needsReconnectForWrite: false,
    accountCatalogDetected: false,
    publishImages: false,
    publishedProducts: 0,
    pendingProducts: 0,
    ...overrides,
  }
}

type StatusOverrides = Partial<Omit<HubriseStatus, 'publish' | 'features' | 'backlog'>> & {
  publish?: Partial<HubrisePublishStatus>
  features?: Partial<HubriseStatus['features']>
  backlog?: Partial<HubriseStatus['backlog']>
}

export function makeStatus(overrides: StatusOverrides = {}): HubriseStatus {
  const { publish, features, backlog, ...rest } = overrides
  return {
    available: true,
    connected: true,
    enabled: true,
    accountId: 'acc1',
    accountName: 'Tokyo Sushi',
    locationId: 'loc1',
    locationName: 'Liege',
    catalogId: 'cat1',
    catalogName: 'Menu',
    customerListId: 'cl1',
    customerListName: 'Clients',
    features: {
      pushOrders: false,
      syncStatus: false,
      syncInventory: false,
      syncCatalog: false,
      publishCatalog: false,
      ...features,
    },
    syncCustomers: false,
    catalogAutoImport: false,
    catalogUpdateAvailable: false,
    catalogPendingReview: false,
    autoRefundOnCancel: false,
    catalogLanguage: 'fr',
    variantRef: null,
    channelName: null,
    deliveryChargeRef: null,
    paymentFeeChargeRef: null,
    platformPrices: [],
    importImages: false,
    lastCatalogSyncAt: null,
    lastEventAt: null,
    authErrorAt: null,
    lastError: null,
    relinkRequired: false,
    backlog: { pending: 0, parked: 0, ...backlog },
    unlinkedProducts: 0,
    attention: 0,
    catalogDirection: 'NONE',
    publish: makePublish(publish),
    ...rest,
  }
}

export function makePublishChange(
  overrides: Partial<HubrisePublishChange> = {},
): HubrisePublishChange {
  return {
    entity: 'PRODUCT',
    action: 'ADD',
    key: 'ramen',
    ref: 'ramen',
    name: 'Ramen',
    fields: ['name', 'price'],
    ...overrides,
  }
}

export function makePreview(overrides: Partial<HubrisePublishPreview> = {}): HubrisePublishPreview {
  return {
    planHash: 'hash-1',
    firstPublish: false,
    added: 1,
    updated: 0,
    removed: 0,
    unchanged: 10,
    foreign: 0,
    counts: [{ entity: 'PRODUCT', added: 1, updated: 0, removed: 0 }],
    changes: [makePublishChange()],
    truncated: false,
    foreignItems: [],
    preserved: [],
    warnings: [],
    blockers: [],
    removalsNeedConfirm: false,
    generatedAt: '2026-10-24T10:00:00Z',
    ...overrides,
  }
}

export function makeCatalogChange(
  overrides: Partial<HubriseCatalogChange> = {},
): HubriseCatalogChange {
  return {
    entity: 'PRODUCT',
    action: 'UPDATE',
    key: 'sku1',
    name: 'Ramen',
    fields: ['price'],
    ...overrides,
  }
}

export function makeDiff(overrides: Partial<HubriseCatalogDiff> = {}): HubriseCatalogDiff {
  return {
    catalogHash: 'cat-hash',
    changes: [makeCatalogChange()],
    warnings: [],
    conflicts: [],
    unchanged: 5,
    retiringProducts: 0,
    linkedProducts: 5,
    retireNeedsConfirm: false,
    ...overrides,
  }
}

export function makeOutboxItem(overrides: Partial<HubriseOutboxItem> = {}): HubriseOutboxItem {
  return {
    id: 'ob-1',
    kind: 'ORDER_CREATE',
    orderId: 'o-1',
    state: 'PARKED',
    attempts: 3,
    lastError: 'HubRise answered 422',
    nextAttemptAt: '2026-10-24T10:05:00Z',
    createdAt: '2026-10-24T10:00:00Z',
    sentAt: null,
    parkedAt: '2026-10-24T10:04:00Z',
    ...overrides,
  }
}

export function makeOrderInfo(overrides: Partial<HubriseOrderInfo> = {}): HubriseOrderInfo {
  return {
    hubriseOrderId: 'hr-1',
    pushState: 'sent',
    pushedAt: '2026-10-24T10:00:00Z',
    remoteStatus: 'new',
    remoteTotal: '12.50',
    needsAttention: null,
    ...overrides,
  }
}

/** A GraphQL failure as `$gqlFetch` rejects with it: the raw `errors` array. */
export function gqlFailure(code: string, extensions: Record<string, unknown> = {}): unknown[] {
  return [{ message: code, extensions: { code, ...extensions } }]
}
