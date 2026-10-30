import { isSilentRenewUnavailable } from '~/utils/silentRenewError'

/**
 * On app start, validate that the stored OIDC refresh token is still accepted by Zitadel.
 *
 * Tokens are persisted in localStorage, so a user profile in the Pinia
 * store may outlive the refresh token's idle expiry (Zitadel default: 30 days idle / 90
 * days absolute). This plugin calls silentRenew() and clears the store only if Zitadel
 * rejects the refresh token.
 */
export default defineNuxtPlugin(async () => {
  const { useAuthStore } = await import('~/stores/auth')
  const authStore = useAuthStore()

  // Nothing to sync if no persisted user
  if (!authStore.user) return

  const { useOidc } = await import('~/composables/useOidc')
  const { isAuthenticated, silentRenew } = useOidc()

  // Session still valid
  if (await isAuthenticated()) return

  // Try silent renewal (refresh token may still work)
  try {
    const renewed = await silentRenew()
    if (renewed) return
  } catch (err) {
    // Zitadel could not be reached (offline): the session is intact, keep it and the user; the next request renews it.
    if (isSilentRenewUnavailable(err)) return
    throw err
  }

  // No valid session: clear stale OIDC session + Pinia store
  const { removeUser } = useOidc()
  await removeUser()
  authStore.clearUser()
})
