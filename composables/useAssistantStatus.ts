import { onMounted, watch } from 'vue'
import { useGqlSubscription, useNuxtApp, useState } from '#imports'
import type { AssistantConnection } from '~/utils/assistant'

export const CONNECTION_FIELDS = `
  enabled
  state
  botUsername
  accounts {
    id
    name
    username
    linkedAt
  }
  maxAccounts
  problemSince
`

const GET_CONNECTION = /* GraphQL */ `
  query AssistantConnection {
    assistantConnection {
      ${CONNECTION_FIELDS}
    }
  }
`

const SUB_CONNECTION = /* GraphQL */ `
  subscription AssistantConnectionUpdated {
    assistantConnectionUpdated {
      ${CONNECTION_FIELDS}
    }
  }
`

/**
 * The Telegram assistant's connection, shared by the layout banner and the
 * assistant page. `connection` stays null until the first load.
 *
 * Call it directly in `<script setup>`: it subscribes to live updates.
 */
export function useAssistantStatus() {
  const { $gqlFetch } = useNuxtApp()
  const connection = useState<AssistantConnection | null>('pili-assistant-connection', () => null)

  const load = async () => {
    try {
      const data = await $gqlFetch<{ assistantConnection: AssistantConnection } | null>(
        GET_CONNECTION,
      )
      if (data) connection.value = data.assistantConnection
    } catch {
      // Not an admin, or the API is down: no banner, the page shows its own error.
    }
  }

  const { data: live } = useGqlSubscription<{ assistantConnectionUpdated: AssistantConnection }>(
    SUB_CONNECTION,
  )
  watch(live, (val) => {
    if (val?.assistantConnectionUpdated) connection.value = val.assistantConnectionUpdated
  })

  onMounted(load)

  return { connection, reload: load }
}
