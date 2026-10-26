import { jsonrepair } from 'jsonrepair'
import type { ZodIssueLike } from './schemaError'

/** Max consecutive JSON-string unwraps on one leaf (handles multi-encoded payloads). */
const MAX_STRING_UNWRAP_DEPTH = 3

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const tryParseJsonValue = (raw: string): unknown | undefined => {
  const trimmed = raw.trim()
  if (!trimmed) return undefined

  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    // Repair only closed-looking containers (trailing commas etc.). Open fragments
    // like `{not-json` must stay strings — jsonrepair would invent keys.
    const closed =
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    if (!closed) return undefined
    try {
      return JSON.parse(jsonrepair(trimmed)) as unknown
    } catch {
      return undefined
    }
  }
}

/**
 * Unwrap a leaf that may be a JSON object/array encoded as a string (possibly nested).
 * Ordinary prose, paths, and non-container JSON scalars are left unchanged.
 */
const unwrapJsonStringLeaf = (raw: string): unknown => {
  let current: unknown = raw
  let container: object | unknown[] | undefined

  for (let depth = 0; depth < MAX_STRING_UNWRAP_DEPTH; depth += 1) {
    if (typeof current !== 'string') break
    const parsed = tryParseJsonValue(current)
    if (parsed === undefined) break
    if (Array.isArray(parsed) || isPlainObject(parsed)) {
      container = parsed
      break
    }
    if (typeof parsed === 'string') {
      current = parsed
      continue
    }
    break
  }

  return container === undefined ? raw : container
}

const normalizeValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    const unwrapped = unwrapJsonStringLeaf(value)
    if (unwrapped === value) return value
    return normalizeValue(unwrapped)
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item))
  }
  if (isPlainObject(value)) {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      output[key] = normalizeValue(item)
    }
    return output
  }
  return value
}

/**
 * Normalize tool-call args after the outer `arguments` JSON parse.
 * Single shared entry for all tools: expand nested fields that models
 * (incorrectly) re-encode as JSON strings, then callers run schema validation.
 */
export const normalizeToolCallArgs = (args: Record<string, unknown>): Record<string, unknown> => {
  const normalized = normalizeValue(args)
  if (!isPlainObject(normalized)) return args
  return normalized
}

export type ToolArgRepair = {
  path: Array<string | number>
  kind: 'boolean_string'
  from: string
  to: boolean
}

type RepairResult = {
  args: Record<string, unknown>
  repairs: ToolArgRepair[]
}

const cloneValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item))
  if (isPlainObject(value)) {
    const clone: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) clone[key] = cloneValue(item)
    return clone
  }
  return value
}

const readAtPath = (value: unknown, path: readonly (string | number)[]): unknown => {
  let current = value
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'number') {
      current = current[segment]
      continue
    }
    if (isPlainObject(current) && typeof segment === 'string') {
      current = current[segment]
      continue
    }
    return undefined
  }
  return current
}

const setAtPath = (
  value: unknown,
  path: readonly (string | number)[],
  next: unknown,
  index = 0
): unknown => {
  if (index >= path.length) return next
  const segment = path[index]
  if (Array.isArray(value) && typeof segment === 'number') {
    const clone = [...value]
    clone[segment] = setAtPath(clone[segment], path, next, index + 1)
    return clone
  }
  if (isPlainObject(value) && typeof segment === 'string') {
    return {
      ...value,
      [segment]: setAtPath(value[segment], path, next, index + 1)
    }
  }
  return value
}

const parseBooleanString = (value: unknown): boolean | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return undefined
}

const collectIssues = (
  issues: readonly ZodIssueLike[],
  parentPath: readonly PropertyKey[] = []
): ZodIssueLike[] => {
  const collected: ZodIssueLike[] = []
  for (const issue of issues) {
    const path = [...parentPath, ...(issue.path ?? [])]
    if (issue.code === 'invalid_union' && Array.isArray(issue.errors)) {
      for (const branch of issue.errors) collected.push(...collectIssues(branch, path))
      continue
    }
    collected.push({ ...issue, path })
  }
  return collected
}

/**
 * Repairs only unambiguous boolean strings at paths Zod identified as boolean fields.
 * Other values and all non-boolean fields remain untouched for normal validation.
 */
export const repairBooleanStringToolArgs = (
  args: Record<string, unknown>,
  issues: readonly ZodIssueLike[]
): RepairResult => {
  let repaired: unknown = cloneValue(args)
  const repairs: ToolArgRepair[] = []
  const seenPaths = new Set<string>()

  for (const issue of collectIssues(issues)) {
    if (issue.code !== 'invalid_type' || issue.expected !== 'boolean') continue
    const issuePath = issue.path ?? []
    const path = issuePath.filter(
      (segment): segment is string | number => typeof segment !== 'symbol'
    )
    if (path.length === 0 || path.length !== issuePath.length) continue
    const pathKey = JSON.stringify(path)
    if (seenPaths.has(pathKey)) continue
    const current = readAtPath(repaired, path)
    const parsed = parseBooleanString(current)
    if (parsed === undefined || typeof current !== 'string') continue
    repaired = setAtPath(repaired, path, parsed)
    repairs.push({ path: [...path], kind: 'boolean_string', from: current, to: parsed })
    seenPaths.add(pathKey)
  }

  return {
    args: isPlainObject(repaired) ? repaired : args,
    repairs
  }
}
