import { describe, expect, it } from 'vite-plus/test'
import {
  attentionCard,
  bannerParams,
  formatInstant,
  importModes,
  splitBanners,
  attentionKey,
  canConfirmPublish,
  CATALOG_DIRECTIONS,
  DEFAULT_RETRY_SECONDS,
  formatCountdown,
  groupImportChanges,
  groupPublishChanges,
  hubriseError,
  hubriseErrorKey,
  HUBRISE_ERROR_CODES,
  HUBRISE_PUBLISH_ERROR_CODES,
  hubriseNavHintKey,
  hubriseNavVisible,
  isFieldLocked,
  isHubriseManaged,
  layoutBanner,
  needsStaffCancel,
  oauthToast,
  OAUTH_OUTCOMES,
  ORDER_ATTENTION_CODES,
  orderHubriseBadges,
  planDirectionChange,
  previewHasChanges,
  orderDocument,
  HUBRISE_ORDER_FIELDS,
  productDocument,
  HUBRISE_PRODUCT_FIELDS,
  publishChip,
  publishCountRows,
  publishErrorKey,
  publishPhase,
  publishVariables,
  secondsUntil,
  settingsFormFrom,
  settingsPatch,
  statusBanners,
  toggleRows,
  typedConfirmation,
  cleanPlatformPrices,
  newPlatformPrice,
  platformPricesChanged,
} from '~/utils/hubrise'
import {
  gqlFailure,
  makeCatalogChange,
  makeOrderInfo,
  makePreview,
  makePublishChange,
  makePublish,
  makeStatus,
} from '../fixtures/hubrise'

describe('error codes', () => {
  it('maps every HubRise code to its own message key', () => {
    const keys = HUBRISE_ERROR_CODES.map((code) => hubriseErrorKey(code))
    expect(new Set(keys).size).toBe(HUBRISE_ERROR_CODES.length)
    expect(hubriseErrorKey('HUBRISE_PREVIEW_STALE')).toBe('hubrise.errors.previewStale')
    expect(hubriseErrorKey('HUBRISE_RATE_LIMITED')).toBe('hubrise.errors.rateLimited')
    expect(hubriseErrorKey('HUBRISE_EMPTY_MENU')).toBe('hubrise.errors.emptyMenu')
  })

  it('falls back to the generic message for an unknown or missing code', () => {
    expect(hubriseErrorKey('HUBRISE_NOPE')).toBe('hubrise.errors.generic')
    expect(hubriseErrorKey(null)).toBe('hubrise.errors.generic')
  })

  it('maps every publish error code to its own key', () => {
    const keys = HUBRISE_PUBLISH_ERROR_CODES.map((code) => publishErrorKey(code))
    expect(new Set(keys).size).toBe(HUBRISE_PUBLISH_ERROR_CODES.length)
    expect(publishErrorKey('WRITE_SCOPE_MISSING')).toBe('hubrise.publish.errors.writeScopeMissing')
  })

  it('reads the code of a failed operation', () => {
    expect(hubriseError(gqlFailure('HUBRISE_PREVIEW_STALE'))).toEqual({
      code: 'HUBRISE_PREVIEW_STALE',
      key: 'hubrise.errors.previewStale',
      params: {},
      retryAfterSeconds: null,
    })
  })

  it('carries retryAfterSeconds of a rate limit, rounded up', () => {
    const info = hubriseError(gqlFailure('HUBRISE_RATE_LIMITED', { retryAfterSeconds: 12.2 }))
    expect(info.retryAfterSeconds).toBe(13)
    expect(info.params).toEqual({ seconds: 13 })
  })

  it('waits a default time when a rate limit does not say how long', () => {
    for (const extensions of [{}, { retryAfterSeconds: 0 }, { retryAfterSeconds: 'soon' }]) {
      const info = hubriseError(gqlFailure('HUBRISE_RATE_LIMITED', extensions))
      expect(info.retryAfterSeconds).toBe(DEFAULT_RETRY_SECONDS)
    }
  })

  it('carries the upstream status', () => {
    expect(hubriseError(gqlFailure('HUBRISE_UPSTREAM', { status: 502 })).params).toEqual({
      status: 502,
    })
    expect(hubriseError(gqlFailure('HUBRISE_UPSTREAM', { status: 'timeout' })).params).toEqual({
      status: 'timeout',
    })
    expect(hubriseError(gqlFailure('HUBRISE_UPSTREAM')).params).toEqual({ status: '' })
  })

  it('skips errors that are not ours and takes the first one that is', () => {
    const errors = [
      { message: 'x' },
      { message: 'y', extensions: 'nope' },
      { message: 'z', extensions: {} },
      { message: 'w', extensions: { code: 'FORBIDDEN' } },
      { message: 'v', extensions: { code: 'HUBRISE_BUSY' } },
    ]
    expect(hubriseError(errors).code).toBe('HUBRISE_BUSY')
  })

  it('answers the generic message for anything else', () => {
    for (const error of [new Error('offline'), 'boom', undefined, { errors: [] }]) {
      expect(hubriseError(error)).toEqual({
        code: null,
        key: 'hubrise.errors.generic',
        params: {},
        retryAfterSeconds: null,
      })
    }
  })

  it('reads the errors of a wrapped failure', () => {
    expect(hubriseError({ errors: gqlFailure('HUBRISE_MANAGED') }).code).toBe('HUBRISE_MANAGED')
  })
})

