import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxOutlineResult, DocxReadResult, DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-outline-read-search-do-not-create-replay-session', async () => {
    await runBackendCase({
      caseId: 'docx-outline-read-search-do-not-create-replay-session',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证纯读 docx 工具只创建 read session，不会提前创建 replay session。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'read-only.docx', [
          { type: 'heading', text: '深度学习与图形学复习总结', level: 1 },
          { type: 'paragraph', text: '过度拟合会降低模型的泛化能力。' },
          { type: 'paragraph', text: '反走样用于减少图形边缘锯齿。' }
        ])
        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: 'read-only.docx',
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 1 }]
          })
          const read = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: 'read-only.docx',
            range: {
              type: 'block_index',
              fromBlockIndex: 0,
              toBlockIndex: 1
            }
          })
          const search = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'read-only.docx',
            query: '反走样',
            mode: 'literal'
          })

          return {
            outline,
            read,
            search,
            readSessionCount: harness.state.readSessionBySourcePath.size,
            replaySessionCount: harness.state.replaySessionBySourcePath.size
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.outline.currentRevisionRef === 'v1' &&
            result.read.currentRevisionRef === 'v1' &&
            result.search.currentRevisionRef === 'v1' &&
            result.readSessionCount === 1 &&
            result.replaySessionCount === 0,
          {
            name: 'docx-read-only-tools-stay-in-read-session',
            message: 'outline/read/search 应只创建 read session，不应提前进入 replay session。',
            data: result
          }
        )
      }
    })
  })
})
