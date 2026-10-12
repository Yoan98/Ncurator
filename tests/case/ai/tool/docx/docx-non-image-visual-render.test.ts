import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { runElectronDocxRead } from '../../../../harness/backend/docxVisualRunner'

describe('ai tool DOCX visuals', () => {
  it('docx-non-image-visual-render', async () => {
    await runBackendCase({
      caseId: 'docx-non-image-visual-render',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      harnessMode: 'tool-real',
      description: '公开 DOCX 精读工具在真实 Electron 中产出非图片视觉节点的 PNG。',
      fixtures: ['tests/fixtures/workspace/docx-visual-kinds.docx'],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = runtime.getFixtureWorkspacePath(
          'tests/fixtures/workspace/docx-visual-kinds.docx'
        )
        const before = await fs.readFile(sourcePath)
        const result = await runElectronDocxRead(
          sourcePath,
          path.join(runtime.workspaceRoot, 'electron-host'),
          runtime.runId
        )
        result.events.forEach((event) => runtime.eventCollector.add(event))
        return { images: result.images, unchanged: before.equals(await fs.readFile(sourcePath)) }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.unchanged &&
            result.images.length === 3 &&
            ['chart', 'diagram', 'shape'].every((kind) =>
              result.images.some(
                (image) =>
                  image.kind === kind &&
                  image.extension === '.png' &&
                  image.byteLength > 1_000 &&
                  image.width > 100 &&
                  image.height > 50 &&
                  image.nonWhitePixels > 1_000
              )
            ),
          {
            name: 'docx-public-read-non-image-visuals',
            message: '精读返回三种可解码非空 PNG，源文档字节保持不变。',
            data: result
          }
        )
      }
    })
  }, 180_000)
})
