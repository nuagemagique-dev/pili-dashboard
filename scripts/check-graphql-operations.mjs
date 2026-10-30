#!/usr/bin/env node
/*
 * Contract check between this app and the backend GraphQL schema.
 *
 * Finds every GraphQL operation the app sends and validates it against the backend SDL
 * (contract/schema.graphql in nuagemagique-dev/pili-api): unknown fields, arguments and
 * types, wrong variable types, missing required arguments, missing selections.
 *
 * How operations are found. Queries live in .ts/.js/.vue sources as string literals, so
 * a literal counts as a GraphQL operation when it is
 *   - preceded by the marker comment   const Q = / * GraphQL * / `query Foo { ... }`   (no spaces in the real marker)
 *   - or the template of a `gql` / `graphql` tag.
 * The guard half of this script fails on any OTHER string literal that looks like an
 * operation (starts with query / mutation / subscription / fragment), so a new query can
 * not escape validation by being written without the marker.
 *
 * Usage:
 *   node scripts/check-graphql-operations.mjs --root <dir> [--root <dir> ...] [--schema <file>]
 *
 * The schema is read from --schema, else $GRAPHQL_SCHEMA, else ../tsb-service/contract/schema.graphql
 * (sibling checkout). CI downloads it from the pili-api main branch.
 *
 * Test files (*.test.*, *.spec.*, tests/, __tests__/, e2e/, test/) are skipped: they hold
 * stand-in queries that are never sent to the real backend.
 *
 * Identical copies live in pili-shop (tsb-core), pili-dashboard (tsb-dashboard) and
 * pili-mobile (tsb-mobile); keep them in sync.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSchema, NoUnusedFragmentsRule, parse, specifiedRules, validate } from 'graphql'
import ts from 'typescript'

const SKIP_DIRS = new Set([
  'node_modules',
  '.nuxt',
  '.output',
  '.git',
  '.worktrees',
  'dist',
  'coverage',
  'android',
  'ios',
  '.expo',
  'playwright-report',
  'test-results',
  'tests',
  '__tests__',
  'e2e',
  'test',
])
const SKIP_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'])
const TAGS = new Set(['gql', 'graphql'])
const MARKER = /^\/\*\s*GraphQL\s*\*\/$/
const OPERATION_START =
  /^\s*(?:(?:query|mutation|subscription)\b[\w\s]*(?:\([^)]*\))?\s*(?:@[^{]*)?\{|fragment\s+\w+\s+on\s+\w+)/

/** Parses the command line: repeated --root, one --schema. */
export function parseArgs(argv, env = process.env) {
  const roots = []
  let schema = env.GRAPHQL_SCHEMA
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') roots.push(argv[++i])
    else if (argv[i] === '--schema') schema = argv[++i]
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  if (roots.length === 0) throw new Error('at least one --root <dir> is required')
  return { roots, schema }
}

/** Lists the source files under a directory, skipping build output and test files. */
export function listSources(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...listSources(full))
    } else if (SOURCE_EXT.has(extname(name)) && !SKIP_FILE.test(name)) {
      out.push(full)
    }
  }
  return out
}

/** The code of a file as [{ code, offset }]: the file itself, or the <script> blocks of a .vue file. */
function codeBlocks(file, text) {
  if (extname(file) !== '.vue') return [{ code: text, offset: 0 }]
  const blocks = []
  for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    blocks.push({
      code: m[1],
      offset: text.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1,
    })
  }
  return blocks
}

/** Parses a file into the TypeScript sources it contains (the whole file, or the <script> blocks of a .vue file). */
export function parseUnits(file, text) {
  return codeBlocks(file, text).map(({ code, offset }) => ({
    file,
    code,
    offset,
    sf: ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  }))
}

const unwrap = (node) => {
  let n = node
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isSatisfiesExpression(n)
  ) {
    n = n.expression
  }
  return n
}

/**
 * Top-level `const NAME = <string | template | arrow function>` of every unit. Operations are often built
 * from shared selections (`${ORDER_ITEMS_SELECTION}`) or a small function (`configFields(true)`), so the
 * extractor evaluates those statically instead of asking the app to inline them.
 */
