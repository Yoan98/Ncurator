/* eslint-disable @typescript-eslint/explicit-function-return-type */
import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'

const BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  'electron'
])

const resolveLocalModule = (importerPath, specifier) => {
  if (!specifier.startsWith('.')) return null
  const candidate = path.resolve(path.dirname(importerPath), specifier)
  const candidates = [candidate, `${candidate}.js`, path.join(candidate, 'index.js')]
  return candidates.find((item) => fs.existsSync(item)) || null
}

export const readBundleGraph = (entryPath) => {
  if (!fs.existsSync(entryPath)) {
    throw new Error(`runtime bundle not found: ${entryPath}`)
  }

  const pending = [entryPath]
  const visited = new Set()
  const externalImports = new Set()
  while (pending.length > 0) {
    const currentPath = pending.pop()
    if (!currentPath || visited.has(currentPath)) continue
    visited.add(currentPath)
    const source = fs.readFileSync(currentPath, 'utf8')
    const importPatterns = [
      /require\(["']([^"']+)["']\)/gu,
      /require\.resolve\(["']([^"']+)["']\)/gu,
      /from\s+["']([^"']+)["']/gu,
      /import\(["']([^"']+)["']\)/gu
    ]
    for (const pattern of importPatterns) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1]
        const localPath = resolveLocalModule(currentPath, specifier)
        if (localPath) pending.push(localPath)
        else externalImports.add(specifier)
      }
    }
  }

  return { visited, externalImports }
}

export const packageNameFromSpecifier = (specifier) => {
  if (!specifier || BUILTIN_MODULES.has(specifier) || specifier.startsWith('node:')) return null
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

export const collectRuntimePackageNames = (entryPaths) => {
  const packageNames = new Set()
  for (const entryPath of entryPaths) {
    const graph = readBundleGraph(entryPath)
    for (const specifier of graph.externalImports) {
      const packageName = packageNameFromSpecifier(specifier)
      if (packageName) packageNames.add(packageName)
    }
  }
  return [...packageNames].sort()
}