describe('status banners', () => {
  const ids = (status: Parameters<typeof statusBanners>[0]) =>
    statusBanners(status).map((banner) => banner.id)

  it('shows nothing before a location is connected', () => {
    expect(ids(null)).toEqual([])
    expect(ids(makeStatus({ available: false, authErrorAt: '2026-10-24T10:00:00Z' }))).toEqual([])
    expect(ids(makeStatus({ connected: false, authErrorAt: '2026-10-24T10:00:00Z' }))).toEqual([])
    expect(ids(makeStatus())).toEqual([])
  })

  it('puts the refused token first, with its date', () => {
    const banners = statusBanners(
      makeStatus({ authErrorAt: '2026-10-24T10:00:00Z', relinkRequired: true }),
    )
    expect(banners.map((b) => b.id)).toEqual(['authError', 'relinkRequired'])
    expect(banners[0]).toEqual({
      id: 'authError',
      tone: 'error',
      key: 'hubrise.banners.authError',
      params: { since: '2026-10-24T10:00:00Z' },
      action: 'reconnect',
    })
    expect(banners[1]?.action).toBe('forgetLinks')
  })

  it('lists the PUBLISH banners in priority order', () => {
    const status = makeStatus({
      catalogDirection: 'PUBLISH',
      catalogPendingReview: true,
      catalogUpdateAvailable: true,
      publish: {
        needsReconnectForWrite: true,
        accountCatalogDetected: true,
        externalChangeAt: '2026-10-24T09:00:00Z',
        lastErrorCode: 'REJECTED',
        lastError: 'name too long',
      },
    })
    expect(ids(status)).toEqual([
      'reconnectForWrite',
      'accountCatalog',
      'externalChange',
      'publishError',
    ])
  })

  it('describes the external change and the publish error', () => {
    const banners = statusBanners(
      makeStatus({
        catalogDirection: 'PUBLISH',
        publish: {
          externalChangeAt: '2026-10-24T09:00:00Z',
          lastErrorCode: 'UNAVAILABLE',
          lastError: null,
        },
      }),
    )
    expect(banners[0]).toMatchObject({
      id: 'externalChange',
      params: { at: '2026-10-24T09:00:00Z' },
    })
    expect(banners[0]?.action).toBe('acknowledge')
    expect(banners[1]).toEqual({
      id: 'publishError',
      tone: 'warning',
      key: 'hubrise.publish.errors.unavailable',
      params: { detail: '' },
      action: null,
    })
  })

  it('does not repeat a publish error another banner already tells', () => {
    for (const lastErrorCode of ['WRITE_SCOPE_MISSING', 'ACCOUNT_CATALOG', 'AUTH'] as const) {
      expect(ids(makeStatus({ catalogDirection: 'PUBLISH', publish: { lastErrorCode } }))).toEqual(
        [],
      )
    }
  })

  it('shows a publish error as an error unless HubRise is merely unavailable', () => {
    const [banner] = statusBanners(
      makeStatus({
        catalogDirection: 'PUBLISH',
        publish: { lastErrorCode: 'INVALID_MENU', lastError: 'x' },
      }),
    )
    expect(banner).toMatchObject({ tone: 'error', params: { detail: 'x' } })
  })

  it('ignores publish state while the menu is not published', () => {
    const status = makeStatus({
      catalogDirection: 'IMPORT',
      publish: {
        needsReconnectForWrite: true,
        accountCatalogDetected: true,
        externalChangeAt: '2026-10-24T09:00:00Z',
        lastErrorCode: 'REJECTED',
      },
    })
    expect(ids(status)).toEqual([])
  })

  it('shows the import banners outside PUBLISH only', () => {
    const status = makeStatus({
      catalogDirection: 'IMPORT',
      catalogPendingReview: true,
      catalogUpdateAvailable: true,
    })
    const banners = statusBanners(status)
    expect(banners.map((b) => [b.id, b.tone, b.action])).toEqual([
      ['pendingReview', 'warning', 'reviewImport'],
      ['updateAvailable', 'info', 'import'],
    ])
    expect(ids({ ...status, catalogDirection: 'PUBLISH', publish: makePublish() })).toEqual([])
  })

  it('guides to the preview when a publish waits for a removals confirmation', () => {
    const waiting = makeStatus({
      catalogDirection: 'PUBLISH',
      publish: makePublish({ lastErrorCode: 'REMOVALS_NEED_CONFIRM', lastError: 'hold' }),
    })
    expect(statusBanners(waiting)).toEqual([
      expect.objectContaining({
        id: 'removalsConfirm',
        key: 'hubrise.banners.removalsConfirm',
        action: 'preview',
      }),
    ])
    expect(statusBanners({ ...waiting, catalogDirection: 'IMPORT' })).toEqual([])
  })
})

