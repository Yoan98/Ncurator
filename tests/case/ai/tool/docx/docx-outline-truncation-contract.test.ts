import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxOutlineResult } from './testUtils'
import { filterAiRunEventsByType } from '../../human/testUtils'

describe('ai tool docx backend', () => {
  it('docx-outline-truncation-contract', async () => {
    await runBackendCase({
      caseId: 'docx-outline-truncation-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 docx_read_outline 会明确暴露截断事实，而不是只返回原始计数。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(
          runtime.workspaceRoot,
          'outline-truncation.docx',
          Array.from({ length: 40 }, (_, index) => ({
            type: 'paragraph' as const,
            text: `第 ${String(index + 1)} 段。`
          }))
        )

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: path.join(runtime.workspaceRoot, 'outline-truncation.docx'),
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 9 }]
          })
          const outlineEvent = filterAiRunEventsByType(
            runtime.eventCollector.snapshot(),
            'tool_call_result'
          )
            .filter((event) => event.toolName === 'docx_read_outline')
            .at(-1)

          return {
            outline,
            outlineEvent
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.outline.blocks.length === 10 &&
            result.outline.blocks[0]?.blockIndex === 0 &&
            result.outline.blocks[9]?.blockIndex === 9,
          {
            name: 'docx-outline-surfaces-truncation-fact',
            message: 'outline 结果应返回指定范围内的结构块。',
            data: result.outline
          }
        )
      }
    })
  })
})
