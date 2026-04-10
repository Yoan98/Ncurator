import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxOpenResult, DocxOutlineResult } from './testUtils'
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
          const opened = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: 'outline-truncation.docx'
          })
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            docId: opened.docId,
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
            result.outline.summary.includes('结果已截断') &&
            result.outline.summary.includes('文档后续内容未包含') &&
            previewSummary.includes('结果已截断'),
          {
            name: 'docx-outline-surfaces-truncation-fact',
            message: 'outline 结果和事件预览都应明确说明结果已截断、后续内容未包含。',
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
