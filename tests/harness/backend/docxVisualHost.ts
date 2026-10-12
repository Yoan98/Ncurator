import fs from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, nativeImage } from 'electron'
import { createRealAiDepsFactory } from './realAiDepsFactory'
import { EventCollector } from '../core/eventCollector'
import { createHumanRuntimeCache } from '../../../src/main/services/ai/human/node/utils/runtimeCache'
import { buildDocxCapabilityTools } from '../../../src/main/services/ai/human/tools/docx'
import { releaseDocxRunSession } from '../../../src/main/services/ai/human/tools/docx/worker/docxWorkerClient'
import {
  buildNodeIndex,
  loadDocxBundle
} from '../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import { collectVisualNodeEntries } from '../../../src/main/services/ai/human/tools/docx/adapters/ooxml/types'
import type { JsonObject, JsonValue } from '../../../src/shared/types'

const [sourcePath, workspaceRoot, resultPath, runId] = process.argv.slice(-4)
const main = async (): Promise<void> => {
  await app.whenReady()
  const keepAlive = new BrowserWindow({ show: false })
  const events = new EventCollector()
  const deps = await createRealAiDepsFactory({
    mode: 'tool-real',
    runId,
    workspaceRoot,
    eventCollector: events
  })
  try {
    const ctx = deps.createAiRunContext({ runId, partnerId: 'docx-visual-reader' })
    const built = buildDocxCapabilityTools({
      ctx,
      cache: createHumanRuntimeCache(),
      runId,
      partnerId: ctx.partnerId,
      taskId: 'visual-read',
      workspaceRootPath: workspaceRoot,
      emitActivity: () => {}
    })
    const read = built.tools.find((tool) => tool.name === 'docx_read_nodes')!
    const bundle = await loadDocxBundle(await fs.readFile(sourcePath))
    const index = buildNodeIndex(
      bundle.documentDom,
      bundle.relationshipTargets,
      bundle.relationshipTypes
    )
    const targets = collectVisualNodeEntries(index).filter(([, visual]) =>
      ['chart', 'diagram', 'shape'].includes(visual.kind)
    )
    const images: JsonObject[] = []
    const visit = async (value: JsonValue): Promise<void> => {
      if (Array.isArray(value)) {
        for (const item of value) await visit(item)
        return
      }
      if (!value || typeof value !== 'object') return
      if (value.type === 'visual' && typeof value.imagePath === 'string') {
        const bytes = await fs.readFile(value.imagePath)
        const image = nativeImage.createFromBuffer(bytes)
        const size = image.getSize()
        const bitmap = image.toBitmap()
        let nonWhitePixels = 0
        for (let offset = 0; offset + 3 < bitmap.length; offset += 4) {
          if (
            bitmap[offset + 3] > 0 &&
            (bitmap[offset] < 245 || bitmap[offset + 1] < 245 || bitmap[offset + 2] < 245)
          )
            nonWhitePixels++
        }
        images.push({
          kind: value.kind,
          byteLength: bytes.length,
          width: size.width,
          height: size.height,
          nonWhitePixels,
          extension: path.extname(value.imagePath)
        })
      }
      for (const child of Object.values(value)) if (child !== undefined) await visit(child)
    }
    for (const [, visual] of targets) {
      const output = (await read.invoke({
        sourcePath,
        range: { type: 'node_index', fromNodeIndex: index.nodesById.get(visual.ownerNodeId)!.nodeIndex, toNodeIndex: index.nodesById.get(visual.ownerNodeId)!.nodeIndex }
      })) as JsonObject
      if (output.error) throw new Error(JSON.stringify(output))
      await visit(output)
    }
    await fs.writeFile(resultPath, JSON.stringify({ images, events: events.snapshot() }))
  } finally {
    await releaseDocxRunSession(runId)
    await deps.close()
    keepAlive.destroy()
  }
}
void main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
