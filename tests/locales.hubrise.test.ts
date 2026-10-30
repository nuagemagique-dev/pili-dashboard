// The HubRise screens: every code the server can answer and every literal key the sources use has a message in
// each language, so no admin ever reads a raw key.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import {
  HUBRISE_ERROR_CODES,
  HUBRISE_PUBLISH_ERROR_CODES,
  OAUTH_OUTCOMES,
  ORDER_ATTENTION_CODES,
  attentionKey,
  hubriseErrorKey,
  publishErrorKey,
  statusBanners,
  planDirectionChange,
} from '../utils/hubrise'
import { makePublish, makeStatus } from './fixtures/hubrise'

const root = resolve(import.meta.dirname, '..')
const LOCALES = ['fr', 'en', 'nl', 'zh'] as const
const load = (name: string) =>
  JSON.parse(readFileSync(resolve(root, 'locales', `${name}.json`), 'utf8')) as object

const lookup = (messages: object, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages,
    )

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const sourceKeys = (): string[] => {
  const files = [
    ...walk(resolve(root, 'components')),
    ...walk(resolve(root, 'pages')),
    resolve(root, 'layouts/default.vue'),
  ].filter((file) => file.endsWith('.vue'))
  const found = new Set<string>()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(
      /\bt\(\s*'((?:hubrise|products\.hubrise|orders\.hubrise|navigation\.hubrise)[\w.]*)'/gu,
    )) {
      found.add(match[1]!)
    }
  }
  return [...found]
}

describe.each(LOCALES)('HubRise messages in %s', (name) => {
  const messages = load(name)
  const has = (key: string) => {
    const value = lookup(messages, key)
    expect(typeof value === 'string' && /\S/u.test(value), `${name}: ${key}`).toBe(true)
  }

  it('has a message for every server error code and the generic one', () => {
    for (const code of HUBRISE_ERROR_CODES) has(hubriseErrorKey(code))
    has(hubriseErrorKey(null))
  })

  it('has a message for every publish error code', () => {
    for (const code of HUBRISE_PUBLISH_ERROR_CODES) has(publishErrorKey(code))
  })

  it('has a title and a body for every order attention code and the unknown one', () => {
    for (const code of [...ORDER_ATTENTION_CODES, 'SOMETHING_NEW']) {
      has(`${attentionKey(code)}.title`)
      has(`${attentionKey(code)}.body`)
    }
  })

  it('has a message for every OAuth outcome', () => {
    for (const outcome of OAUTH_OUTCOMES) has(`hubrise.oauth.${outcome}`)
  })

  it('has a message for every banner', () => {
    const status = makeStatus({
      authErrorAt: '2026-10-24T10:00:00Z',
      relinkRequired: true,
      catalogPendingReview: true,
      catalogUpdateAvailable: true,
    })
    const publishing = makeStatus({
      catalogDirection: 'PUBLISH',
      publish: makePublish({
        needsReconnectForWrite: true,
        accountCatalogDetected: true,
        externalChangeAt: '2026-10-24T10:00:00Z',
        lastErrorCode: 'REJECTED',
      }),
    })
    const banners = [
      ...statusBanners(status),
      ...statusBanners({
        ...publishing,
        publish: { ...publishing.publish, lastErrorCode: 'REMOVALS_NEED_CONFIRM' },
      }),
    ]
    expect(banners.length).toBeGreaterThan(5)
    for (const banner of banners) has(banner.key)
  })

  it('has a message for every direction move', () => {
    const directions = ['NONE', 'IMPORT', 'PUBLISH'] as const
    for (const from of directions) {
      for (const to of directions) {
        if (from === to) continue
        const plan = planDirectionChange(makeStatus({ catalogDirection: from }), to)
        if (plan.confirmKey) has(plan.confirmKey)
      }
    }
  })

  it('has every literal key the HubRise screens use', () => {
    const keys = sourceKeys()
    expect(keys.length).toBeGreaterThan(100)
    for (const key of keys) has(key)
  })

  it('uses no em-dash', () => {
    expect(JSON.stringify(messages)).not.toContain('—')
  })
})
