import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readBundleGraph } from './bundle-graph.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const mainOutDir = path.join(root, 'out', 'main')

const assertNoImports = (label, graph, forbidden) => {
  const found = forbidden.filter((name) => graph.externalImports.has(name))
  if (found.length > 0) {
    throw new Error(`${label} must not import ${found.join(', ')}`)
  }
}

const mainGraph = readBundleGraph(path.join(mainOutDir, 'index.js'))
const prepareWorkerGraph = readBundleGraph(path.join(mainOutDir, 'workspacePrepareWorker.js'))
const pdfWorkerGraph = readBundleGraph(path.join(mainOutDir, 'pdfWorker.js'))
const embeddingRuntimeGraph = readBundleGraph(path.join(mainOutDir, 'embeddingRuntimeProcess.js'))

assertNoImports('Electron main process', mainGraph, [
  '@huggingface/transformers',
  'onnxruntime-node'
])
assertNoImports('Workspace prepare worker', prepareWorkerGraph, [
  'electron',
  '@huggingface/transformers',
  'onnxruntime-node'
])
assertNoImports('PDF worker', pdfWorkerGraph, [
  'electron',
  '@huggingface/transformers',
  'onnxruntime-node'
])
const drawingGraph = readBundleGraph(path.join(mainOutDir, 'drawingCli.js'))
assertNoImports('Drawing CLI', drawingGraph, ['electron'])
for (const asset of [
  'drawing-sdk.mjs',
  'video-scene.mjs',
  'scene-sans.otf',
  'media-font-OFL.txt'
]) {
  if (!fs.statSync(path.join(mainOutDir, asset)).isFile())
    throw new Error(`Missing media runtime asset: ${asset}`)
}

assertNoImports('Embedding utility process', embeddingRuntimeGraph, ['electron'])

if (!embeddingRuntimeGraph.externalImports.has('@huggingface/transformers')) {
  throw new Error('embedding utility process must own the Transformers runtime')
}

console.log('[build] runtime bundle boundaries verified')
