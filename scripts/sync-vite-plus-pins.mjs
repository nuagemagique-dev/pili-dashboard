// Moves the vite-plus pins of package.json and pnpm-workspace.yaml (see vite-plus-pins.mjs). Run by
// .github/workflows/dependabot-vite-plus.yml; prints `changed` or `unchanged`.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { declaredVitePlus, syncedPins } from './vite-plus-pins.mjs'

const pkgPath = new URL('../package.json', import.meta.url)
const workspacePath = new URL('../pnpm-workspace.yaml', import.meta.url)
const pkgText = readFileSync(pkgPath, 'utf8')
const workspaceText = readFileSync(workspacePath, 'utf8')
const declared = declaredVitePlus(pkgText)
if (declared === undefined) {
  throw new Error('package.json needs devDependencies.vite-plus')
}
// The vite-plus-core release that vite-plus depends on, as published (its version differs since vite-plus 1.7.0).
// Run outside the repo: npm refuses to run under a package.json whose devEngines asks for pnpm.
const coreSpec = execFileSync('npm', ['view', `vite-plus@${declared}`, 'dependencies.vite'], {
  cwd: tmpdir(),
  encoding: 'utf8',
}).trim()
const synced = syncedPins({
  pkgText,
  lockText: readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'),
  workspaceText,
  coreSpec,
})
if (synced.pkg === pkgText && synced.workspace === workspaceText) {
  console.log('unchanged')
} else {
  writeFileSync(pkgPath, synced.pkg)
  writeFileSync(workspacePath, synced.workspace)
  console.log('changed')
}
