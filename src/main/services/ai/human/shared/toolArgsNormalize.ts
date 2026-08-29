import { jsonrepair } from 'jsonrepair'

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