describe('layout banner and navigation', () => {
  it('stays quiet without a connection', () => {
    expect(layoutBanner(null, '/fr/orders')).toBeNull()
    expect(layoutBanner(makeStatus({ available: false }), '/fr/orders')).toBeNull()
    expect(layoutBanner(makeStatus({ connected: false }), '/fr/orders')).toBeNull()
  })

  it('warns about a refused token, then about parked rows', () => {
    const base = { backlog: { parked: 2 } }
    expect(
      layoutBanner(makeStatus({ ...base, authErrorAt: '2026-10-24T10:00:00Z' }), '/fr/orders'),
    ).toBe('authError')
    expect(layoutBanner(makeStatus(base), '/fr/orders')).toBe('parked')
    expect(layoutBanner(makeStatus(), '/fr/orders')).toBeNull()
  })

  it('is hidden on the HubRise page itself', () => {
    expect(layoutBanner(makeStatus({ backlog: { parked: 2 } }), '/fr/hubrise')).toBeNull()
  })

  it('shows the navigation entry only where HubRise is configured', () => {
    expect(hubriseNavVisible(null)).toBe(false)
    expect(hubriseNavVisible(makeStatus({ available: false }))).toBe(false)
    expect(hubriseNavVisible(makeStatus())).toBe(true)
  })

  it('gives the More menu a one word state', () => {
    expect(hubriseNavHintKey(null)).toBeNull()
    expect(hubriseNavHintKey(makeStatus({ available: false }))).toBeNull()
    expect(hubriseNavHintKey(makeStatus({ connected: false }))).toBe('hubrise.status.notConnected')
    expect(hubriseNavHintKey(makeStatus({ enabled: false }))).toBe('hubrise.status.paused')
    expect(hubriseNavHintKey(makeStatus())).toBe('hubrise.status.enabled')
  })
})

