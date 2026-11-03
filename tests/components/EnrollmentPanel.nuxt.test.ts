// components/terminals/EnrollmentPanel.vue: the label form, then the one-time code as large text, the server to type by
// hand, the countdown and a QR code generated in the browser from the enrollment payload.
// Run: `vp test run tests/components/EnrollmentPanel.nuxt.test.ts`.
import type * as VueI18NModule from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import EnrollmentPanel from '~/components/terminals/EnrollmentPanel.vue'

const renderSVG = vi.hoisted(() => vi.fn(() => '<svg data-qr="1"></svg>'))
vi.mock('uqr', () => ({ renderSVG }))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

const API = 'https://tokyosushibarliege.be/api/v1'

afterEach(() => {
  vi.useRealTimers()
})

describe('EnrollmentPanel', () => {
  it('asks for a label first and emits it on submit', async () => {
    const wrapper = await mountSuspended(EnrollmentPanel, {
      props: { enrollment: null, apiBaseUrl: API },
    })
    expect(wrapper.text()).toContain('terminals.add.labelHint')
    await wrapper.find('input').setValue('Comptoir')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('create')).toEqual([['Comptoir']])
  })

  it('does not emit for a blank label, and shows the create error', async () => {
    const wrapper = await mountSuspended(EnrollmentPanel, {
      props: { enrollment: null, apiBaseUrl: API, error: 'terminals.errors.invalidLabel' },
    })
    await wrapper.find('input').setValue('   ')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('create')).toBeUndefined()
    expect(wrapper.text()).toContain('terminals.errors.invalidLabel')
  })

  it('shows the code, the server, the countdown and the QR code of the exact payload', async () => {
    vi.useFakeTimers({
      now: new Date('2026-11-03T12:00:00Z'),
      toFake: ['Date', 'setInterval', 'clearInterval'],
    })
    const wrapper = await mountSuspended(EnrollmentPanel, {
      props: {
        enrollment: { code: 'ABCD-EFGH', expiresAt: '2026-11-03T12:15:00Z' },
        apiBaseUrl: `${API}/`,
      },
    })
    expect(wrapper.find('[data-testid="enrollment-code"]').text()).toBe('ABCD-EFGH')
    expect(wrapper.find('[data-testid="enrollment-server"]').text()).toBe('tokyosushibarliege.be')
    expect(wrapper.find('[data-testid="enrollment-countdown"]').text()).toBe(
      'terminals.add.expiresIn{"time":"15:00"}',
    )
    expect(renderSVG).toHaveBeenCalledWith(
      'pili-pos://enroll?api=https%3A%2F%2Ftokyosushibarliege.be%2Fapi%2Fv1&code=ABCD-EFGH',
      { border: 0 },
    )
    expect(wrapper.find('[data-qr="1"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('terminals.add.instructions')
  })

  it('offers a new code once expired, and closes on done', async () => {
    const wrapper = await mountSuspended(EnrollmentPanel, {
      props: {
        enrollment: { code: 'ABCD-EFGH', expiresAt: '2000-01-01T00:00:00Z' },
        apiBaseUrl: API,
      },
    })
    expect(wrapper.text()).toContain('terminals.add.expired')
    expect(wrapper.find('[data-testid="enrollment-countdown"]').exists()).toBe(false)

    const buttons = wrapper.findAll('button')
    await buttons.find((b) => b.text().includes('terminals.add.newCode'))!.trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)
    await buttons.find((b) => b.text().includes('common.done'))!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
