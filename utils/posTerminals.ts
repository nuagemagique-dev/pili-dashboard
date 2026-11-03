/*
 * POS handhelds (Sunmi V3H running pili-handheld), as served by the posDevices /
 * createPosEnrollment / revokePosDevice GraphQL fields of pili-api.
 *
 * Enrollment: an admin creates a one-time code here, the handheld scans its QR code (or
 * the server and code are typed by hand), generates its own secret and redeems the code
 * at POST /api/v1/pos/devices/enroll.
 */
import { gqlErrorCodes } from '~/utils/orders'

export interface PosDevice {
  id: string
  label: string
  serialNumber: string
  registeredAt: string
  lastSeenAt: string | null
  revokedAt: string | null
}

export interface PosEnrollment {
  code: string
  expiresAt: string
}

/** The backend refuses a label outside 1..64 characters (USER_ERROR). */
export const POS_LABEL_MAX_LENGTH = 64

export const isValidPosLabel = (label: string): boolean => {
  const trimmed = label.trim()
  return trimmed.length > 0 && trimmed.length <= POS_LABEL_MAX_LENGTH
}

/** The API base URL without its trailing slashes: `https://host/api/v1/` -> `https://host/api/v1`. */
export const normalizeApiBaseUrl = (url: string): string => url.trim().replace(/\/+$/u, '')

/*
 * The QR code content, the contract with the handheld's parser:
 *   pili-pos://enroll?api=<encodeURIComponent(apiBaseUrl)>&code=<code>
 * Codes are A-Z/0-9 with a dash, so encoding the code leaves it unchanged.
 */
export const buildEnrollmentPayload = (apiBaseUrl: string, code: string): string =>
  `pili-pos://enroll?api=${encodeURIComponent(normalizeApiBaseUrl(apiBaseUrl))}&code=${encodeURIComponent(code)}`

/** The server to type on the handheld by hand: the host of the API base URL. */
export const apiHost = (apiBaseUrl: string): string => {
  const base = normalizeApiBaseUrl(apiBaseUrl)
  try {
    return new URL(base).host
  } catch {
    return base
  }
}

/** Whole seconds left before `expiresAt`, never negative. */
export const secondsUntil = (expiresAt: string, now: number): number =>
  Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000))

/** `m:ss`, the countdown shown under the code. */
export const formatCountdown = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

export const isActiveDevice = (device: PosDevice): boolean => device.revokedAt === null

/** Active first, then the newest enrollment first: the order the backend serves. */
export const sortDevices = (devices: PosDevice[]): PosDevice[] =>
  devices.toSorted((a, b) => {
    const active = Number(isActiveDevice(b)) - Number(isActiveDevice(a))
    if (active !== 0) return active
    return new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime()
  })

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60],
]

/** "il y a 3 minutes", "hier"... from `now`; under a minute reads as "maintenant". */
export const formatRelativeTime = (iso: string, now: number, locale: string): string => {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return format.format(0, 'second')
}

/** The message key for a failed createPosEnrollment. */
export const enrollmentErrorKey = (error: unknown): string =>
  gqlErrorCodes(error).includes('USER_ERROR')
    ? 'terminals.errors.invalidLabel'
    : 'terminals.errors.createFailed'

/** The message key for a failed revokePosDevice. */
export const revokeErrorKey = (error: unknown): string =>
  gqlErrorCodes(error).includes('NOT_FOUND')
    ? 'terminals.errors.notFound'
    : 'terminals.errors.revokeFailed'
