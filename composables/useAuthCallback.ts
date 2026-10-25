import { navigateTo, useLocalePath, useNuxtApp } from '#imports'
import type { User } from '@/types'
import gql from 'graphql-tag'
import { print } from 'graphql'
import { useAuthStore } from '@/stores/auth'
import { useOidc } from '~/composables/useOidc'
import { consumeReturnTo } from '~/utils/authReturn'

const ME = gql`
  query {
    me {
      id
      email
      firstName
      lastName
      phoneNumber
      isAdmin
      address {
        id
        streetName
        houseNumber
        municipalityName
        postcode
        distance
      }
    }
  }
`

/**
 * Post-login steps of pages/auth/callback.vue.
 * Fetches the current user, enforces the admin gate, stores it, and navigates
 * to the dashboard home.
 */
export function useAuthCallback() {
  const authStore = useAuthStore()
  const localePath = useLocalePath()
  const { $gqlFetch } = useNuxtApp()

  async function processCallback(): Promise<{ ok: boolean; reason?: 'not_admin' }> {
    // Ensure the access token is loaded before hitting the API
    const { getAccessToken } = useOidc()
    await getAccessToken()

    /*
     * The return path is read only once `me` has answered: when that query fails (network, no user) the page is
     * retried and must still know where to go. Once it has answered, it is read whatever the outcome (an account that
     * is not an admin included), so that a stale path never sends a later login somewhere unexpected.
     */
    const data = await $gqlFetch<{ me?: User | null } | null>(print(ME))
    const me = data?.me
    if (me === null || me === undefined) {
      return { ok: false }
    }
    const returnTo = consumeReturnTo()

    if (!me.isAdmin) {
      authStore.clearUser()
      return { ok: false, reason: 'not_admin' }
    }

    authStore.setUser(me)
    // Back to the page the session ended on (kept by the middleware / the API plugins), else the orders board.
    await navigateTo(returnTo ?? localePath('orders'))
    return { ok: true }
  }

  return { processCallback }
}