export function collectConsts(units) {
  const consts = new Map()
  for (const unit of units) {
    for (const stmt of unit.sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        const list = consts.get(decl.name.text) ?? []
        list.push({ unit, node: unwrap(decl.initializer) })
        consts.set(decl.name.text, list)
      }
    }
  }
  return consts
}

class Unresolvable extends Error {}

/**
 * Evaluates an expression to its possible values (a list: `cond ? a : b` with an unknown condition yields
 * both). Supports string and template literals, booleans, top-level consts, conditionals and calls of
 * top-level arrow functions with literal arguments. Anything else throws Unresolvable.
 */
function evaluate(node, unit, consts, env, depth = 0) {
  if (depth > 20) throw new Unresolvable('expression nested too deeply')
  const n = unwrap(node)
  const again = (child, scope = env, u = unit) => evaluate(child, u, consts, scope, depth + 1)
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text]
  if (n.kind === ts.SyntaxKind.TrueKeyword) return [true]
  if (n.kind === ts.SyntaxKind.FalseKeyword) return [false]
  if (ts.isTemplateExpression(n)) {
    let out = [n.head.text]
    for (const span of n.templateSpans) {
      const parts = again(span.expression)
      out = out.flatMap((prefix) => parts.map((part) => `${prefix}${part}${span.literal.text}`))
    }
    return out
  }
  if (ts.isConditionalExpression(n)) {
    return again(n.condition).flatMap((c) => again(c ? n.whenTrue : n.whenFalse))
  }
  if (ts.isIdentifier(n)) {
    if (env.has(n.text)) return [env.get(n.text)]
    const found = lookup(n.text, unit, consts)
    return again(found.node, new Map(), found.unit)
  }
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
    const fn = lookup(n.expression.text, unit, consts)
    if (!ts.isArrowFunction(fn.node))
      throw new Unresolvable(`${n.expression.text} is not an arrow function`)
    const args = n.arguments.map((a) => again(a))
    return args
      .reduce((acc, values) => acc.flatMap((prefix) => values.map((v) => [...prefix, v])), [[]])
      .flatMap((values) => {
        const scope = new Map(
          fn.node.parameters.map((param, i) => [param.name.getText(), values[i]]),
        )
        const body = ts.isBlock(fn.node.body)
          ? fn.node.body.statements.find(ts.isReturnStatement)?.expression
          : fn.node.body
        if (!body) throw new Unresolvable(`${n.expression.text} has no returned expression`)
        return again(body, scope, fn.unit)
      })
  }
  throw new Unresolvable(`cannot evaluate \`${n.getText().slice(0, 40)}\` statically`)
}

function lookup(name, unit, consts) {
  const all = consts.get(name) ?? []
  const local = all.filter((c) => c.unit.file === unit.file)
  const pool = local.length > 0 ? local : all
  if (pool.length === 0)
    throw new Unresolvable(`${name} is not a top-level constant of the scanned sources`)
  if (pool.length > 1) throw new Unresolvable(`${name} is defined more than once: ambiguous`)
  return pool[0]
}

/**
 * Finds the GraphQL string literals of the given units.
 * Returns { documents: [{ file, line, text }], untagged: [{ file, line, text }], problems: [...] }.
 * A document with substitutions yields one entry per possible value.
 */
