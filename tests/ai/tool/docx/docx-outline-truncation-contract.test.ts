import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
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
      description: '验证 docx_outline 会明确暴露截断事实，而不是只返回原始计数。',
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
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'outline-truncation.docx',
            maxBlocks: 10
          })
          const outlineEvent = filterAiRunEventsByType(runtime.eventCollector.snapshot(), 'tool_call_result')
            .filter((event) => event.toolName === 'docx_outline')
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
        const preview =
          result.outlineEvent && typeof result.outlineEvent.outputPreview === 'object'
            ? result.outlineEvent.outputPreview
            : null
        const previewSummary =
          preview && 'summary' in preview && typeof preview.summary === 'string'
            ? preview.summary
            : ''

        runtime.assertThat(
          result.outline.truncated &&
            result.outline.returnedBlockCount === 10 &&
            result.outline.totalBlockCount > result.outline.returnedBlockCount,
          {
            name: 'docx-outline-surfaces-truncation-fact',
            message: 'outline 结果应明确暴露 returnedBlockCount、totalBlockCount 与 truncation 事实。',
            data: {
              outline: result.outline,
              outputPreview: result.outlineEvent?.outputPreview
            }
          }
        )
      }
    })
  })
})
