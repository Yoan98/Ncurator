import path from 'node:path'

const DOCUMENT_PART = 'word/document.xml'

export const resolveDocxRelationshipTarget = (
  target: string,
  sourcePart: string = DOCUMENT_PART
): string | undefined => {
  const normalizedTarget = String(target || '')
    .trim()
    .replace(/\\/g, '/')
  if (!normalizedTarget) return undefined

  const baseDir = path.posix.dirname(sourcePart)
  const resolved = normalizedTarget.startsWith('/')
    ? path.posix.normalize(normalizedTarget.slice(1))
    : path.posix.normalize(path.posix.join(baseDir, normalizedTarget))

  if (!resolved || resolved === '.' || resolved.startsWith('../') || resolved.includes('/../')) {
    return undefined
  }
  return resolved
}
