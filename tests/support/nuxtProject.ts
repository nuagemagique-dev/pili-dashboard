import { fileURLToPath } from 'node:url'
import { runtimeFlagsPlugin } from './flags'

// Options of the Nuxt-environment vitest project (vitest.nuxt.config.ts): it boots the real dashboard app (layers,
// aliases, auto-imports, Pinia, i18n) through @nuxt/test-utils.

// `nuxt.config.ts` reads these from the environment when it loads (runtimeConfig.public). The test environment gets
// harmless fixed values so that `vp test run` needs no setup. They are FORCED, not defaults: a developer's exported
// API_BASE_URL or `.env` must not change what the tests see. Tests read what they assert from `useRuntimeConfig()`.
export const testEnv: Record<string, string> = {
  DASHBOARD_BASE_URL: 'https://dash.test',
  API_BASE_URL: 'https://api.dash.test/api/v1',
  S3_BUCKET_URL: 'https://s3.dash.test',
  GRAPHQL_WS_URL: 'wss://api.dash.test/api/v1/graphql',
  ZITADEL_AUTHORITY: 'https://auth.dash.test',
  ZITADEL_CLIENT_ID: 'unit-test-client-id',
  RESTAURANT_NAME: 'Test Sushi',
}
Object.assign(process.env, testEnv)
delete process.env.DASHBOARD_ZITADEL_CLIENT_ID

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url))

// The Nuxt app boots as a client (`import.meta.client`, not dev); a test flips the flags of the app's own sources with
// `setFlags` (tests/support/flags.ts) to reach server-only or dev-only branches.
export function nuxtProject(options: { name: string; include: string[]; exclude?: string[] }) {
  return {
    plugins: [runtimeFlagsPlugin({ server: false, client: true, dev: false })],
    test: {
      name: options.name,
      environment: 'nuxt' as const,
      include: options.include,
      exclude: ['**/node_modules/**', '**/.nuxt/**', '**/.output/**', ...(options.exclude ?? [])],
      setupFiles: [
        path('./noNetwork.ts'),
        path('./flagsReset.ts'),
        path('./vue.ts'),
        path('./nuxtReady.ts'),
      ],
      unstubGlobals: true,
      unstubEnvs: true,
      restoreMocks: true,
      environmentOptions: {
        nuxt: { rootDir: path('../..'), domEnvironment: 'happy-dom' as const },
      },
    },
  }
}
