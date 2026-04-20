import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxMutationResult,
  type DocxReadResult,
  type DocxSearchResult
} from './testUtils'

const SAMPLE_DOCX_FIXTURE = path.resolve('tests/fixtures/ai/docx/sample-edit.docx')

describe('ai tool docx backend', () => {
  it('docx-minimal-edit-flow', async () => {
    await runBackendCase({
      caseId: 'docx-minimal-edit-flow',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证修改 docx 某一段话的最小工具链能独立跑通。',
      fixtures: [SAMPLE_DOCX_FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
          const harness = createDocxToolHarness(runtime)
        try {
          const sourcePath = runtime.getFixtureWorkspacePath(SAMPLE_DOCX_FIXTURE)
          const searchBefore = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath,
            query: 'Hello'
          })
          const readBefore = await harness.invoke<DocxReadResult>('docx_read', {
            sourcePath,
            fromBlockId: searchBefore.matches[0]!.blockId
          })
          const applied = await harness.invoke<DocxMutationResult>('docx_text_edit', {
            sourcePath,
            query: 'Hello',
            replace: 'Hi'
          })
          const searchAfter = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: applied.sourcePath,
            query: 'Hi'
          })
          const readAfter = await harness.invoke<DocxReadResult>('docx_read', {
            sourcePath: applied.sourcePath,
            fromBlockId: searchAfter.matches[0]!.blockId
          })
          return {
            searchBefore,
            readBefore,
            applied,
            searchAfter,
            readAfter
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.searchBefore.matches.length === 1 &&
            result.readBefore.blocks.length === 1 &&
            result.applied.currentRevisionRef !== result.readBefore.currentRevisionRef &&
            result.applied.changedBlocks.length === 1 &&
            result.applied.changedBlocks[0]?.action === 'replace_text',
          {
            name: 'minimal-edit-flow-produces-single-targeted-change',
            message: '最小编辑流程应生成新的修订，且只命中目标段落对应的 changedBlocks。',
            data: {
              originalVersionRef: result.readBefore.currentRevisionRef,
              currentRevisionRef: result.applied.currentRevisionRef,
              changedBlocks: result.applied.changedBlocks
            }
          }
        )

        runtime.assertThat(
          result.searchAfter.matches.length === 1 &&
            result.readAfter.blocks.length === 1 &&
            result.readAfter.blocks[0]?.bodyIndex === result.readBefore.blocks[0]?.bodyIndex &&
            result.applied.warnings.length === 0,
          {
            name: 'minimal-edit-flow-remains-readable-after-edit',
            message: '修改后应能继续被 search 消费，并暴露稳定的结构位置事实。',
            data: {
              searchAfter: result.searchAfter.matches,
              readAfter: result.readAfter.blocks,
              warnings: result.applied.warnings
            }
          }
        )
      }
    })
  })
})
