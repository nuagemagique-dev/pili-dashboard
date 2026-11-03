// usePosTerminals: the handhelds list (loaded on mount), the one-time enrollment code and the revoke action of the
// terminals page; useEnrollmentCountdown: the seconds left before the code expires. The GraphQL transport is the
// boundary.
// Run: `vp test run tests/composables/usePosTerminals.nuxt.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { nextTick, ref } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import type { PosDevice } from '~/utils/posTerminals'
import { mountComposable } from '../helpers/mountComposable'
import { settle } from '../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})

const { usePosTerminals, useEnrollmentCountdown } = await import('~/composables/usePosTerminals')

const device = (overrides: Partial<PosDevice> = {}): PosDevice => ({
  id: '1',
  label: 'Comptoir',
  serialNumber: 'V3H-0001',
  registeredAt: '2026-11-01T10:00:00Z',
  lastSeenAt: '2026-11-03T11:58:00Z',
  revokedAt: null,
  ...overrides,
})

const counter = device()
const kitchen = device({ id: '2', label: 'Cuisine', registeredAt: '2026-11-02T10:00:00Z' })

// Only the clock and intervals: `settle()` still needs real timeouts.
const fakeClock = (now: Date) =>
  vi.useFakeTimers({ now, toFake: ['Date', 'setInterval', 'clearInterval'] })

const gqlError = (code: string) => [{ message: code, extensions: { code } }]

/** Answers each operation by its name, like the backend would. */
const backend = (answers: Record<string, () => unknown>) => {
  gqlFetch.mockImplementation((query: string) => {
    const name = /(?:query|mutation) (\w+)/u.exec(query)?.[1] ?? ''
    const answer = answers[name]
    return answer ? Promise.resolve().then(answer) : Promise.reject(new Error(`unexpected ${name}`))
  })
}

const mountTerminals = async () => {
  const mounted = mountComposable(() => usePosTerminals())
  await settle()
  return mounted
}

