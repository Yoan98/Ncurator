import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  buildNodeIndex,
  loadDocxBundle
} from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import { collectVisualNodeEntries } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/types'

const require = createRequire(import.meta.url)
const fixturePath = path.resolve('tests/fixtures/backend/docx-visual-kinds.docx')

type RenderBinding = {
  kind: 'chart' | 'diagram' | 'shape'
  nodeIndex: number
  visualIndexInNode: number
  visualCountInNode: number
}

const runElectronRenderer = async (
  tempDir: string,
  bindings: RenderBinding[]
): Promise<
  Array<{
    kind: RenderBinding['kind']
    error?: string
    byteLength?: number
    width?: number
    height?: number
    nonWhitePixels?: number
  }>
> => {
  const sourcePath = path.resolve('src/main/services/ai/human/tools/docx/utils/renderVisual.ts')
  const transpiled = ts.transpileModule(await fs.readFile(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true
    },
    fileName: sourcePath
  }).outputText
  const rendererPath = path.join(tempDir, 'renderVisual.mjs')
  const runnerPath = path.join(tempDir, 'runner.cjs')
  const resultPath = path.join(tempDir, 'result.json')
  await fs.writeFile(rendererPath, transpiled)
  await fs.writeFile(
    runnerPath,
    `const fs = require('node:fs/promises')
const { app, BrowserWindow, nativeImage } = require('electron')

const [sourcePath, encodedBindings, resultPath] = process.argv.slice(-3)
const bindings = JSON.parse(Buffer.from(encodedBindings, 'base64').toString('utf8'))

;(async () => {
  await app.whenReady()
  const keepAliveWindow = new BrowserWindow({ show: false })
  console.error('electron-ready')
  const { renderDocxVisualToPng } = await import('./renderVisual.mjs')
  const results = []
  for (const binding of bindings) {
    console.error('render-start', binding.kind)
    const rendered = await renderDocxVisualToPng({ sourcePath, ...binding })
    console.error('render-end', binding.kind, rendered.error || rendered.data?.byteLength || 0)
    if (!rendered.data) {
      results.push({ kind: binding.kind, error: rendered.error || 'missing data' })
      continue
    }
    const image = nativeImage.createFromBuffer(rendered.data)
    const size = image.getSize()
    const bitmap = image.toBitmap()
    let nonWhitePixels = 0
    for (let offset = 0; offset + 3 < bitmap.length; offset += 4) {
      const blue = bitmap[offset]
      const green = bitmap[offset + 1]
      const red = bitmap[offset + 2]
      const alpha = bitmap[offset + 3]
      if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) nonWhitePixels += 1
    }
    results.push({
      kind: binding.kind,
      byteLength: rendered.data.byteLength,
      width: size.width,
      height: size.height,
      nonWhitePixels
    })
  }
  await fs.writeFile(resultPath, JSON.stringify(results))
  console.error('result-written')
  keepAliveWindow.destroy()
  app.quit()
})().catch((error) => {
  console.error(error)
  app.exit(1)
})
`
  )

  const electronPath = require('electron') as string
  const encodedBindings = Buffer.from(JSON.stringify(bindings)).toString('base64')
  await new Promise<void>((resolve, reject) => {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electronPath, [runnerPath, fixturePath, encodedBindings, resultPath], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stderr = ''
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(
        new Error(`DOCX Electron visual renderer timed out; stdout=${stdout}; stderr=${stderr}`)
      )
    }, 25_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', async (code) => {
      clearTimeout(timeout)
      const resultExists = await fs
        .access(resultPath)
        .then(() => true)
        .catch(() => false)
      if (code === 0 && resultExists) resolve()
      else
        reject(
          new Error(
            `DOCX Electron visual renderer exited with ${String(code)}; result=${String(resultExists)}; stdout=${stdout}; stderr=${stderr}`
          )
        )
    })
  })
  return JSON.parse(await fs.readFile(resultPath, 'utf8'))
}

describe('docx non-image visual rendering', () => {
  it('renders chart, diagram, and shape fixtures to nonblank images in Electron', async () => {
    const bundle = await loadDocxBundle(await fs.readFile(fixturePath))
    const index = buildNodeIndex(
      bundle.documentDom,
      bundle.relationshipTargets,
      bundle.relationshipTypes
    )
    expect(collectVisualNodeEntries(index).map(([, visual]) => visual.kind)).toEqual([
      'image',
      'chart',
      'diagram',
      'shape',
      'embedded_object'
    ])

    const bindings = collectVisualNodeEntries(index)
      .filter(
        (entry): entry is [string, (typeof entry)[1] & { kind: RenderBinding['kind'] }] =>
          entry[1].kind === 'chart' || entry[1].kind === 'diagram' || entry[1].kind === 'shape'
      )
      .map(([nodeId, visual]) => {
        const owner = index.nodesById.get(visual.ownerNodeId)!
        const visualsInNode = collectVisualNodeEntries(index).filter(([, candidate]) => {
          const candidateOwner = index.nodesById.get(candidate.ownerNodeId)
          return candidateOwner?.nodeIndex === owner.nodeIndex
        })
        return {
          kind: visual.kind,
          nodeIndex: owner.nodeIndex,
          visualIndexInNode: visualsInNode.findIndex(([id]) => id === nodeId),
          visualCountInNode: visualsInNode.length
        }
      })

    const tempRoot = path.resolve('tests/.tmp')
    await fs.mkdir(tempRoot, { recursive: true })
    const tempDir = await fs.mkdtemp(path.join(tempRoot, 'docx-visual-render-'))
    try {
      const results = await runElectronRenderer(tempDir, bindings)
      expect(results).toHaveLength(3)
      results.forEach((result) => {
        expect(result.error).toBeUndefined()
        expect(result.byteLength).toBeGreaterThan(1_000)
        expect(result.width).toBeGreaterThan(100)
        expect(result.height).toBeGreaterThan(50)
        expect(result.nonWhitePixels).toBeGreaterThan(1_000)
      })
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }, 30_000)
})