export function extractDocuments(units, consts) {
  const documents = []
  const untagged = []
  const problems = []
  for (const unit of units) {
    const { file, code, offset, sf } = unit
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 + offset

    // A comment on the same line as the previous token (`= /* GraphQL */ `...``) is that token's
    // trailing comment for TypeScript; one on its own line is the literal's leading comment.
    const isMarked = (node) =>
      [
        ...(ts.getLeadingCommentRanges(code, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(code, node.pos) ?? []),
      ].some((r) => MARKER.test(code.slice(r.pos, r.end)))

    const visit = (node) => {
      let literal = null
      let tagged = false
      if (
        ts.isTaggedTemplateExpression(node) &&
        ts.isIdentifier(node.tag) &&
        TAGS.has(node.tag.text)
      ) {
        literal = node.template
        tagged = true
      } else if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)
      ) {
        literal = node
        tagged = isMarked(node)
      }
      if (literal) {
        const line = lineOf(node)
        if (tagged) {
          try {
            for (const text of evaluate(literal, unit, consts, new Map())) {
              documents.push({ file, line, text })
            }
          } catch (error) {
            if (!(error instanceof Unresolvable)) throw error
            problems.push({ file, line, message: `${error.message}: inline it in the document` })
          }
        } else {
          // The head of a template is enough to tell that a literal starts like an operation.
          const head = ts.isTemplateExpression(literal) ? literal.head.text : literal.text
          if (OPERATION_START.test(head)) untagged.push({ file, line, text: head })
        }
        // A tagged template is fully handled; its substitutions are not scanned separately.
        if (tagged && ts.isTaggedTemplateExpression(node)) return
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return { documents, untagged, problems }
}

/** Validates documents against the schema. Returns a list of { file, line, message }. */
export function validateDocuments(schema, documents) {
  const problems = []
  const parsed = []
  for (const doc of documents) {
    try {
      parsed.push({ doc, ast: parse(doc.text) })
    } catch (error) {
      problems.push({ ...doc, message: `syntax error: ${error.message}` })
    }
  }
  // Fragments are shared between documents (a query may use a fragment defined elsewhere).
  const fragments = new Map()
  for (const { ast } of parsed) {
    for (const def of ast.definitions)
      if (def.kind === 'FragmentDefinition') fragments.set(def.name.value, def)
  }
  const rules = specifiedRules.filter((rule) => rule !== NoUnusedFragmentsRule)
  const seen = new Set()
  for (const { doc, ast } of parsed) {
    const own = new Set(
      ast.definitions.filter((d) => d.kind === 'FragmentDefinition').map((d) => d.name.value),
    )
    const definitions = [
      ...ast.definitions,
      ...[...fragments].filter(([n]) => !own.has(n)).map(([, d]) => d),
    ]
    for (const error of validate(schema, { kind: 'Document', definitions }, rules)) {
      // The variants of one literal (conditional selections) repeat the same message.
      const key = `${doc.file}:${doc.line}:${error.message}`
      if (seen.has(key)) continue
      seen.add(key)
      problems.push({ ...doc, message: error.message })
    }
  }
  return problems
}

function resolveSchemaPath(explicit) {
  const candidates = [
    explicit,
    resolve(fileURLToPath(import.meta.url), '../../../tsb-service/contract/schema.graphql'),
  ]
  const found = candidates.find((p) => p && existsSync(p))
  if (!found) {
    throw new Error(
      'backend schema not found. Pass --schema <file> or set GRAPHQL_SCHEMA; CI downloads ' +
        'https://raw.githubusercontent.com/nuagemagique-dev/pili-api/main/contract/schema.graphql',
    )
  }
  return found
}

export function main(argv) {
  const { roots, schema: schemaArg } = parseArgs(argv)
  const schemaPath = resolveSchemaPath(schemaArg)
  const schema = buildSchema(readFileSync(schemaPath, 'utf8'))

  const units = []
  for (const root of roots) {
    for (const file of listSources(root)) {
      units.push(...parseUnits(relative(process.cwd(), file), readFileSync(file, 'utf8')))
    }
  }
  const {
    documents,
    untagged,
    problems: extractProblems,
  } = extractDocuments(units, collectConsts(units))

  const problems = [...extractProblems, ...validateDocuments(schema, documents)]
  for (const u of untagged) {
    problems.push({
      ...u,
      message:
        'looks like a GraphQL operation but is not marked: put /* GraphQL */ before the literal (or use the gql tag) so it is validated',
    })
  }
  if (documents.length === 0) {
    problems.push({
      file: '(none)',
      line: 0,
      message: 'no GraphQL operation found: the extractor is broken or --root is wrong',
    })
  }

  for (const p of problems) console.error(`${p.file}:${p.line}: ${p.message}`)
  console.log(
    `${documents.length} GraphQL documents checked against ${relative(process.cwd(), schemaPath) || schemaPath}: ${problems.length} problem(s)`,
  )
  return problems.length === 0 ? 0 : 1
}

// realpath both sides: a symlinked path (macOS /var -> /private/var) must not skip main().
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}