describe('catalog direction', () => {
  it('offers the three owners', () => {
    expect(CATALOG_DIRECTIONS).toEqual(['NONE', 'IMPORT', 'PUBLISH'])
  })

  it('refuses the direction it already has', () => {
    expect(planDirectionChange(makeStatus(), 'NONE')).toMatchObject({
      allowed: false,
      blocked: 'sameDirection',
      confirmKey: null,
    })
  })

  it('refuses everything without a connection', () => {
    expect(planDirectionChange(makeStatus({ connected: false }), 'IMPORT').blocked).toBe(
      'notConnected',
    )
  })

  it('refuses PUBLISH until the connection can write, and only PUBLISH', () => {
    const status = makeStatus({ publish: { needsReconnectForWrite: true } })
    expect(planDirectionChange(status, 'PUBLISH').blocked).toBe('reconnectRequired')
    expect(planDirectionChange(status, 'IMPORT').allowed).toBe(true)
  })

  it('has a confirmation text for each of the six moves', () => {
    const keys = new Set<string | null>()
    for (const from of CATALOG_DIRECTIONS) {
      for (const to of CATALOG_DIRECTIONS) {
        if (from === to) continue
        const plan = planDirectionChange(makeStatus({ catalogDirection: from }), to)
        expect(plan.allowed).toBe(true)
        keys.add(plan.confirmKey)
      }
    }
    expect(keys.size).toBe(6)
    expect(keys.has('hubrise.direction.confirm.publishToImport')).toBe(true)
    expect(keys.has('hubrise.direction.confirm.noneToPublish')).toBe(true)
  })

  it('needs the dry run to import, and an acknowledgement to leave PUBLISH with edits waiting', () => {
    const pending = makeStatus({ catalogDirection: 'PUBLISH', publish: { pending: true } })
    expect(planDirectionChange(pending, 'IMPORT')).toMatchObject({
      needsImportPreview: true,
      needsLocalOverwriteAck: true,
    })
    expect(planDirectionChange(pending, 'NONE')).toMatchObject({
      needsImportPreview: false,
      needsLocalOverwriteAck: true,
    })
    const clean = makeStatus({ catalogDirection: 'PUBLISH' })
    expect(planDirectionChange(clean, 'NONE').needsLocalOverwriteAck).toBe(false)
    expect(planDirectionChange(makeStatus(), 'PUBLISH').needsLocalOverwriteAck).toBe(false)
  })
})

describe('publish status', () => {
  const now = Date.parse('2026-10-24T10:00:00Z')

  it('counts down to an instant, never below zero', () => {
    expect(secondsUntil(null, now)).toBeNull()
    expect(secondsUntil('2026-10-24T10:00:10.500Z', now)).toBe(11)
    expect(secondsUntil('2026-10-24T09:59:00Z', now)).toBe(0)
  })

  it('formats a countdown as minutes and seconds', () => {
    expect(formatCountdown(75)).toBe('1:15')
    expect(formatCountdown(5)).toBe('0:05')
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-3)).toBe('0:00')
    expect(formatCountdown(59.9)).toBe('0:59')
  })

  it('tells the phase of the publisher', () => {
    const phase = (over: Parameters<typeof makePublish>[0]) => publishPhase(makePublish(over), now)
    expect(phase({ awaitingFirstPublish: true, active: true })).toEqual({
      phase: 'awaitingFirst',
      seconds: null,
    })
    expect(phase({ active: false, pending: true })).toEqual({ phase: 'paused', seconds: null })
    expect(phase({ active: true, publishing: true, pending: true })).toEqual({
      phase: 'publishing',
      seconds: null,
    })
    expect(phase({ active: true, pending: true, nextPublishAt: '2026-10-24T10:00:20Z' })).toEqual({
      phase: 'pending',
      seconds: 20,
    })
    expect(phase({ active: true, pending: true })).toEqual({ phase: 'pending', seconds: null })
    expect(phase({ active: true })).toEqual({ phase: 'upToDate', seconds: null })
  })
})

