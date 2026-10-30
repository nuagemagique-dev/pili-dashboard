// A fake HubRise API behind `$gqlFetch`: each operation is answered by its name (`query HubriseStatus`, `mutation
// PublishHubriseCatalog`...). An answer is the data, a function of the variables, or `failWith(errors)` to reject the
// way `$gqlFetch` does (with the raw GraphQL errors array). An operation nobody answered rejects, so a test never talks
// to an API it did not set up.
//
//   const gqlFetch = vi.hoisted(() => vi.fn())
//   const api = hubriseApi(gqlFetch)       // beforeEach after vi.resetAllMocks(): api.install()
//   api.answer('HubriseStatus', { hubriseStatus: makeStatus() })
//   api.answer('PublishHubriseCatalog', api.failWith(gqlFailure('HUBRISE_PREVIEW_STALE')))
//   api.calls('PublishHubriseCatalog')   // the variables of each call
import type { Mock } from 'vite-plus/test'

const FAILURE = Symbol('failure')

interface Failure {
  [FAILURE]: true
  errors: unknown
}

/** The data, or a function of the variables that returns it (or a failWith). */
type Answer = unknown

export function hubriseApi(gqlFetch: Mock) {
  const answers = new Map<string, Answer>()
  const history: { name: string; variables: Record<string, unknown> }[] = []

  const nameOf = (query: string): string =>
    /(?:query|mutation|subscription) (\w+)/u.exec(query)?.[1] ?? ''

  const implementation = (query: string, options?: { variables?: Record<string, unknown> }) => {
    const name = nameOf(query)
    const variables = options?.variables ?? {}
    history.push({ name, variables })
    if (!answers.has(name)) return Promise.reject(new Error(`no answer set for ${name}`))
    const entry = answers.get(name)
    const value =
      typeof entry === 'function' ? (entry as (v: unknown) => unknown)(variables) : entry
    if (typeof value === 'object' && value !== null && FAILURE in value) {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- $gqlFetch rejects with the raw errors array
      return Promise.reject((value as Failure).errors)
    }
    return Promise.resolve(value)
  }
  gqlFetch.mockImplementation(implementation)

  return {
    /** Puts the fake API back after `vi.resetAllMocks()` (which wipes every implementation). */
    install() {
      gqlFetch.mockImplementation(implementation)
    },
    answer(name: string, value: Answer) {
      answers.set(name, value)
    },
    failWith(errors: unknown): Failure {
      return { [FAILURE]: true, errors }
    },
    calls(name: string): Record<string, unknown>[] {
      return history.filter((call) => call.name === name).map((call) => call.variables)
    },
    names(): string[] {
      return history.map((call) => call.name)
    },
    clear() {
      history.length = 0
    },
  }
}
