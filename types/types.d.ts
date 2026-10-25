// Types/types.d.ts
import type { Router } from 'vue-router'

declare module '#app' {
  interface NuxtApp {
    $apiBaseUrl: () => string
    $api: <T = unknown>(request: string, options?: Record<string, unknown>) => Promise<T>
    $gqlFetch: <T = unknown>(
      query: string,
      options?: { variables?: Record<string, unknown>; signal?: AbortSignal },
    ) => Promise<T>
    $router: Router
    $localePath: (path: string) => string
  }
}

// If using Nitro auto-imports
declare module 'nitropack' {
  interface NitroApp {
    $apiBaseUrl?: () => string
    $api?: <T = unknown>(request: string, options?: Record<string, unknown>) => Promise<T>
  }
}