describe('publish preview', () => {
  it('groups the changes with the removals first and drops empty groups', () => {
    const changes = [
      makePublishChange({ action: 'ADD', key: 'a' }),
      makePublishChange({ action: 'REMOVE', key: 'r1' }),
      makePublishChange({ action: 'ADD', key: 'b' }),
      makePublishChange({ action: 'REMOVE', key: 'r2' }),
    ]
    const groups = groupPublishChanges(changes)
    expect(groups.map((g) => g.action)).toEqual(['REMOVE', 'ADD'])
    expect(groups[0]?.changes.map((c) => c.key)).toEqual(['r1', 'r2'])
    expect(groupPublishChanges([])).toEqual([])
  })

  it('keeps the entities that changed', () => {
    const preview = makePreview({
      counts: [
        { entity: 'CATEGORY', added: 0, updated: 0, removed: 0 },
        { entity: 'PRODUCT', added: 1, updated: 2, removed: 0 },
      ],
    })
    expect(publishCountRows(preview).map((r) => r.entity)).toEqual(['PRODUCT'])
  })

  it('knows whether anything changes', () => {
    expect(previewHasChanges(makePreview())).toBe(true)
    expect(previewHasChanges(makePreview({ added: 0, updated: 0, removed: 0 }))).toBe(false)
    expect(previewHasChanges(makePreview({ added: 0, updated: 0, removed: 3 }))).toBe(true)
  })

  it('asks to type the number of removals above the threshold only', () => {
    expect(typedConfirmation(makePreview())).toBeNull()
    expect(typedConfirmation(makePreview({ removalsNeedConfirm: true, removed: 7 }))).toBe('7')
  })

  it('confirms only a publishable plan, not busy, and typed when required', () => {
    const plain = makePreview()
    expect(canConfirmPublish(plain, '', false)).toBe(true)
    expect(canConfirmPublish(plain, '', true)).toBe(false)
    const blocked = makePreview({ blockers: [{ code: 'DUP', key: 'x', message: 'dup' }] })
    expect(canConfirmPublish(blocked, '', false)).toBe(false)
    const mass = makePreview({ removalsNeedConfirm: true, removed: 7 })
    expect(canConfirmPublish(mass, '', false)).toBe(false)
    expect(canConfirmPublish(mass, '6', false)).toBe(false)
    expect(canConfirmPublish(mass, ' 7 ', false)).toBe(true)
  })

  it('publishes exactly the plan that was shown', () => {
    expect(publishVariables(makePreview({ planHash: 'h' }), true)).toEqual({
      confirmRemovals: true,
      removeForeign: true,
      planHash: 'h',
    })
  })
})

describe('import diff', () => {
  it('groups retirements first', () => {
    const groups = groupImportChanges([
      makeCatalogChange({ action: 'CREATE', key: 'c' }),
      makeCatalogChange({ action: 'RETIRE', key: 'r' }),
      makeCatalogChange({ action: 'LINK', key: 'l' }),
      makeCatalogChange({ action: 'REVIVE', key: 'v' }),
      makeCatalogChange({ action: 'UPDATE', key: 'u' }),
    ])
    expect(groups.map((g) => g.action)).toEqual(['RETIRE', 'UPDATE', 'CREATE', 'LINK', 'REVIVE'])
    expect(groupImportChanges([])).toEqual([])
  })
})

describe('settings', () => {
  it('fills the form with the stored options, empty text for none', () => {
    expect(settingsFormFrom(makeStatus({ catalogLanguage: 'nl' }))).toEqual({
      catalogLanguage: 'nl',
      variantRef: '',
      channelName: '',
      deliveryChargeRef: '',
      paymentFeeChargeRef: '',
    })
  })

  it('fills the form with every stored option', () => {
    const status = makeStatus({
      variantRef: 'v',
      channelName: 'c',
      deliveryChargeRef: 'd',
      paymentFeeChargeRef: 'p',
    })
    expect(settingsFormFrom(status)).toMatchObject({
      variantRef: 'v',
      channelName: 'c',
      deliveryChargeRef: 'd',
      paymentFeeChargeRef: 'p',
    })
  })

  it('patches only what changed, trimmed, an empty text clearing the option', () => {
    const status = makeStatus({ channelName: 'web', variantRef: 'big' })
    const form = {
      ...settingsFormFrom(status),
      catalogLanguage: 'en',
      channelName: '',
      variantRef: ' big ',
      deliveryChargeRef: ' DELIV ',
    }
    expect(settingsPatch(status, form)).toEqual({
      catalogLanguage: 'en',
      channelName: '',
      deliveryChargeRef: 'DELIV',
    })
    expect(settingsPatch(status, settingsFormFrom(status))).toEqual({})
  })
})

