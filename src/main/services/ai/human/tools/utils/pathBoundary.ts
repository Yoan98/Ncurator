import fs from 'node:fs'
import path from 'node:path'

const realPathCache = new Map<string, string>()

const realpathNearestExisting = (value: string, pathApi: typeof path): string => {
  const cached = realPathCache.get(value)
  if (cached) return cached
  let resolved: string
  try {
    resolved = fs.realpathSync.native(value)
  } catch {
    const parent = pathApi.dirname(value)
    if (parent === value) return value
    resolved = pathApi.join(realpathNearestExisting(parent, pathApi), pathApi.basename(value))
  }
  realPathCache.set(value, resolved)
  return resolved
}

export const isPathInsideRoot = (candidatePath: string, rootPath: string): boolean => {
  const useWindowsPaths =
    /^[a-z]:[\\/]/i.test(candidatePath) ||
    /^[a-z]:[\\/]/i.test(rootPath) ||
    /^\\\\/.test(candidatePath) ||
    /^\\\\/.test(rootPath)
  const pathApi = useWindowsPaths ? path.win32 : path
  const root = pathApi.resolve(rootPath)
  const candidate = pathApi.resolve(candidatePath)
  const relativePath = pathApi.relative(root, candidate)
  if (relativePath === '' || (!relativePath.startsWith('..') && !pathApi.isAbsolute(relativePath))) {
    return true
  }

  const resolvedRoot = realpathNearestExisting(root, pathApi)
  const resolvedCandidate = realpathNearestExisting(candidate, pathApi)
  const resolvedRelativePath = pathApi.relative(resolvedRoot, resolvedCandidate)
  return (
    resolvedRelativePath === '' ||
    (!resolvedRelativePath.startsWith('..') && !pathApi.isAbsolute(resolvedRelativePath))
  )
}
