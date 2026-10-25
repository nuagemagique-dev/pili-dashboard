// https://nuxt.com/docs/api/configuration/nuxt-config

// Empty env vars fall back to the default, like unset ones.
const envOr = (value: string | undefined, fallback: string): string =>
  value !== undefined && value !== '' ? value : fallback

// Derive origins for CSP from environment variables (dev defaults)
const apiOrigin = new URL(envOr(process.env.API_BASE_URL, 'http://localhost:8080/api/v1')).origin
const wsOrigin = apiOrigin.replace(/^http/u, 'ws')
const s3Url = process.env.S3_BUCKET_URL
const zitadelOrigin = envOr(process.env.ZITADEL_AUTHORITY, 'https://auth.tokyosushibarliege.be')

const csp = `${[
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `img-src 'self' data: blob:${s3Url !== undefined && s3Url !== '' ? ` ${s3Url}` : ''}`,
  "font-src 'self' https://fonts.gstatic.com",
  `connect-src 'self' ${apiOrigin} ${wsOrigin} ${zitadelOrigin} https://api.iconify.design`,
  `frame-src 'self' ${zitadelOrigin}`,
].join('; ')};`

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  future: {
    compatibilityVersion: 4,
  },
  ssr: false,
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@nuxtjs/i18n', '@pinia/nuxt', 'pinia-plugin-persistedstate/nuxt'],

  icon: {
    clientBundle: {
      scan: true,
    },
  },

  css: ['~/assets/css/main.css'],

  // Pili is dark only. A dedicated storage key ignores any "light" preference
  // Saved by the old theme toggle.
  colorMode: {
    preference: 'dark',
    fallback: 'dark',
    storageKey: 'pili-color-mode',
  },

  runtimeConfig: {
    public: {
      dashboardBaseUrl: process.env.DASHBOARD_BASE_URL,
      s3bucketUrl: process.env.S3_BUCKET_URL,
      api: process.env.API_BASE_URL,
      graphqlHttp: `${process.env.API_BASE_URL}/graphql`,
      graphqlWs: process.env.GRAPHQL_WS_URL,
      // Zitadel OIDC
      zitadelAuthority: envOr(process.env.ZITADEL_AUTHORITY, 'https://auth.tokyosushibarliege.be'),
      zitadelClientId: envOr(
        process.env.DASHBOARD_ZITADEL_CLIENT_ID,
        envOr(process.env.ZITADEL_CLIENT_ID, ''),
      ),
      // Restaurant name (white-label). Read from a plain
      // (non-NUXT_PUBLIC_) env var so it's baked at build time; the runtime
      // Override machinery never fires for this static SPA (served by Caddy).
      restaurantName: envOr(process.env.RESTAURANT_NAME, 'Tokyo Sushi Bar'),
    },
  },

  app: {
    head: {
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0b0d0e' },
        { name: 'color-scheme', content: 'dark' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;700&family=Noto+Sans+SC:wght@400;700&family=JetBrains+Mono:wght@400;500;700&family=Archivo:wght@700;800&display=swap',
        },
      ],
    },
    pageTransition: { name: 'page', mode: 'out-in' },
  },

  plugins: ['~/plugins/api', '~/plugins/gqlFetch'],

  i18n: {
    defaultLocale: 'fr',
    strategy: 'prefix',
    locales: [
      {
        code: 'fr',
        language: 'fr-BE',
      },
      {
        code: 'en',
        language: 'en',
      },
      {
        code: 'zh',
        language: 'zh-CN',
      },
      {
        code: 'nl',
        language: 'nl-BE',
      },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected',
      redirectOn: 'all',
    },
    baseUrl: process.env.DASHBOARD_BASE_URL,
    vueI18n: '../i18n.config.ts',
  },

  routeRules: {
    '/**': {
      headers: {
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
        'Content-Security-Policy': csp,
      },
    },
  },
})