describe('feature toggles', () => {
  const ids = (status: Parameters<typeof toggleRows>[0]) => toggleRows(status).map((r) => r.id)

  it('lists the switches in rollout order', () => {
    expect(ids(makeStatus())).toEqual([
      'pushOrders',
      'syncStatus',
      'syncCustomers',
      'syncInventory',
      'autoRefundOnCancel',
    ])
  })

  it('adds the import switches in IMPORT and the image switch in PUBLISH', () => {
    expect(ids(makeStatus({ catalogDirection: 'IMPORT' }))).toEqual([
      'pushOrders',
      'syncStatus',
      'syncCustomers',
      'syncInventory',
      'autoRefundOnCancel',
      'catalogAutoImport',
      'importImages',
    ])
    expect(ids(makeStatus({ catalogDirection: 'PUBLISH' })).at(-1)).toBe('publishImages')
  })

  it('reads each value from the status', () => {
    const rows = toggleRows(
      makeStatus({
        catalogDirection: 'PUBLISH',
        features: { pushOrders: true, syncStatus: true, syncInventory: true },
        syncCustomers: true,
        autoRefundOnCancel: true,
        publish: { publishImages: true },
      }),
    )
    expect(rows.every((r) => r.value)).toBe(true)
    const off = toggleRows(makeStatus({ catalogDirection: 'IMPORT' }))
    expect(off.every((r) => !r.value)).toBe(true)
    expect(
      toggleRows(
        makeStatus({ catalogDirection: 'IMPORT', catalogAutoImport: true, importImages: true }),
      )
        .filter((r) => r.value)
        .map((r) => r.id),
    ).toEqual(['catalogAutoImport', 'importImages'])
  })

  it('locks them while the integration is paused', () => {
    expect(toggleRows(makeStatus({ enabled: false })).every((r) => r.disabled)).toBe(true)
    expect(toggleRows(makeStatus()).some((r) => r.disabled)).toBe(false)
  })

  it('hints at the link step when products have no SKU', () => {
    const [push] = toggleRows(makeStatus({ unlinkedProducts: 4 }))
    expect(push).toMatchObject({
      hintKey: 'hubrise.hints.pushOrdersUnlinked',
      hintParams: { count: 4 },
    })
    expect(toggleRows(makeStatus())[0]).toMatchObject({
      hintKey: 'hubrise.hints.pushOrders',
      hintParams: {},
    })
  })
})

describe('OAuth return', () => {
  it('has a toast for each outcome', () => {
    for (const outcome of OAUTH_OUTCOMES) {
      expect(oauthToast(outcome)?.key).toBe(`hubrise.oauth.${outcome}`)
    }
    expect(oauthToast('connected')?.color).toBe('success')
    expect(oauthToast('relink_required')?.color).toBe('warning')
    expect(oauthToast('denied')?.color).toBe('warning')
    for (const outcome of ['invalid_state', 'authorization_failed', 'error']) {
      expect(oauthToast(outcome)?.color).toBe('error')
    }
  })

  it('reads a repeated query parameter and ignores the unknown', () => {
    expect(oauthToast(['denied', 'error'])?.outcome).toBe('denied')
    expect(oauthToast('nope')).toBeNull()
    expect(oauthToast(undefined)).toBeNull()
    expect(oauthToast([])).toBeNull()
  })
})

