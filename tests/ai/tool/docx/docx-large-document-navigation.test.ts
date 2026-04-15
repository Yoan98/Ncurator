import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxOutlineResult,
  type DocxReadResult
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-large-document-navigation', async () => {
    await runBackendCase({
      caseId: 'docx-large-document-navigation',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证长文档下 outline/read 的定位链路。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(
          runtime.workspaceRoot,
          'large-navigation.docx',
          Array.from({ length: 80 }, (_, index) => ({
            type: 'paragraph' as const,
            text:
              index === 72
                ? `Section ${String(index + 1).padStart(2, '0')}: target keyword appears here.`
                : `Section ${String(index + 1).padStart(2, '0')}: regular filler paragraph.`
          }))
        )

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'large-navigation.docx',
            maxBlocks: 20
          })
          const read = await harness.invoke<DocxReadResult>('docx_read', {
            sourcePath: 'large-navigation.docx',
            query: 'target keyword',
          })

          return {
            outline,
            read
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.outline.totalBlockCount >= 80 &&
            result.outline.returnedBlockCount === 20 &&
            result.outline.truncated,
          {
            name: 'large-document-outline-stays-stable-under-truncation',
            message: '长文档 outline 应返回稳定 block 信息，并正确标记 maxBlocks 截断。',
            data: {
              totalBlockCount: result.outline.totalBlockCount,
              outlineCount: result.outline.returnedBlockCount,
              truncated: result.outline.truncated
            }
          }
        )

        runtime.assertThat(
          result.read.matches.length === 1 &&
            result.read.matches[0]?.type === 'paragraph' &&
            result.read.matches[0]?.text.includes('target keyword appears here'),
          {
            name: 'large-document-search-can-locate-and-read-target-block',
            message: 'docx_read 应能在长文档中稳定定位并精读目标 block。',
            data: {
              matches: result.read.matches
            }
          }
        )
      }
    })
  })
})
