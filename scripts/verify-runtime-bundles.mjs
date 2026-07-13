import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainOutDir = path.join(root, 'out', 'main')

const resolveLocalModule = (importerPath, specifier) => {
  if (!specifier.startsWith('.')) return null
  const candidate = path.resolve(path.dirname(importerPath), specifier)
  if (fs.existsSync(candidate)) return candidate
  if (fs.existsSync(`${candidate}.js`)) return `${candidate}.js`
  return null
}

const readBundleGraph = (entryName) => {
  const entryPath = path.join(mainOutDir, entryName)
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

const assertNoImports = (label, graph, forbidden) => {
  const found = forbidden.filter((name) => graph.externalImports.has(name))
  if (found.length > 0) {
    throw new Error(`${label} must not import ${found.join(', ')}`)
  }
}

const mainGraph = readBundleGraph('index.js')
const prepareWorkerGraph = readBundleGraph('workspacePrepareWorker.js')
const embeddingRuntimeGraph = readBundleGraph('embeddingRuntimeProcess.js')

assertNoImports('Electron main process', mainGraph, [
  '@huggingface/transformers',
  'onnxruntime-node'
])
assertNoImports('Workspace prepare worker', prepareWorkerGraph, [
  'electron',
  '@huggingface/transformers',
  'onnxruntime-node'
])
assertNoImports('Embedding utility process', embeddingRuntimeGraph, ['electron'])

if (!embeddingRuntimeGraph.externalImports.has('@huggingface/transformers')) {
  throw new Error('embedding utility process must own the Transformers runtime')
}

console.log('[build] runtime bundle boundaries verified')