beforeEach(() => {
  vi.resetAllMocks()
  backend({ PosDevices: () => ({ posDevices: [counter, kitchen] }) })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('list', () => {
  it('loads the handhelds when mounted, active and newest first', async () => {
    const { result } = await mountTerminals()
    expect(result.loading.value).toBe(false)
    expect(result.loadError.value).toBe(false)
    expect(result.devices.value.map((d) => d.id)).toEqual(['2', '1'])
    const [query] = gqlFetch.mock.calls[0]!
    for (const field of ['label', 'serialNumber', 'registeredAt', 'lastSeenAt', 'revokedAt']) {
      expect(query).toContain(field)
    }
  })

  it('flags a failed load and recovers on refresh', async () => {
    backend({
      PosDevices: () => {
        throw new Error('offline')
      },
    })
    const { result } = await mountTerminals()
    expect(result.loadError.value).toBe(true)
    expect(result.loading.value).toBe(false)

    backend({ PosDevices: () => ({ posDevices: [counter] }) })
    await result.refresh()
    expect(result.loadError.value).toBe(false)
    expect(result.devices.value).toEqual([counter])
  })

  it('keeps the list when the transport answers nothing (session ended)', async () => {
    const { result } = await mountTerminals()
    backend({ PosDevices: () => null })
    await result.refresh()
    expect(result.devices.value).toHaveLength(2)
  })

  it('moves `now` forward every 30 s for the "last seen" times, and stops when unmounted', async () => {
    fakeClock(new Date('2026-11-03T12:00:00Z'))
    const { result, unmount } = await mountTerminals()
    const start = result.now.value
    vi.advanceTimersByTime(30_000)
    expect(result.now.value).toBe(start + 30_000)
    unmount()
    vi.advanceTimersByTime(60_000)
    expect(result.now.value).toBe(start + 30_000)
  })
})

describe('enrollment', () => {
  it('asks for a code with the trimmed label and keeps it', async () => {
    const enrollment = { code: 'ABCD-EFGH', expiresAt: '2026-11-03T12:15:00Z' }
    backend({
      PosDevices: () => ({ posDevices: [] }),
      CreatePosEnrollment: () => ({ createPosEnrollment: enrollment }),
    })
    const { result } = await mountTerminals()
    await expect(result.createEnrollment('  Comptoir ')).resolves.toBe(true)
    expect(result.enrollment.value).toEqual(enrollment)
    expect(result.createError.value).toBe('')
    const call = gqlFetch.mock.calls.find(([q]) => String(q).includes('createPosEnrollment'))!
    expect(call[1]).toEqual({ variables: { label: 'Comptoir' } })
  })

  it('explains a refused label', async () => {
    // The list on mount, then the refused mutation.
    gqlFetch
      .mockReset()
      .mockResolvedValueOnce({ posDevices: [] })
      .mockRejectedValueOnce(gqlError('USER_ERROR'))
    const { result } = await mountTerminals()
    await expect(result.createEnrollment('x')).resolves.toBe(false)
    expect(result.enrollment.value).toBeNull()
    expect(result.createError.value).toBe('terminals.errors.invalidLabel')
  })

  it('forgets the code and reloads the list when the dialog closes', async () => {
    backend({
      PosDevices: () => ({ posDevices: [] }),
      CreatePosEnrollment: () => ({
        createPosEnrollment: { code: 'ABCD-EFGH', expiresAt: '2026-11-03T12:15:00Z' },
      }),
    })
    const { result } = await mountTerminals()
    await result.createEnrollment('Comptoir')

    backend({ PosDevices: () => ({ posDevices: [counter] }) })
    await result.closeEnrollment()
    expect(result.enrollment.value).toBeNull()
    expect(result.devices.value).toEqual([counter])
  })
})

describe('revoke', () => {
  it('revokes the handheld and moves it below the active ones', async () => {
    const revoked = { ...kitchen, revokedAt: '2026-11-03T12:00:00Z' }
    backend({
      PosDevices: () => ({ posDevices: [counter, kitchen] }),
      RevokePosDevice: () => ({ revokePosDevice: revoked }),
    })
    const { result } = await mountTerminals()
    expect(result.devices.value.map((d) => d.id)).toEqual(['2', '1'])

    const pending = result.revoke('2')
    expect(result.revokingId.value).toBe('2')
    await expect(pending).resolves.toBe(true)
    expect(result.revokingId.value).toBe('')
    expect(result.devices.value.map((d) => d.id)).toEqual(['1', '2'])
    expect(result.devices.value[1]!.revokedAt).toBe('2026-11-03T12:00:00Z')
    const call = gqlFetch.mock.calls.find(([q]) => String(q).includes('revokePosDevice'))!
    expect(call[1]).toEqual({ variables: { id: '2' } })
  })

  it('explains an unknown handheld and leaves the list alone', async () => {
    // The list on mount, then the refused mutation.
    gqlFetch
      .mockReset()
      .mockResolvedValueOnce({ posDevices: [counter] })
      .mockRejectedValueOnce(gqlError('NOT_FOUND'))
    const { result } = await mountTerminals()
    await expect(result.revoke('1')).resolves.toBe(false)
    expect(result.revokeError.value).toBe('terminals.errors.notFound')
    expect(result.revokingId.value).toBe('')
    expect(result.devices.value).toEqual([counter])
  })
})

describe('useEnrollmentCountdown', () => {
  it('is 0 and not expired without a code', () => {
    const { result } = mountComposable(() => useEnrollmentCountdown(ref<string | null>(null)))
    expect(result.secondsLeft.value).toBe(0)
    expect(result.expired.value).toBe(false)
  })

  it('ticks down every second and expires at zero', () => {
    fakeClock(new Date('2026-11-03T12:14:58Z'))
    const expiresAt = ref<string | null>('2026-11-03T12:15:00Z')
    const { result } = mountComposable(() => useEnrollmentCountdown(expiresAt))
    expect(result.secondsLeft.value).toBe(2)
    expect(result.expired.value).toBe(false)

    vi.advanceTimersByTime(1000)
    expect(result.secondsLeft.value).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(result.secondsLeft.value).toBe(0)
    expect(result.expired.value).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restarts for a new code', async () => {
    fakeClock(new Date('2026-11-03T12:20:00Z'))
    const expiresAt = ref<string | null>('2026-11-03T12:15:00Z')
    const { result } = mountComposable(() => useEnrollmentCountdown(expiresAt))
    expect(result.expired.value).toBe(true)

    expiresAt.value = '2026-11-03T12:35:00Z'
    await nextTick()
    expect(result.secondsLeft.value).toBe(900)
    expect(result.expired.value).toBe(false)

    expiresAt.value = null
    await nextTick()
    expect(result.secondsLeft.value).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
