// pages/terminals.vue: the handhelds list (status, serial, last seen), the revoke flow behind its confirmation, the
// enrollment dialog that reloads the list when it closes, and the admin gate. The logic is tested in
// tests/utils/posTerminals.test.ts and tests/composables/usePosTerminals.nuxt.test.ts.
// Run: `vp test run tests/pages/terminals.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { nextTick, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import type { User } from '~/types'
import type { PosDevice } from '~/utils/posTerminals'
import { settle } from '../helpers/settle'

const gqlFetch = vi.hoisted(() => vi.fn())
const navigateTo = vi.hoisted(() => vi.fn())

mockNuxtImport('useNuxtApp', async (original) => {
  const { withGqlFetch } = await import('../helpers/gqlFetch')
  return () => withGqlFetch(original(), gqlFetch)
})
mockNuxtImport('navigateTo', () => navigateTo)
mockNuxtImport('useIsMobile', () => () => ref(false))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

const active: PosDevice = {
  id: 'd-1',
  label: 'Comptoir',
  serialNumber: 'V3H-SERIAL-1',
  registeredAt: '2026-11-01T10:00:00Z',
  lastSeenAt: null,
  revokedAt: null,
}
const revoked: PosDevice = {
  id: 'd-2',
  label: 'Ancien',
  serialNumber: 'V3H-SERIAL-2',
  registeredAt: '2026-10-01T10:00:00Z',
  lastSeenAt: '2026-10-20T10:00:00Z',
  revokedAt: '2026-10-21T10:00:00Z',
}

interface TerminalsPageVm {
  showAdd: boolean
  revokeTarget: PosDevice | null
  confirmRevoke: () => Promise<void>
  createEnrollment: (label: string) => Promise<boolean>
  enrollment: { code: string; expiresAt: string } | null
}

const setUser = (isAdmin: boolean) => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only isAdmin matters to the page
  useAuthStore().setUser({ id: 'u-1', email: 'admin@example.test', isAdmin } as User)
}

const mountPage = async () => {
  const Page = (await import('~/pages/terminals.vue')).default
  const wrapper = await mountSuspended(Page)
  await settle()
  return { wrapper, vm: wrapper.vm as unknown as TerminalsPageVm }
}

const operations = () =>
  gqlFetch.mock.calls.map(([query]) => /(?:query|mutation) (\w+)/u.exec(String(query))?.[1])

beforeEach(() => {
  vi.resetAllMocks()
  setUser(true)
  gqlFetch.mockImplementation((query: string) => {
    if (query.includes('revokePosDevice')) {
      return Promise.resolve({ revokePosDevice: { ...active, revokedAt: '2026-11-03T12:00:00Z' } })
    }
    if (query.includes('createPosEnrollment')) {
      return Promise.resolve({
        createPosEnrollment: { code: 'ABCD-EFGH', expiresAt: '2099-01-01T00:00:00Z' },
      })
    }
    return Promise.resolve({ posDevices: [active, revoked] })
  })
})

describe('terminals page', () => {
  it('lists each handheld with its serial, status and last seen time', async () => {
    const { wrapper } = await mountPage()
    const rows = wrapper.findAll('[data-testid="terminal-row"]')
    expect(rows).toHaveLength(2)

    expect(rows[0]!.text()).toContain('Comptoir')
    expect(rows[0]!.text()).toContain('V3H-SERIAL-1')
    expect(rows[0]!.text()).toContain('terminals.status.active')
    expect(rows[0]!.text()).toContain('terminals.neverSeen')
    expect(rows[0]!.text()).toContain('terminals.revoke.button')

    expect(rows[1]!.text()).toContain('terminals.status.revoked')
    expect(rows[1]!.text()).toContain('terminals.lastSeen')
    expect(rows[1]!.text()).not.toContain('terminals.revoke.button')
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('shows the empty state', async () => {
    gqlFetch.mockResolvedValue({ posDevices: [] })
    const { wrapper } = await mountPage()
    expect(wrapper.text()).toContain('terminals.empty')
  })

  it('asks before revoking, then revokes the chosen handheld', async () => {
    const { wrapper, vm } = await mountPage()
    const revokeButton = wrapper
      .findAll('[data-testid="terminal-row"] button')
      .find((b) => b.text().includes('terminals.revoke.button'))!
    await revokeButton.trigger('click')
    expect(vm.revokeTarget?.id).toBe('d-1')
    expect(operations()).not.toContain('RevokePosDevice')

    await vm.confirmRevoke()
    await settle()
    expect(operations()).toContain('RevokePosDevice')
    expect(vm.revokeTarget).toBeNull()
    const rows = wrapper.findAll('[data-testid="terminal-row"]')
    expect(rows.every((row) => !row.text().includes('terminals.revoke.button'))).toBe(true)
  })

  it('does nothing when confirming without a chosen handheld', async () => {
    const { vm } = await mountPage()
    await vm.confirmRevoke()
    expect(operations()).not.toContain('RevokePosDevice')
  })

  it('reloads the list when the enrollment dialog closes, and forgets the code', async () => {
    const { vm } = await mountPage()
    vm.showAdd = true
    await nextTick()
    await vm.createEnrollment('Comptoir')
    expect(vm.enrollment?.code).toBe('ABCD-EFGH')
    const loadsBefore = operations().filter((op) => op === 'PosDevices').length

    vm.showAdd = false
    await nextTick()
    await settle()
    expect(operations().filter((op) => op === 'PosDevices')).toHaveLength(loadsBefore + 1)
    expect(vm.enrollment).toBeNull()
  })

  it('sends anyone but an admin back to the orders', async () => {
    setUser(false)
    await mountPage()
    expect(navigateTo).toHaveBeenCalledWith(expect.stringContaining('/orders'), { replace: true })
  })
})
