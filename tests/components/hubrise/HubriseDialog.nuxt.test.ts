// components/hubrise/HubriseDialog.vue: one dialog for the HubRise flows: a modal from md, a bottom sheet on phones. Both
// teleport their content to the body, so the test reads the document. Run: `vp test run tests/components/hubrise`.
import type * as VueI18NModule from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { settle } from '../../helpers/settle'

const mobile = vi.hoisted(() => ({ value: false }))

mockNuxtImport('useIsMobile', () => () => ref(mobile.value))
vi.mock('vue-i18n', async (importOriginal) => {
  const { fakeI18n } = await import('../../helpers/i18n')
  return { ...(await importOriginal<typeof VueI18NModule>()), useI18n: fakeI18n }
})

// Compiled once at load: the first mount would otherwise eat the test timeout.
const Dialog = (await import('~/components/hubrise/HubriseDialog.vue')).default

const mountDialog = async (
  props: { open: boolean; title: string; description?: string },
  withFooter = true,
) => {
  const wrapper = await mountSuspended(Dialog, {
    props,
    slots: {
      default: () => 'the body',
      ...(withFooter ? { footer: () => 'the footer' } : {}),
    },
  })
  await settle()
  return wrapper
}

beforeEach(() => {
  mobile.value = false
  document.body.innerHTML = ''
})

describe.each([
  ['a modal', false],
  ['a bottom sheet', true],
])('on a screen that gets %s', (_name, isMobile) => {
  beforeEach(() => {
    mobile.value = isMobile
  })

  it('shows the title, the body and the footer when open', async () => {
    await mountDialog({ open: true, title: 'Publish', description: 'About to publish' })
    const text = document.body.textContent
    expect(text).toContain('Publish')
    expect(text).toContain('the body')
    expect(text).toContain('the footer')
  })

  it('shows nothing when closed', async () => {
    await mountDialog({ open: false, title: 'Publish' })
    expect(document.body.textContent).not.toContain('the body')
  })

  it('works without a footer or a description', async () => {
    await mountDialog({ open: true, title: 'Publish' }, false)
    expect(document.body.textContent).toContain('the body')
    expect(document.body.textContent).not.toContain('the footer')
  })

  it('asks its owner to close when dismissed with Escape', async () => {
    const wrapper = await mountDialog({ open: true, title: 'Publish' })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })
})
