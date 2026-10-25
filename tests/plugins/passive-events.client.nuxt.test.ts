// passive-events plugin: every `touchstart` listener is registered as passive, so scrolling on the phone never waits for a handler.
// Run: `vp test run tests/plugins/passive-events.client.nuxt.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const { default: plugin } = await import('~/plugins/passive-events.client')

let original: typeof EventTarget.prototype.addEventListener
let underlying: ReturnType<typeof vi.fn>

beforeEach(() => {
  // oxlint-disable-next-line typescript/unbound-method -- it is called with its own `this` below
  original = EventTarget.prototype.addEventListener
  // The plugin wraps whatever addEventListener is current: wrap a recorder that still delegates.
  underlying = vi.fn(function (this: EventTarget, ...args: unknown[]) {
    ;(original as (...a: unknown[]) => void).apply(this, args)
  })
  EventTarget.prototype.addEventListener = underlying as unknown as typeof original
  ;(plugin as unknown as () => void)()
})

afterEach(() => {
  EventTarget.prototype.addEventListener = original
})

const listener = () => {}
const lastOptions = () => underlying.mock.calls.at(-1)?.[2]

describe('touchstart listeners', () => {
  it('become passive when registered without options', () => {
    new EventTarget().addEventListener('touchstart', listener)
    expect(lastOptions()).toEqual({ passive: true })
  })

  it('keep their capture flag when registered with a boolean', () => {
    const el = new EventTarget()
    el.addEventListener('touchstart', listener, true)
    expect(lastOptions()).toEqual({ capture: true, passive: true })
    el.addEventListener('touchstart', listener, false)
    expect(lastOptions()).toEqual({ capture: false, passive: true })
  })

  it('keep their other options when registered with an options object', () => {
    new EventTarget().addEventListener('touchstart', listener, { once: true, capture: true })
    expect(lastOptions()).toEqual({ once: true, capture: true, passive: true })
  })

  it('are made passive even if the caller asked for passive: false', () => {
    new EventTarget().addEventListener('touchstart', listener, { passive: false })
    expect(lastOptions()).toEqual({ passive: true })
  })

  it('treat null options as none', () => {
    new EventTarget().addEventListener('touchstart', listener, null as never)
    expect(lastOptions()).toEqual({ passive: true })
  })

  it('leave options of an unexpected type as they are', () => {
    new EventTarget().addEventListener('touchstart', listener, 'weird' as never)
    expect(lastOptions()).toBe('weird')
  })

  it('still receive the event on the element they were added to', () => {
    const el = new EventTarget()
    const handler = vi.fn()
    el.addEventListener('touchstart', handler)
    el.dispatchEvent(new Event('touchstart'))
    expect(handler).toHaveBeenCalledOnce()
    expect(underlying.mock.contexts.at(-1)).toBe(el)
  })
})

describe('other listeners', () => {
  it.each(['click', 'touchmove', 'scroll'])('are passed through untouched (%s)', (type) => {
    const el = new EventTarget()
    el.addEventListener(type, listener)
    expect(lastOptions()).toBeUndefined()
    el.addEventListener(type, listener, true)
    expect(lastOptions()).toBe(true)
    const options = { once: true }
    el.addEventListener(type, listener, options)
    expect(lastOptions()).toBe(options)
  })
})
