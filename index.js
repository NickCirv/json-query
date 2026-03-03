#!/usr/bin/env node
/**
 * json-query — Query JSON with human-readable path syntax.
 * Like jq but actually learnable. Zero dependencies.
 */

import { readFileSync, existsSync } from 'fs'

// ─── CLI argument parsing ────────────────────────────────────────────────────

const args = process.argv.slice(2)
let query = null
let filePath = null
let pretty = false
let raw = false
let compact = false
let nullOnMiss = false

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--pretty') { pretty = true }
  else if (arg === '-r' || arg === '--raw') { raw = true }
  else if (arg === '-c' || arg === '--compact') { compact = true }
  else if (arg === '--null-on-miss') { nullOnMiss = true }
  else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0) }
  else if (query === null) { query = arg }
  else if (filePath === null) { filePath = arg }
}

if (query === null) {
  printHelp()
  process.exit(1)
}

// ─── Input: file or stdin ────────────────────────────────────────────────────

async function readInput () {
  if (filePath) {
    if (!existsSync(filePath)) {
      error('File not found: ' + filePath)
    }
    return readFileSync(filePath, 'utf8')
  }

  if (process.stdin.isTTY) {
    printHelp()
    process.exit(1)
  }

  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', c => chunks.push(c))
    process.stdin.on('end', () => resolve(chunks.join('')))
    process.stdin.on('error', reject)
  })
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

const TK = {
  DOT: 'DOT',
  DOTDOT: 'DOTDOT',
  IDENT: 'IDENT',
  LBRACKET: 'LBRACKET',
  RBRACKET: 'RBRACKET',
  NUMBER: 'NUMBER',
  STAR: 'STAR',
  PIPE: 'PIPE',
  QUESTION: 'QUESTION',
  STRING: 'STRING',
  EOF: 'EOF',
}

function tokenize (expr) {
  const tokens = []
  let i = 0

  while (i < expr.length) {
    if (/\s/.test(expr[i])) { i++; continue }

    if (expr[i] === '|') { tokens.push({ type: TK.PIPE }); i++; continue }

    if (expr[i] === '.' && expr[i + 1] === '.') {
      tokens.push({ type: TK.DOTDOT }); i += 2
      let key = ''
      while (i < expr.length && /[\w$]/.test(expr[i])) { key += expr[i++] }
      if (key) tokens.push({ type: TK.IDENT, value: key })
      continue
    }

    if (expr[i] === '.') { tokens.push({ type: TK.DOT }); i++; continue }
    if (expr[i] === '[') { tokens.push({ type: TK.LBRACKET }); i++; continue }
    if (expr[i] === ']') { tokens.push({ type: TK.RBRACKET }); i++; continue }
    if (expr[i] === '*') { tokens.push({ type: TK.STAR }); i++; continue }
    if (expr[i] === '?') { tokens.push({ type: TK.QUESTION }); i++; continue }

    if (/\d/.test(expr[i]) || (expr[i] === '-' && /\d/.test(expr[i + 1]))) {
      let num = ''
      if (expr[i] === '-') { num += expr[i++] }
      while (i < expr.length && /\d/.test(expr[i])) { num += expr[i++] }
      tokens.push({ type: TK.NUMBER, value: parseInt(num, 10) }); continue
    }

    if (expr[i] === '"' || expr[i] === "'") {
      const quote = expr[i++]
      let str = ''
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\' && i + 1 < expr.length) { i++; str += expr[i++] }
        else { str += expr[i++] }
      }
      i++
      tokens.push({ type: TK.STRING, value: str }); continue
    }

    if (/[\w$]/.test(expr[i])) {
      let ident = ''
      while (i < expr.length && /[\w$]/.test(expr[i])) { ident += expr[i++] }
      tokens.push({ type: TK.IDENT, value: ident }); continue
    }

    i++
  }

  tokens.push({ type: TK.EOF })
  return tokens
}

// ─── Parser → AST ────────────────────────────────────────────────────────────

