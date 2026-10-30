import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * The dashboard's own French copy, so a spec asserts the label on screen without hard-coding it:
 * `message('orders.status.preparing')`. A missing key fails the spec (the label was renamed or removed).
 */
const fr: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../locales/fr.json', import.meta.url)), 'utf8'),
)

export function message(key: string, values: Record<string, string | number> = {}): string {
  let node: unknown = fr
  for (const part of key.split('.')) {
    node =
      node !== null && typeof node === 'object'
        ? (node as Record<string, unknown>)[part]
        : undefined
  }
  if (typeof node !== 'string') throw new Error(`no French message "${key}" in locales/fr.json`)
  return node.replaceAll(/\{(\w+)\}/gu, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  )
}
