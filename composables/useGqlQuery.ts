// Composables/useGqlQuery.ts
import { type Ref, watch } from 'vue'
import { useAsyncData, useNuxtApp } from '#imports'
import { hash } from 'ohash'

type Vars = Record<string, unknown> | (() => Record<string, unknown>)
interface Options {
  immediate?: boolean
  cache?: boolean
  server?: boolean
}

interface GqlQueryResult<T> {
  data: Ref<T | undefined>
  pending: Ref<boolean>
  error: Ref<unknown>
  refresh: (opts?: { dedupe?: 'cancel' | 'defer' }) => Promise<void>
  refetch: (opts?: { dedupe?: 'cancel' | 'defer' }) => Promise<void>
}

export const useGqlQuery = async <T>(
  query: string,
  variables: Vars = {},
  opts: Options = { immediate: true, cache: false }, // ⬅ default cache:false
): Promise<GqlQueryResult<T>> => {
  const { $gqlFetch } = useNuxtApp()
  const getVars = () => (typeof variables === 'function' ? variables() : variables)
  const handler = () => $gqlFetch<T>(query, { variables: getVars() })

  /*
   * The async-data key. `cache: true` keys the data by the document: the same query shares its data wherever it is used.
   * Without it, the key is derived from the document AND the variables it starts with: two live queries that differ
   * share nothing (a call-site key, the same for every caller of this composable, made the second query reuse the
   * first one's handler and data), while two identical ones are one query. Variables that change later are handled by
   * the refetch below, under the same key.
   */
  const key = opts.cache === true ? `gql:${hash(query)}` : `gql:${hash([query, getVars()])}`
  const asyncOpts = { immediate: opts.immediate, server: opts.server }
  const asyncData = await useAsyncData<T>(key, handler, asyncOpts)

  if (typeof variables === 'function') {
    watch(
      () => variables(),
      () => asyncData.refresh({ dedupe: 'cancel' }),
      { deep: true },
    )
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Nuxt's AsyncData types its data through pick helpers (PickFrom, KeysOf) that cannot be resolved for an open T
  const result = asyncData as unknown as GqlQueryResult<T>
  result.refetch = asyncData.refresh
  return result
}