function parse (expr) {
  const tokens = tokenize(expr)
  let pos = 0

  function peek () { return tokens[pos] }
  function consume () { return tokens[pos++] }
  function expect (type) {
    const t = consume()
    if (t.type !== type) throw new Error('Expected ' + type + ', got ' + t.type)
    return t
  }

  function parseSegments () {
    const segs = []
    while (peek().type !== TK.EOF && peek().type !== TK.PIPE) {
      const seg = parseSegment()
      if (seg) segs.push(seg)
    }
    return segs
  }

  function parseSegment () {
    const t = peek()

    if (t.type === TK.DOTDOT) {
      consume()
      const key = peek().type === TK.IDENT ? consume().value : null
      return { kind: 'recursive', key }
    }

    if (t.type === TK.DOT) {
      consume()
      const next = peek()

      if (next.type === TK.STAR) {
        consume()
        return { kind: 'values' }
      }

      if (next.type === TK.IDENT) {
        const ident = consume().value
        const FUNCS = ['length', 'keys', 'values', 'unique', 'sort', 'flatten', 'reverse', 'first', 'last', 'type', 'not']
        if (FUNCS.includes(ident)) return { kind: 'func', name: ident }

        if (ident === 'sort_by') {
          let field = ''
          let limit = 20
          while (peek().type !== TK.EOF && limit-- > 0) {
            const tt = consume()
            if (tt.type === TK.IDENT) { field = tt.value; break }
          }
          while (peek().type !== TK.EOF && peek().type !== TK.DOT && peek().type !== TK.PIPE && peek().type !== TK.LBRACKET) {
            consume()
          }
          return { kind: 'sort_by', field }
        }

        return { kind: 'key', key: ident }
      }

      return { kind: 'identity' }
    }

    if (t.type === TK.LBRACKET) {
      consume()
      const inner = peek()

      if (inner.type === TK.RBRACKET) {
        consume()
        return { kind: 'iter' }
      }

      if (inner.type === TK.QUESTION) {
        consume()
        // collect tokens until ] for filter — raw re-parse handles it
        let depth = 0
        let limit = 50
        while (peek().type !== TK.EOF && limit-- > 0) {
          const tt = peek()
          if (tt.type === TK.RBRACKET && depth === 0) break
          if (tt.type === TK.LBRACKET) depth++
          if (tt.type === TK.RBRACKET) depth--
          consume()
        }
        if (peek().type === TK.RBRACKET) consume()
        return { kind: 'filter', expr: null }
      }

      if (inner.type === TK.NUMBER) {
        const idx = consume().value
        expect(TK.RBRACKET)
        return { kind: 'index', index: idx }
      }

      consume()
      return null
    }

    if (t.type === TK.STAR) {
      consume()
      return { kind: 'values' }
    }

    consume()
    return { kind: 'identity' }
  }

  const pipes = []
  pipes.push(parseSegments())
  while (peek().type === TK.PIPE) {
    consume()
    pipes.push(parseSegments())
  }

  return pipes
}

// ─── Filter expression parser (raw string for accuracy) ──────────────────────

function parseFilterRaw (raw) {
  const match = raw.match(/^\s*\.(\w+)\s*(==|!=|>=|<=|>|<|contains)\s*(.+)\s*$/)
  if (!match) return null
  const [, field, op, rawVal] = match
  let value
  const v = rawVal.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    value = v.slice(1, -1)
  } else if (v === 'true') value = true
  else if (v === 'false') value = false
  else if (v === 'null') value = null
  else if (!isNaN(Number(v))) value = Number(v)
  else value = v
  return { field, op, value }
}

function evalFilter (item, filterExpr) {
  const { field, op, value } = filterExpr
  if (field === null) return true
  const actual = item != null && typeof item === 'object' ? item[field] : undefined

  if (op === '==') return actual == value // eslint-disable-line eqeqeq
  if (op === '!=') return actual != value // eslint-disable-line eqeqeq
  if (op === '>') return typeof actual === 'number' ? actual > value : false
  if (op === '<') return typeof actual === 'number' ? actual < value : false
  if (op === '>=') return typeof actual === 'number' ? actual >= value : false
  if (op === '<=') return typeof actual === 'number' ? actual <= value : false
  if (op === 'contains') {
    if (typeof actual === 'string') return actual.includes(String(value))
    if (Array.isArray(actual)) return actual.includes(value)
    return false
  }
  return true
}

