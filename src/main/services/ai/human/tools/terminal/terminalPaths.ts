import path from 'node:path'

export const isPathInsideRoot = (candidatePath: string, rootPath: string) => {
  const root = path.resolve(rootPath)
  const candidate = path.resolve(candidatePath)
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export const resolveWorkspacePath = (input: {
  rawPath: string
  cwd: string
  rootPath: string
}): string | null => {
  const raw = String(input.rawPath || '').trim()
  if (!raw) return null
  const base = raw.startsWith('/') ? raw : path.resolve(input.cwd, raw)
  const resolved = path.resolve(base)
  if (!isPathInsideRoot(resolved, input.rootPath)) return null
  return resolved
}
