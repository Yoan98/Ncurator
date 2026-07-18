import path from 'node:path'
import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  buildBlockIndex,
  loadDocxBundle
} from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import { createDocxToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { type DocxMutationResult, type DocxReadResult, type DocxSearchResult } from './testUtils'

const SAMPLE_DOCX_FIXTURE = path.resolve('tests/fixtures/workspace/sample-edit.docx')

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
          const readBefore = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath,
            range: { type: 'block_ids', blockIds: [searchBefore.matches[0]!.blockId] }
          })
          const applied = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath,
            actions: [
              {
                type: 'replace_text',
                query: 'Hello',
                replace: 'Hi'
              }
            ]
          })
          const searchAfter = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: applied.sourcePath,
            query: 'Hi'
          })
          const readAfter = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: applied.sourcePath,
            range: { type: 'block_ids', blockIds: [searchAfter.matches[0]!.blockId] }
          })
          const persistedBundle = await loadDocxBundle(await fs.readFile(sourcePath))
          const persistedText = buildBlockIndex(persistedBundle.documentDom)
            .outline.map((block) => block.text)
            .join('\n')
          return {
            searchBefore,
            readBefore,
            applied,
            searchAfter,
            readAfter,
            persistedText
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.searchBefore.matches.length === 1 &&
            result.readBefore.blocks.length === 1 &&
            result.applied.changedBlocks.length === 1 &&
            result.applied.changedBlocks[0]?.action === 'replace_text' &&
            result.readBefore.blocks[0]?.blockId === result.readAfter.blocks[0]?.blockId &&
            /^blk_[0-9a-f]{32}$/.test(result.readAfter.blocks[0]?.blockId || '') &&
            !('currentRevisionRef' in result.applied) &&
            !('currentRevisionRef' in result.readAfter) &&
            result.persistedText.includes('Hi') &&
            !result.persistedText.includes('Hello'),
          {
            name: 'minimal-edit-flow-produces-single-targeted-change',
            message: '最小编辑流程应只修改目标段落，并在修改后保持稳定 block UUID。',
            data: {
              changedBlocks: result.applied.changedBlocks
            }
          }
        )

        runtime.assertThat(
          result.searchAfter.matches.length === 1 &&
            result.readAfter.blocks.length === 1 &&
            result.readAfter.blocks[0]?.blockIndex === result.readBefore.blocks[0]?.blockIndex &&
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
