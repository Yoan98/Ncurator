const FILE_SYSTEM_ILLEGAL_CHARS = /[/\\:*?"<>|]+/g
const DUPLICATE_DASHES = /-{2,}/g
const DUPLICATE_SPACES = /\s{2,}/g
const LEADING_TRAILING_NOISE = /^[\s.-]+|[\s.-]+$/g

export const sanitizeFileNameForPath = (input: {
  value: string
  fallback: string
}): string => {
  const normalized = String(input.value || '').normalize('NFC').trim()
  const safe = normalized
    .replace(FILE_SYSTEM_ILLEGAL_CHARS, '-')
    .replace(DUPLICATE_SPACES, ' ')
    .replace(DUPLICATE_DASHES, '-')
    .replace(LEADING_TRAILING_NOISE, '')

  return safe || input.fallback
}
