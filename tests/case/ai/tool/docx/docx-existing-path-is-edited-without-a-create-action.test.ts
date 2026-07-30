import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  docxParagraphNode,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('ai tool docx backend', () => {
  it('docx-existing-path-is-edited-without-a-create-action', async () => {
    await runBackendCase({
      caseId: 'docx-existing-path-is-edited-without-a-create-action',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 docx_edit 根据 sourcePath 是否存在自动选择创建或编辑。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const existingPath = await writeTestDocxFile(runtime.workspaceRoot, 'already-exists.docx', [
          { type: 'paragraph', text: '已有内容。' }
        ])
        const beforeBytes = await fs.readFile(existingPath)
        const harness = createDocxToolHarness(runtime)
        try {
          const edited = await harness.invoke<Record<string, unknown>>('docx_edit', {
            sourcePath: 'already-exists.docx',
            actions: [
              {
                type: 'insert_blocks',
                position: 'after',
                blocks: [docxParagraphNode('追加内容。')]
              },
              {
                type: 'insert_blocks',
                position: 'before',
                blocks: [docxParagraphNode('前置内容。')]
              }
            ]
          })
          const outline = await harness.invoke<{
            blocks: Array<{ type: string; text: string }>
          }>('docx_read_outline', {
            sourcePath: 'already-exists.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 20 }]
          })
          const afterBytes = await fs.readFile(existingPath)

          return {
            edited,
            paragraphTexts: outline.blocks
              .filter((block) => block.type === 'paragraph')
              .map((block) => block.text),
            trackedSourceCount: harness.state.replaySessionBySourcePath.size,
            changed: Buffer.compare(beforeBytes, afterBytes) !== 0
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.changed === true &&
            result.paragraphTexts[0] === '前置内容。' &&
            result.paragraphTexts.at(-1) === '追加内容。',
          {
            name: 'docx-existing-path-edits-in-place',
            message: '目标已存在时应直接编辑，无锚点 before/after 应分别定位到文档首尾。',
            data: result
          }
        )

        runtime.assertThat(result.trackedSourceCount === 1, {
          name: 'docx-existing-path-opens-session',
          message: '编辑已有文件后应保留当前 run 的 docx session。',
          data: {
            trackedSourceCount: result.trackedSourceCount
          }
        })
      }
    })
  })
})