// ─── Executor ────────────────────────────────────────────────────────────────

function applySegment (data, seg, rawFilterStr) {
  if (data === undefined || data === null) return data

  switch (seg.kind) {
    case 'identity': return data

    case 'key':
      if (typeof data !== 'object' || Array.isArray(data)) return undefined
      return data[seg.key]

    case 'index': {
      if (!Array.isArray(data)) return undefined
      const idx = seg.index < 0 ? data.length + seg.index : seg.index
      return data[idx]
    }

    case 'iter':
      if (Array.isArray(data)) return data
      if (typeof data === 'object' && data !== null) return Object.values(data)
      return undefined

    case 'filter': {
      if (!Array.isArray(data)) return undefined
      const filterExpr = rawFilterStr ? parseFilterRaw(rawFilterStr) : null
      if (!filterExpr) return data
      return data.filter(item => evalFilter(item, filterExpr))
    }

    case 'values':
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) return Object.values(data)
      return data

    case 'recursive':
      return recursiveSearch(data, seg.key)

    case 'func':
      return applyFunc(data, seg.name)

    case 'sort_by': {
      if (!Array.isArray(data)) return data
      const field = seg.field
      return [...data].sort((a, b) => {
        const av = a[field]; const bv = b[field]
        if (av < bv) return -1
        if (av > bv) return 1
        return 0
      })
    }

    default: return data
  }
}

function recursiveSearch (data, key) {
  const results = []
  function walk (node) {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
    } else {
      for (const [k, v] of Object.entries(node)) {
        if (!key || k === key) results.push(v)
        walk(v)
      }
    }
  }
  walk(data)
  return results.length === 1 ? results[0] : results
}

function applyFunc (data, name) {
  switch (name) {
    case 'length':
      if (Array.isArray(data)) return data.length
      if (typeof data === 'string') return data.length
      if (typeof data === 'object' && data !== null) return Object.keys(data).length
      return 0
    case 'keys':
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) return Object.keys(data)
      if (Array.isArray(data)) return data.map((_, i) => i)
      return []
    case 'values':
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) return Object.values(data)
      return data
    case 'unique':
      if (Array.isArray(data)) return [...new Set(data.map(v => JSON.stringify(v)))].map(v => JSON.parse(v))
      return data
    case 'sort':
      if (Array.isArray(data)) return [...data].sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b
        return String(a).localeCompare(String(b))
      })
      return data
    case 'flatten':
      if (Array.isArray(data)) return data.flat(Infinity)
      return data
    case 'reverse':
      if (Array.isArray(data)) return [...data].reverse()
      if (typeof data === 'string') return data.split('').reverse().join('')
      return data
    case 'first':
      if (Array.isArray(data)) return data[0]
      return data
    case 'last':
      if (Array.isArray(data)) return data[data.length - 1]
      return data
    case 'type':
      if (data === null) return 'null'
      if (Array.isArray(data)) return 'array'
      return typeof data
    case 'not':
      return !data
    default: return data
  }
}

// ─── Extract raw filter strings from query ────────────────────────────────────

function extractFilterStrings (queryStr) {
  const filters = []
  const re = /\[\?\s*([^\]]+)\]/g
  let m
  while ((m = re.exec(queryStr)) !== null) {
    filters.push(m[1])
  }
  return filters
}

// ─── Apply pipe segment ───────────────────────────────────────────────────────

