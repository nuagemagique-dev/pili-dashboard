// utils/posTerminals: the QR payload the handheld parses (its contract), the server shown for typing by hand, the
// countdown to the code's expiry, the list order, the "last seen" time and the error messages.
// Run: `vp test run tests/utils/posTerminals.test.ts`.
import { describe, expect, it } from 'vite-plus/test'
import {
  POS_LABEL_MAX_LENGTH,
  apiHost,
  buildEnrollmentPayload,
  enrollmentErrorKey,
  formatCountdown,
  formatRelativeTime,
  isActiveDevice,
  isValidPosLabel,
  normalizeApiBaseUrl,
  revokeErrorKey,
  secondsUntil,
  sortDevices,
  type PosDevice,
} from '~/utils/posTerminals'

const device = (overrides: Partial<PosDevice> = {}): PosDevice => ({
  id: '1',
  label: 'Comptoir',
  serialNumber: 'V3H-0001',
  registeredAt: '2026-11-01T10:00:00Z',
  lastSeenAt: null,
  revokedAt: null,
  ...overrides,
})

describe('buildEnrollmentPayload', () => {
  it('encodes the API base URL as one query value and appends the code', () => {
    expect(buildEnrollmentPayload('https://tokyosushibarliege.be/api/v1', 'ABCD-EFGH')).toBe(
      'pili-pos://enroll?api=https%3A%2F%2Ftokyosushibarliege.be%2Fapi%2Fv1&code=ABCD-EFGH',
    )
  })

  it('drops trailing slashes and surrounding spaces from the base URL', () => {
    expect(buildEnrollmentPayload(' https://example.test/api/v1// ', 'WXYZ-2345')).toBe(
      'pili-pos://enroll?api=https%3A%2F%2Fexample.test%2Fapi%2Fv1&code=WXYZ-2345',
    )
  })

  it('round-trips through URL parsing to the exact base URL and code', () => {
    const base = 'http://192.168.1.20:8081/api/v1?x=1&y=2'
    const url = new URL(buildEnrollmentPayload(base, 'ABCD-EFGH'))
    expect(url.protocol).toBe('pili-pos:')
    expect(url.searchParams.get('api')).toBe(base)
    expect(url.searchParams.get('code')).toBe('ABCD-EFGH')
    expect([...url.searchParams.keys()]).toEqual(['api', 'code'])
  })
})

describe('normalizeApiBaseUrl and apiHost', () => {
  it('keeps a clean base URL as it is', () => {
    expect(normalizeApiBaseUrl('https://tokyosushibarliege.be/api/v1')).toBe(
      'https://tokyosushibarliege.be/api/v1',
    )
  })

  it('shows the host, with its port when there is one', () => {
    expect(apiHost('https://tokyosushibarliege.be/api/v1/')).toBe('tokyosushibarliege.be')
    expect(apiHost('http://localhost:8081/api/v1')).toBe('localhost:8081')
  })

  it('falls back to the raw value when it is not a URL', () => {
    expect(apiHost('not a url/')).toBe('not a url')
  })
})

describe('countdown', () => {
  const expiresAt = '2026-11-03T12:15:00Z'
  const at = (iso: string) => new Date(iso).getTime()

  it('counts whole seconds left, rounding up', () => {
    expect(secondsUntil(expiresAt, at('2026-11-03T12:00:00Z'))).toBe(900)
    expect(secondsUntil(expiresAt, at('2026-11-03T12:14:59.200Z'))).toBe(1)
  })

  it('stops at zero once expired', () => {
    expect(secondsUntil(expiresAt, at('2026-11-03T12:15:00Z'))).toBe(0)
    expect(secondsUntil(expiresAt, at('2026-11-03T13:00:00Z'))).toBe(0)
  })

  it('formats m:ss', () => {
    expect(formatCountdown(900)).toBe('15:00')
    expect(formatCountdown(61)).toBe('1:01')
    expect(formatCountdown(9)).toBe('0:09')
    expect(formatCountdown(-3)).toBe('0:00')
    expect(formatCountdown(4.7)).toBe('0:04')
  })
})

describe('labels', () => {
  it('accepts 1 to 64 characters once trimmed', () => {
    expect(isValidPosLabel('Comptoir')).toBe(true)
    expect(isValidPosLabel('x'.repeat(POS_LABEL_MAX_LENGTH))).toBe(true)
    expect(isValidPosLabel('   ')).toBe(false)
    expect(isValidPosLabel('')).toBe(false)
    expect(isValidPosLabel('x'.repeat(POS_LABEL_MAX_LENGTH + 1))).toBe(false)
  })
})

describe('devices', () => {
  it('is active until revoked', () => {
    expect(isActiveDevice(device())).toBe(true)
    expect(isActiveDevice(device({ revokedAt: '2026-11-02T10:00:00Z' }))).toBe(false)
  })

  it('sorts active first, then newest first, without touching the input', () => {
    const old = device({ id: 'old', registeredAt: '2026-10-01T10:00:00Z' })
    const recent = device({ id: 'recent', registeredAt: '2026-11-02T10:00:00Z' })
    const revoked = device({
      id: 'revoked',
      registeredAt: '2026-11-03T10:00:00Z',
      revokedAt: '2026-11-03T11:00:00Z',
    })
    const input = [revoked, old, recent]
    expect(sortDevices(input).map((d) => d.id)).toEqual(['recent', 'old', 'revoked'])
    expect(input.map((d) => d.id)).toEqual(['revoked', 'old', 'recent'])
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-11-03T12:00:00Z').getTime()

  it('reads a few seconds ago as now', () => {
    expect(formatRelativeTime('2026-11-03T11:59:40Z', now, 'en')).toBe('now')
  })

  it('picks minutes, hours or days', () => {
    expect(formatRelativeTime('2026-11-03T11:57:00Z', now, 'en')).toBe('3 minutes ago')
    expect(formatRelativeTime('2026-11-03T10:00:00Z', now, 'en')).toBe('2 hours ago')
    expect(formatRelativeTime('2026-11-02T12:00:00Z', now, 'en')).toBe('yesterday')
    expect(formatRelativeTime('2026-10-29T12:00:00Z', now, 'en')).toBe('5 days ago')
  })

  it('speaks the locale', () => {
    expect(formatRelativeTime('2026-11-03T11:57:00Z', now, 'fr')).toBe('il y a 3 minutes')
  })
})

describe('error messages', () => {
  const gqlError = (code: string) => [{ message: 'x', extensions: { code } }]

  it('explains a refused label, anything else is a generic failure', () => {
    expect(enrollmentErrorKey(gqlError('USER_ERROR'))).toBe('terminals.errors.invalidLabel')
    expect(enrollmentErrorKey(gqlError('INTERNAL'))).toBe('terminals.errors.createFailed')
    expect(enrollmentErrorKey(new Error('offline'))).toBe('terminals.errors.createFailed')
  })

  it('explains an unknown handheld, anything else is a generic failure', () => {
    expect(revokeErrorKey(gqlError('NOT_FOUND'))).toBe('terminals.errors.notFound')
    expect(revokeErrorKey(gqlError('FORBIDDEN'))).toBe('terminals.errors.revokeFailed')
  })
})