describe('products', () => {
  it('maps the publish state to a chip', () => {
    expect(publishChip(null)).toBeNull()
    expect(publishChip(undefined)).toBeNull()
    expect(publishChip({ state: 'PUBLISHED', publishedAt: null, ref: null })).toEqual({
      tone: 'success',
      key: 'products.hubrise.published',
    })
    expect(publishChip({ state: 'PENDING', publishedAt: null, ref: null })?.tone).toBe('warning')
    expect(publishChip({ state: 'NOT_PUBLISHED', publishedAt: null, ref: null })?.tone).toBe(
      'neutral',
    )
  })

  it('locks the fields of a managed product only', () => {
    const managed = { hubriseManaged: true, hubriseLockedFields: ['price', 'code'] }
    expect(isHubriseManaged(managed)).toBe(true)
    expect(isHubriseManaged({ hubriseManaged: false })).toBe(false)
    expect(isHubriseManaged({})).toBe(false)
    expect(isHubriseManaged(null)).toBe(false)
    expect(isHubriseManaged(undefined)).toBe(false)
    expect(isFieldLocked(managed, 'price')).toBe(true)
    expect(isFieldLocked(managed, 'name')).toBe(false)
    expect(isFieldLocked({ hubriseManaged: true }, 'price')).toBe(false)
    expect(isFieldLocked({ hubriseManaged: false, hubriseLockedFields: ['price'] }, 'price')).toBe(
      false,
    )
    expect(isFieldLocked(null, 'price')).toBe(false)
  })
})

describe('orders', () => {
  it('shows nothing for an order that never reached HubRise', () => {
    expect(orderHubriseBadges(null)).toEqual([])
    expect(orderHubriseBadges(undefined)).toEqual([])
  })

  it('badges the push state with a tone each', () => {
    const tone = (pushState: string) => orderHubriseBadges(makeOrderInfo({ pushState }))[0]
    expect(tone('pending')).toEqual({
      id: 'push',
      tone: 'warning',
      key: 'orders.hubrise.push.pending',
    })
    expect(tone('sent')?.tone).toBe('success')
    expect(tone('parked')?.tone).toBe('danger')
    expect(tone('skipped')?.tone).toBe('neutral')
    expect(tone('weird')).toEqual({
      id: 'push',
      tone: 'neutral',
      key: 'orders.hubrise.push.unknown',
    })
  })

  it('adds a danger badge when staff must look', () => {
    const badges = orderHubriseBadges(makeOrderInfo({ needsAttention: 'TOTAL_MISMATCH' }))
    expect(badges.map((b) => b.id)).toEqual(['push', 'attention'])
    expect(badges[1]).toEqual({
      id: 'attention',
      tone: 'danger',
      key: 'orders.hubrise.needsAttention',
    })
  })

  it('has an explanation for each attention code and a fallback', () => {
    const keys = ORDER_ATTENTION_CODES.map((code) => attentionKey(code))
    expect(new Set(keys).size).toBe(ORDER_ATTENTION_CODES.length)
    expect(attentionKey('UNLINKED_ITEM')).toBe('orders.hubrise.attention.unlinkedItem')
    expect(attentionKey('REMOTE_CANCELLED_PAID')).toBe(
      'orders.hubrise.attention.remoteCancelledPaid',
    )
    expect(attentionKey('SOMETHING_NEW')).toBe('orders.hubrise.attention.unknown')
  })

  it('asks for a staff cancel while a paid order cancelled at the EPOS is still open', () => {
    const paid = makeOrderInfo({ needsAttention: 'REMOTE_CANCELLED_PAID' })
    expect(needsStaffCancel(paid, 'PREPARING')).toBe(true)
    expect(needsStaffCancel(paid, 'CANCELLED')).toBe(false)
    expect(needsStaffCancel(makeOrderInfo({ needsAttention: 'UNLINKED_ITEM' }), 'PENDING')).toBe(
      false,
    )
    expect(needsStaffCancel(null, 'PENDING')).toBe(false)
    expect(needsStaffCancel(undefined, 'PENDING')).toBe(false)
  })

  it('reads the attention code to explain', () => {
    expect(attentionCard(makeOrderInfo({ needsAttention: 'NOT_ACCEPTED' }))).toBe('NOT_ACCEPTED')
    expect(attentionCard(makeOrderInfo())).toBeNull()
    expect(attentionCard(null)).toBeNull()
    expect(attentionCard(undefined)).toBeNull()
  })
})

