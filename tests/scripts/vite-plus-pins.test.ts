import { describe, expect, it } from 'vite-plus/test'
import { syncedPins } from '../../scripts/vite-plus-pins.mjs'

const core = (version: string) => `npm:@voidzero-dev/vite-plus-core@${version}`
const pkg = (vitePlus: string, coverage?: string, vite?: string) =>
  `${JSON.stringify(
    {
      name: 'app',
      devDependencies: {
        ...(coverage === undefined ? {} : { '@vitest/coverage-v8': coverage, vitest: coverage }),
        ...(vite === undefined ? {} : { vite }),
        'vite-plus': vitePlus,
      },
    },
    null,
    2,
  )}\n`
const workspace = (override: string) =>
  `allowBuilds:\n  esbuild: true\noverrides:\n  vite: ${override}\n`
// The shape of a pnpm 12 lockfile: an environment document first, then the project one.
const lock = (vitePlus: string, vitest: string) =>
  [
    '---',
    'snapshots:',
    '  vite-plus@0.0.1:',
    '    dependencies:',
    '      vitest: 0.0.1',
    '',
    '---',
    'snapshots:',
    '',
    `  vite-plus@${vitePlus}(@types/node@24.19.2)(@vitest/ui@${vitest}):`,
    '    dependencies:',
    "      '@oxc-project/runtime': 0.155.0",
    `      vitest: ${vitest}(@types/node@24.19.2)(@vitest/ui@${vitest})`,
    '    optionalDependencies:',
    `      vitest: 9.9.9`,
    '',
  ].join('\n')

describe('syncedPins', () => {
  it('moves the override and coverage-v8 to the release a Dependabot bump declared', () => {
    expect(
      syncedPins(pkg('1.5.0', '5.0.5'), lock('1.5.0', '5.1.0'), workspace(core('1.4.0'))),
    ).toEqual({ pkg: pkg('1.5.0', '5.1.0'), workspace: workspace(core('1.5.0')) })
  })

  it('moves the vite alias of devDependencies with the override', () => {
    expect(
      syncedPins(
        pkg('1.5.0', '5.0.5', core('1.4.0')),
        lock('1.5.0', '5.0.5'),
        workspace(core('1.4.0')),
      ),
    ).toEqual({
      pkg: pkg('1.5.0', '5.0.5', core('1.5.0')),
      workspace: workspace(core('1.5.0')),
    })
  })

  it('leaves pins that hold untouched', () => {
    expect(
      syncedPins(pkg('1.4.0', '5.0.5'), lock('1.4.0', '5.0.5'), workspace(core('1.4.0'))),
    ).toEqual({ pkg: pkg('1.4.0', '5.0.5'), workspace: workspace(core('1.4.0')) })
  })

  it('moves only the override when the bundled vitest did not change', () => {
    expect(
      syncedPins(pkg('1.4.1', '5.0.5'), lock('1.4.1', '5.0.5'), workspace(core('1.4.0'))),
    ).toEqual({ pkg: pkg('1.4.1', '5.0.5'), workspace: workspace(core('1.4.1')) })
  })

  it('needs no lockfile entry without coverage-v8', () => {
    expect(syncedPins(pkg('1.5.0'), '', workspace(core('1.4.0')))).toEqual({
      pkg: pkg('1.5.0'),
      workspace: workspace(core('1.5.0')),
    })
  })

  it('refuses a workspace file without the override', () => {
    expect(() => syncedPins(pkg('1.4.0'), '', 'allowBuilds:\n  esbuild: true\n')).toThrow(
      'needs devDependencies.vite-plus and pnpm-workspace.yaml overrides.vite',
    )
  })

  it('refuses a package.json without vite-plus', () => {
    expect(() =>
      syncedPins(JSON.stringify({ devDependencies: {} }), '', workspace(core('1.4.0'))),
    ).toThrow('needs devDependencies.vite-plus')
  })

  it('refuses a lockfile without the bundled vitest', () => {
    expect(() => syncedPins(pkg('1.5.0', '5.0.5'), '', workspace(core('1.4.0')))).toThrow(
      'no vitest dependency for vite-plus@1.5.0',
    )
  })

  it('refuses an ambiguous coverage-v8 entry rather than guessing', () => {
    const twice = pkg('1.5.0', '5.0.5').replace(
      '"name": "app"',
      '"name": "app", "x": {"@vitest/coverage-v8": "5.0.5"}',
    )
    expect(() => syncedPins(twice, lock('1.5.0', '5.1.0'), workspace(core('1.5.0')))).toThrow(
      'expected one',
    )
  })
})
