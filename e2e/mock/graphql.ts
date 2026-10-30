import {
  type DocumentNode,
  type FragmentDefinitionNode,
  Kind,
  type SelectionSetNode,
  type ValueNode,
  parse,
} from 'graphql'
import type { MockState } from './state.ts'

/*
 * A tiny GraphQL executor for the mock. There is no schema: resolvers are plain functions keyed by root field, and the
 * request's selection set is projected onto whatever the resolver returned (aliases, fragments, lists, nesting), so
 * every field the dashboard asks for comes back as long as the returned object has it. A field the object lacks answers
 * `null` and is recorded as a "gap" (the mock lags the dashboard): the Playwright fixture fails the test on gaps.
 */

export interface RequestContext {
  state: MockState
  /** The request carried a bearer token (the mock never validates it; a scenario can reject it). */
  authenticated: boolean
}

export class GraphQLFailure extends Error {
  readonly code: string
  constructor(code: string, message = code) {
    super(message)
    this.code = code
  }
}

export type Resolver = (context: RequestContext, args: Record<string, unknown>) => unknown

export interface SubscriptionDef {
  /** The object the selection set is projected on, for an event published on the topic named like the field. */
  payload: (event: unknown) => unknown
}

export interface Operations {
  queries: Record<string, Resolver>
  mutations: Record<string, Resolver>
  subscriptions: Record<string, SubscriptionDef>
}

type Fragments = Record<string, FragmentDefinitionNode>

const fragmentsOf = (doc: DocumentNode): Fragments =>
  Object.fromEntries(
    doc.definitions
      .filter(
        (definition): definition is FragmentDefinitionNode =>
          definition.kind === Kind.FRAGMENT_DEFINITION,
      )
      .map((definition) => [definition.name.value, definition]),
  )

function literal(node: ValueNode, variables: Record<string, unknown>): unknown {
  switch (node.kind) {
    case Kind.VARIABLE:
      return variables[node.name.value]
    case Kind.INT:
    case Kind.FLOAT:
      return Number(node.value)
    case Kind.NULL:
      return null
    case Kind.LIST:
      return node.values.map((value) => literal(value, variables))
    case Kind.OBJECT:
      return Object.fromEntries(
        node.fields.map((field) => [field.name.value, literal(field.value, variables)]),
      )
    case Kind.STRING:
    case Kind.BOOLEAN:
    case Kind.ENUM:
      return node.value
    default:
      return undefined
  }
}

const argsOf = (
  field: { arguments?: readonly { name: { value: string }; value: ValueNode }[] },
  variables: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    (field.arguments ?? []).map((argument) => [
      argument.name.value,
      literal(argument.value, variables),
    ]),
  )

/** Projects `selectionSet` onto `value`. `where` names the root field, for gap reports. */
function project(
  selectionSet: SelectionSetNode | undefined,
  value: unknown,
  fragments: Fragments,
  state: MockState,
  where: string,
): unknown {
  if (value === null || value === undefined) return null
  if (Array.isArray(value))
    return value.map((item) => project(selectionSet, item, fragments, state, where))
  if (!selectionSet || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const visit = (set: SelectionSetNode) => {
    for (const selection of set.selections) {
      if (selection.kind === Kind.FIELD) {
        const name = selection.name.value
        const key = selection.alias?.value ?? name
        if (name === '__typename') {
          out[key] = 'Object'
          continue
        }
        let field = source[name]
        if (!(name in source)) {
          state.noteGap(`field ${where}.${name}`)
          field = null
        }
        out[key] = project(selection.selectionSet, field, fragments, state, `${where}.${name}`)
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        visit(selection.selectionSet)
      } else {
        const fragment = fragments[selection.name.value]
        if (fragment) visit(fragment.selectionSet)
      }
    }
  }
  visit(selectionSet)
  return out
}

export interface GraphQLRequest {
  query: string
  variables?: Record<string, unknown>
}

interface GraphQLResult {
  data?: Record<string, unknown>
  errors?: { message: string; path?: string[]; extensions: Record<string, unknown> }[]
}

const errorEntry = (error: unknown, path: string[]) => {
  if (error instanceof GraphQLFailure)
    return { message: error.message, path, extensions: { code: error.code } }
  const message = error instanceof Error ? error.message : String(error)
  return { message, path, extensions: { code: 'INTERNAL' } }
}

export async function execute(
  operations: Operations,
  context: RequestContext,
  request: GraphQLRequest,
): Promise<GraphQLResult> {
  let doc: DocumentNode
  try {
    doc = parse(request.query)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      errors: [
        { message: `Parse error: ${message}`, extensions: { code: 'GRAPHQL_PARSE_FAILED' } },
      ],
    }
  }
  const fragments = fragmentsOf(doc)
  const operation = doc.definitions.find(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  )
  if (!operation || operation.kind !== Kind.OPERATION_DEFINITION) {
    return { errors: [{ message: 'no operation', extensions: { code: 'GRAPHQL_PARSE_FAILED' } }] }
  }
  const variables = request.variables ?? {}
  const table = operation.operation === 'mutation' ? operations.mutations : operations.queries
  const data: Record<string, unknown> = {}
  const errors: NonNullable<GraphQLResult['errors']> = []

  for (const selection of operation.selectionSet.selections) {
    if (selection.kind !== Kind.FIELD) continue
    const name = selection.name.value
    const key = selection.alias?.value ?? name
    const args = argsOf(selection, variables)
    context.state.log({
      op: name,
      kind: operation.operation === 'mutation' ? 'mutation' : 'query',
      args,
      authenticated: context.authenticated,
    })
    const resolver = table[name]
    if (!resolver) {
      context.state.noteGap(`${operation.operation} ${name}`)
      data[key] = null
      errors.push({
        message: `mock: no resolver for ${operation.operation} ${name}`,
        path: [key],
        extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
      })
      continue
    }
    const injected = context.state.scenario.operationFailures[name]
    if (injected) {
      data[key] = null
      errors.push(errorEntry(new GraphQLFailure(injected.code, injected.message), [key]))
      continue
    }
    try {
      const raw = await resolver(context, args)
      data[key] = project(selection.selectionSet, raw, fragments, context.state, name)
    } catch (error) {
      data[key] = null
      errors.push(errorEntry(error, [key]))
    }
  }
  return errors.length > 0 ? { data, errors } : { data }
}

/** What a `subscribe` message asks for, once parsed. */
export interface ParsedSubscription {
  name: string
  definition: SubscriptionDef | undefined
  /** Projects an event payload onto the requested fields. */
  render: (payload: unknown) => unknown
}

export function parseSubscription(
  operations: Operations,
  state: MockState,
  request: GraphQLRequest,
): ParsedSubscription | null {
  let doc: DocumentNode
  try {
    doc = parse(request.query)
  } catch {
    return null
  }
  const operation = doc.definitions.find(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  )
  if (!operation || operation.kind !== Kind.OPERATION_DEFINITION) return null
  const field = operation.selectionSet.selections.find((selection) => selection.kind === Kind.FIELD)
  if (!field || field.kind !== Kind.FIELD) return null
  const fragments = fragmentsOf(doc)
  const name = field.name.value
  const key = field.alias?.value ?? name
  return {
    name,
    definition: operations.subscriptions[name],
    render: (payload) => ({ [key]: project(field.selectionSet, payload, fragments, state, name) }),
  }
}
