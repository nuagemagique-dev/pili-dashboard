// Moves the vite-plus pins of package.json and pnpm-workspace.yaml (see vite-plus-pins.mjs). Run by
// .github/workflows/dependabot-vite-plus.yml; prints `changed` or `unchanged`.
import { readFileSync, writeFileSync } from 'node:fs'
import { syncedPins } from './vite-plus-pins.mjs'

const pkgPath = new URL('../package.json', import.meta.url)
const workspacePath = new URL('../pnpm-workspace.yaml', import.meta.url)
const pkgText = readFileSync(pkgPath, 'utf8')
const workspaceText = readFileSync(workspacePath, 'utf8')
const synced = syncedPins(
  pkgText,
  readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'),
  workspaceText,
)
if (synced.pkg === pkgText && synced.workspace === workspaceText) {
  console.log('unchanged')
} else {
  writeFileSync(pkgPath, synced.pkg)
  writeFileSync(workspacePath, synced.workspace)
  console.log('changed')
}
