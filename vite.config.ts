import { resolve } from 'node:path'
import { defineConfig } from 'vite-plus'
import { runtimeFlagsPlugin } from './tests/support/flags'

const root = (path: string) => resolve(import.meta.dirname, path)
const excluded = ['**/node_modules/**', '**/.nuxt/**', '**/.output/**']

// The files of the critical flows (auth, the GraphQL client, the orders store and the order actions and logic, money,
// receipt printing, the date helpers) must not regress, whatever the rest gains: each is held at the level it reaches
// today, 100 % lines, statements, functions and branches, except the few arms of utils/utils.ts measured below 100
// (listed in docs/testing.md). Only ever raise them.
const full = { statements: 100, branches: 100, functions: 100, lines: 100 }
const criticalFiles = {
  'composables/useOidc.ts': full,
  'composables/useAuthCallback.ts': full,
  'composables/useZitadelApi.ts': full,
  'composables/useLoginFlow.ts': full,
  'composables/useGqlQuery.ts': full,
  'composables/useGqlMutation.ts': full,
  'composables/useGqlSubscription.ts': full,
  'composables/useOrderActions.ts': full,
  'stores/auth.ts': full,
  'stores/orders.ts': full,
  'middleware/auth.global.ts': full,
  'plugins/api.ts': full,
  'plugins/gqlFetch.ts': full,
  'plugins/auth-sync.client.ts': full,
  'utils/utils.ts': { ...full, branches: 96.07 },
  'utils/authReturn.ts': full,
  'utils/silentRenewError.ts': full,
  'utils/orders.ts': full,
  'utils/money.ts': full,
  'utils/coupons.ts': full,
  'utils/settings.ts': full,
  'utils/graphqlUpload.ts': full,
}

export default defineConfig({
  // Only Vite+ (vp test/lint/fmt) reads this file; Nuxt builds with its own Vite config.
  test: {
    projects: [
      {
        // Pure code: no Nuxt. Node environment, fast. `~` / `@` are Nuxt's own aliases for the project root.
        plugins: [runtimeFlagsPlugin({ server: false, client: true, dev: false })],
        resolve: { alias: { '~': root('.'), '@': root('.') } },
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: [...excluded, '**/*.nuxt.test.ts'],
          setupFiles: [root('tests/support/noNetwork.ts'), root('tests/support/flagsReset.ts')],
          unstubGlobals: true,
          unstubEnvs: true,
          restoreMocks: true,
        },
      },
      './vitest.nuxt.config.ts',
    ],
    coverage: {
      provider: 'v8',
      // The TypeScript of the dashboard. `.vue` pages and components are not part of the unit metric.
      include: [
        'composables/**/*.ts',
        'stores/**/*.ts',
        'plugins/**/*.ts',
        'middleware/**/*.ts',
        'utils/**/*.ts',
        'server/**/*.ts',
      ],
      exclude: [
        '**/node_modules/**',
        '**/.nuxt/**',
        '**/.output/**',
        '**/*.test.*',
        '**/*.d.ts',
        '**/*.config.ts',
      ],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      // Global floor: 99 %, so that one new defensive line somewhere does not fail CI. The 100 % bar is held per file
      // for the critical flows (`criticalFiles` above), which is where a regression matters.
      thresholds: {
        statements: 99,
        branches: 99,
        functions: 99,
        lines: 99,
        ...criticalFiles,
      },
    },
  },
  staged: {
    '*': 'vp check --fix',
  },
  fmt: {
    singleQuote: true,
    semi: false,
    ignorePatterns: [
      '.claude/**',
      'android/**',
      '**/android/**',
      'public/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  lint: {
    plugins: ['typescript', 'vue'],
    // Everything is an error: the codebase is at zero, and a warning would just pile up unnoticed again.
    categories: {
      correctness: 'error',
      suspicious: 'error',
      pedantic: 'error',
      perf: 'error',
      style: 'error',
    },
    rules: {
      'no-shadow': 'error',
      'default-case-last': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: 'error',
      curly: 'off',
      'id-length': 'off',
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      'max-statements': 'off',
      'func-style': 'off',
      'no-magic-numbers': 'off',
      'no-ternary': 'off',
      'no-nested-ternary': 'off',
      'sort-keys': 'off',
      'no-inline-comments': 'off',
      'init-declarations': 'off',
      'no-continue': 'off',
      'no-await-in-loop': 'off',
      'unicorn/no-nested-ternary': 'off',
      'one-var': 'off',
      'vite-plus/prefer-vite-plus-imports': 'error',
      // The autofix capitalises the first letter of every comment line, which mangles continuation lines
      // ("Aliases, auto-imports" in the middle of a sentence) and code examples in comments.
      'capitalized-comments': 'off',
      // Two more autofixes the pre-commit hook (`vp check --fix`) applies blindly: the first strips casts that the
      // lint run (without Nuxt's generated types) believes useless, the second rewrites arrow bodies.
      'typescript/no-unnecessary-type-assertion': 'off',
      'typescript/strict-void-return': 'off',
      // Wants every parameter deeply readonly, which Vue refs, DOM events and most library types can never be: it fired on
      // most of the codebase for no safety gain.
      'typescript/prefer-readonly-parameter-types': 'off',
      // Import order is the formatter's job; this rule disagreed with it and the pre-commit fix never settled it.
      'sort-imports': 'off',
    },
    overrides: [
      {
        // Tests cast to fakes, build partial objects and read `any` from mocks: these rules are noise there, and only there.
        // The Playwright specs, their helpers and the mock backend (e2e/) are test code too.
        files: ['tests/**/*.ts', 'e2e/**/*.ts', 'playwright.config.ts'],
        rules: {
          'typescript/prefer-readonly-parameter-types': 'off',
          'typescript/no-unsafe-type-assertion': 'off',
          'typescript/no-unsafe-member-access': 'off',
          'typescript/no-unsafe-return': 'off',
          'typescript/no-unsafe-assignment': 'off',
          'typescript/no-unsafe-call': 'off',
          'typescript/no-unsafe-argument': 'off',
          'typescript/strict-boolean-expressions': 'off',
          'typescript/no-non-null-assertion': 'off',
          // Test doubles: classes with one-line constructors, `_`-named internals of the thing they fake, throw-away
          // regexes and function expressions that need their own `this`.
          'typescript/parameter-properties': 'off',
          'max-classes-per-file': 'off',
          'no-underscore-dangle': 'off',
          'max-params': 'off',
          'prefer-named-capture-group': 'off',
          'new-cap': 'off',
          'func-names': 'off',
        },
      },
    ],
    env: {
      browser: true,
    },
    ignorePatterns: [
      '.nuxt',
      '.output',
      'node_modules',
      // Plain-JS tool copied verbatim into pili-shop and pili-mobile (see its header): not held to this app's rules.
      'scripts/check-graphql-operations.mjs',
      'coverage',
      'playwright-report',
      'test-results',
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
  },
})