describe('banner helpers', () => {
  it('splits the publish banners from the page ones', () => {
    const status = makeStatus({
      catalogDirection: 'PUBLISH',
      authErrorAt: '2026-10-24T10:00:00Z',
      publish: { needsReconnectForWrite: true, externalChangeAt: '2026-10-24T09:00:00Z' },
    })
    const { general, publish } = splitBanners(statusBanners(status))
    expect(general.map((b) => b.id)).toEqual(['authError'])
    expect(publish.map((b) => b.id)).toEqual(['reconnectForWrite', 'externalChange'])
  })

  it('shows an instant in Brussels time', () => {
    expect(formatInstant('2026-10-24T10:00:00Z', 'en-GB')).toMatch(/24 Oct 2026.*12:00/u)
  })

  it('formats the instants of a banner and leaves the other parameters alone', () => {
    const [banner] = statusBanners(
      makeStatus({
        catalogDirection: 'PUBLISH',
        publish: { lastErrorCode: 'REJECTED', lastError: 'name too long' },
      }),
    )
    expect(bannerParams(banner!, 'en-GB')).toEqual({ detail: 'name too long' })
    const [auth] = statusBanners(makeStatus({ authErrorAt: '2026-10-24T10:00:00Z' }))
    expect(bannerParams(auth!, 'en-GB').since).toMatch(/12:00/u)
  })

  it('offers adoption always and a full import unless the dashboard owns the menu', () => {
    expect(importModes('PUBLISH')).toEqual(['LINK_ONLY'])
    expect(importModes('IMPORT')).toEqual(['LINK_ONLY', 'FULL'])
    expect(importModes('NONE')).toEqual(['LINK_ONLY', 'FULL'])
  })
})

describe('product query fields', () => {
  it('asks for the HubRise fields only where HubRise is configured', () => {
    const document = `query { products { id ${HUBRISE_PRODUCT_FIELDS} } }`
    expect(productDocument(document, makeStatus())).toBe(document)
    expect(productDocument(document, makeStatus({ available: false }))).toBe(
      'query { products { id  } }',
    )
    expect(productDocument(document, null)).toBe('query { products { id  } }')
    for (const field of [
      'hubriseManaged',
      'hubriseLockedFields',
      'hubrisePublish',
      'publishedAt',
    ]) {
      expect(HUBRISE_PRODUCT_FIELDS).toContain(field)
    }
  })
})

describe('order query fields', () => {
  it('asks for the HubRise state only where HubRise is configured', () => {
    const document = `query { orders { id ${HUBRISE_ORDER_FIELDS} } }`
    expect(orderDocument(document, makeStatus())).toBe(document)
    expect(orderDocument(document, makeStatus({ available: false }))).toBe(
      'query { orders { id  } }',
    )
    expect(orderDocument(document, null)).toBe('query { orders { id  } }')
    for (const field of [
      'hubriseOrderId',
      'pushState',
      'pushedAt',
      'remoteStatus',
      'remoteTotal',
      'needsAttention',
    ]) {
      expect(HUBRISE_ORDER_FIELDS).toContain(field)
    }
  })
})

describe('platform prices', () => {
  const uber = {
    variantRef: 'uber',
    name: 'Uber Eats',
    markupPercent: 30,
    roundToCents: 10,
  }

  it('starts a row with a rounding of 10 cents', () => {
    expect(newPlatformPrice()).toEqual({
      variantRef: '',
      name: '',
      markupPercent: 0,
      roundToCents: 10,
    })
  })

  it('sends only what the API knows, trimmed', () => {
    const typed = {
      ...uber,
      variantRef: ' uber ',
      name: ' Uber Eats ',
      __typename: 'HubrisePlatformPrice',
    }
    expect(cleanPlatformPrices([typed])).toEqual([uber])
  })

  it('sees a change in any field, in the number of rows, not in the spaces', () => {
    expect(platformPricesChanged([uber], [{ ...uber, name: ' Uber Eats ' }])).toBe(false)
    expect(platformPricesChanged([uber], [{ ...uber, markupPercent: 25 }])).toBe(true)
    expect(platformPricesChanged([uber], [])).toBe(true)
  })
})