function applyPipe (data, segments, filterStrings) {
  let filterIdx = 0
  let current = data
  // Track whether we've expanded into an array via iter/filter so subsequent
  // segments map over each element rather than applying to the array itself.
  let spreading = false

  for (const seg of segments) {
    if (spreading && Array.isArray(current)) {
      // Map this segment over every element of the spread array
      if (seg.kind === 'filter') {
        const rawStr = filterStrings[filterIdx++] || null
        // filter applies to the whole array, not per-element
        current = applySegment(current, seg, rawStr)
        // result is still an array — keep spreading
      } else {
        current = current.map(item => applySegment(item, seg, null))
          .filter(v => v !== undefined)
        // keep spreading
      }
    } else {
      if (seg.kind === 'filter') {
        const rawStr = filterStrings[filterIdx++] || null
        current = applySegment(current, seg, rawStr)
        spreading = Array.isArray(current)
      } else if (seg.kind === 'iter') {
        current = applySegment(current, seg, null)
        spreading = true // subsequent segments map over items
      } else {
        current = applySegment(current, seg, null)
      }
    }
    if (current === undefined) return undefined
  }
  return current
}

// ─── Main query engine ────────────────────────────────────────────────────────

function runQuery (json, queryStr) {
  let pipes
  try {
    pipes = parse(queryStr)
  } catch (e) {
    throw new Error('Parse error: ' + e.message)
  }

  const filterStrings = extractFilterStrings(queryStr)
  let current = json
  let filterOffset = 0

  for (let pi = 0; pi < pipes.length; pi++) {
    const segs = pipes[pi]
    const filterCount = segs.filter(s => s.kind === 'filter').length
    const pipeFilters = filterStrings.slice(filterOffset, filterOffset + filterCount)
    filterOffset += filterCount

    if (pi === 0) {
      current = applyPipe(current, segs, pipeFilters)
    } else {
      if (Array.isArray(current)) {
        current = current.map(item => applyPipe(item, segs, pipeFilters))
      } else {
        current = applyPipe(current, segs, pipeFilters)
      }
    }
  }

  return current
}

// ─── Output formatting ────────────────────────────────────────────────────────

function formatOutput (value) {
  if (value === undefined) {
    if (nullOnMiss) return 'null'
    return null
  }
  if (raw && typeof value === 'string') return value
  if (compact) return JSON.stringify(value)
  if (pretty || typeof value === 'object') return JSON.stringify(value, null, 2)
  if (typeof value === 'string') return JSON.stringify(value)
  return JSON.stringify(value)
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp () {
  console.log(`
json-query — Query JSON with human-readable path syntax

USAGE
  npx json-query '<query>' [file.json] [options]
  cat file.json | npx json-query '<query>' [options]

PATH SYNTAX
  .key          Object property
  [0] / [-1]   Array index / last item
  []            All array items
  ..key         Recursive search
  *             All values of object

FILTERS
  [? .age > 18]              Numeric comparison
  [? .name == "Nick"]        String equality
  [? .name contains "ick"]   String contains
  [? .active == true]        Boolean

PIPES
  .users[] | .name           Map over array, extract field

FUNCTIONS
  .length  .keys  .values  .unique  .sort  .sort_by(.field)
  .flatten  .reverse  .first  .last  .type  .not

OPTIONS
  --pretty        Pretty-print output (default for objects)
  -r, --raw       Raw string output (no quotes)
  -c, --compact   Compact single-line output
  --null-on-miss  Output null instead of error for missing paths
  -h, --help      Show this help

EXAMPLES
  json-query '.name' data.json
  json-query '.users[0].email' data.json
  json-query '.users[].name' data.json
  json-query '.users[? .age > 18] | .name' data.json
  json-query '..id' nested.json
  json-query '.tags.length' data.json
  cat api.json | json-query '.data[].id' -c
`)
}

// ─── Error helper ─────────────────────────────────────────────────────────────

function error (msg) {
  console.error('json-query error: ' + msg)
  process.exit(1)
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main () {
  let rawInput
  try {
    rawInput = await readInput()
  } catch (e) {
    error('Could not read input: ' + e.message)
  }

  let json
  try {
    json = JSON.parse(rawInput.trim())
  } catch (e) {
    error('Invalid JSON: ' + e.message)
  }

  let result
  try {
    result = runQuery(json, query)
  } catch (e) {
    error(e.message)
  }

  const out = formatOutput(result)
  if (out === null) {
    error('Path not found: ' + query)
  }

  console.log(out)
}

main()
