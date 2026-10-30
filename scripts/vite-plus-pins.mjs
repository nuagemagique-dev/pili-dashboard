// Dependabot bumps vite-plus and @voidzero-dev/* as one group, but some pins stay behind: the `vite` alias (vite-plus-core
// of the same release, declared in package.json devDependencies and in the pnpm-workspace.yaml overrides) and
// @vitest/coverage-v8 and vitest (the vitest vite-plus bundles). .github/workflows/dependabot-vite-plus.yml moves them on the Dependabot PR with sync-vite-plus-pins.mjs.

/**
 * @typedef {object} Manifest
 * @property {Record<string, string>} [devDependencies]
 */

/**
 * @typedef {object} Pins
 * @property {string} pkg package.json text
 * @property {string} workspace pnpm-workspace.yaml text
 */

/**
 * @param {string} text JSON text
 * @returns {Manifest}
 */
function parseManifest(text) {
  /** @type {unknown} */
  const value = JSON.parse(text)
  return typeof value === 'object' && value !== null ? { ...value } : {}
}

/**
 * Replaces the one `"name": "from"` entry of a package.json text, keeping the rest of the file byte for byte.
 * @param {string} text package.json
 * @param {string} name entry name
 * @param {{ from: string, to: string }} change current and new value
 * @returns {string}
 */
function replaceEntry(text, name, { from, to }) {
  const entry = `${JSON.stringify(name)}: ${JSON.stringify(from)}`
  if (text.split(entry).length !== 2) {
    throw new Error(`expected one ${entry} in package.json`)
  }
  return text.replace(entry, `${JSON.stringify(name)}: ${JSON.stringify(to)}`)
}

const VITE_OVERRIDE = /^(?<key> {2}vite: )(?<value>\S+)$/mu

/**
 * The vitest release that the vite-plus snapshot of pnpm-lock.yaml depends on.
 * @param {string} lockText pnpm-lock.yaml, as Dependabot left it
 * @param {string} vitePlus declared vite-plus version
 * @returns {string | undefined}
 */
function bundledVitest(lockText, vitePlus) {
  const snapshots = lockText.slice(lockText.lastIndexOf('\nsnapshots:'))
  const snapshot = new RegExp(
    `^ {2}vite-plus@${vitePlus.replace(/\W/gu, '\\$&')}[^\\n]*\\n {4}dependencies:\\n(?<deps>(?: {6}[^\\n]*\\n)+)`,
    'mu',
  ).exec(snapshots)
  return /^ {6}vitest: (?<version>[^\s(]+)/mu.exec(snapshot?.groups?.deps ?? '')?.groups?.version
}

/**
 * package.json and pnpm-workspace.yaml texts with the `vite` alias, @vitest/coverage-v8 and vitest moved to the
 * vite-plus release package.json declares. Returns the texts unchanged when both pins already hold.
 * @param {string} pkgText package.json
 * @param {string} lockText pnpm-lock.yaml, as Dependabot left it
 * @param {string} workspaceText pnpm-workspace.yaml
 * @returns {Pins}
 */
export function syncedPins(pkgText, lockText, workspaceText) {
  const pkg = parseManifest(pkgText)
  const declared = pkg.devDependencies?.['vite-plus']
  const override = VITE_OVERRIDE.exec(workspaceText)?.groups?.value
  if (declared === undefined || override === undefined) {
    throw new Error(
      'package.json needs devDependencies.vite-plus and pnpm-workspace.yaml overrides.vite',
    )
  }

  let workspace = workspaceText
  const core = `npm:@voidzero-dev/vite-plus-core@${declared}`
  if (override !== core) {
    workspace = workspace.replace(VITE_OVERRIDE, `$<key>${core}`)
  }

  let text = pkgText
  const alias = pkg.devDependencies?.vite
  if (alias !== undefined && alias !== core) {
    text = replaceEntry(text, 'vite', { from: alias, to: core })
  }

  const vitest = bundledVitest(lockText, declared)
  for (const name of ['@vitest/coverage-v8', 'vitest']) {
    const pinned = pkg.devDependencies?.[name]
    if (pinned === undefined) {
      continue
    }
    if (vitest === undefined) {
      throw new Error(`pnpm-lock.yaml has no vitest dependency for vite-plus@${declared}`)
    }
    if (pinned !== vitest) {
      text = replaceEntry(text, name, { from: pinned, to: vitest })
    }
  }
  return { pkg: text, workspace }
}
