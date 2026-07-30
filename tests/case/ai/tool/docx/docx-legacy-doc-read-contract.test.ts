import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, docxParagraphNode } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type {
  DocxFailureResult,
  DocxOutlineResult,
  DocxReadResult,
  DocxSearchResult
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-legacy-doc-read-contract', async () => {
    await runBackendCase({
      caseId: 'docx-legacy-doc-read-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: 'legacy .doc is readable through the existing docx-read tools',
      fixtures: ['tests/fixtures/legacy-doc/legacy-readable.doc'],
      runMode: 'single',
      execute: async (runtime) => {
        const legacyDocPath = path.join(runtime.workspaceRoot, 'legacy-doc', 'legacy-readable.doc')
        const beforeBytes = await fs.readFile(legacyDocPath)
        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'legacy-doc/legacy-readable.doc',
            ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
          })
          const firstBlock = outline.blocks[0]
          const read = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: 'legacy-doc/legacy-readable.doc',
            range: {
              type: 'block_index',
              fromBlockIndex: 0,
              toBlockIndex: 1
            }
          })
          const firstBlockId = outline.blocks[0]!.blockId
          const readByIds = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: 'legacy-doc/legacy-readable.doc',
            range: {
              type: 'block_ids',
              blockIds: [firstBlockId]
            }
          })
          const search = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'legacy-doc/legacy-readable.doc',
            query: 'Unicode characters',
            mode: 'literal'
          })
          const regexSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'legacy-doc/legacy-readable.doc',
            query: 'Unicode\\s+characters',
            mode: 'regex'
          })
          const failure = await harness.invoke<DocxFailureResult>('docx_edit', {
            sourcePath: 'legacy-doc/legacy-readable.doc',
            actions: [
              {
                type: 'replace_text',
                query: 'Unicode characters',
                replace: 'changed'
              }
            ]
          })
          const uppercaseFailure = await harness.invoke<DocxFailureResult>('docx_edit', {
            sourcePath: 'legacy-doc/legacy-readable.DOC',
            actions: [
              {
                type: 'insert_blocks',
                position: 'after',
                blocks: [docxParagraphNode('changed')]
              }
            ]
          })
          const afterBytes = await fs.readFile(legacyDocPath)
          return {
            outline,
            firstBlock,
            read,
            readByIds,
            search,
            regexSearch,
            failure,
            uppercaseFailure,
            unchanged: Buffer.compare(beforeBytes, afterBytes) === 0,
            trackedReplaySessionCount: harness.state.replaySessionBySourcePath.size
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.outline.sourcePath.endsWith('legacy-readable.doc') &&
            result.outline.blocks.length > 0 &&
            result.firstBlock?.type === 'paragraph' &&
            result.firstBlock.text.includes('second test'),
          {
            name: 'legacy-doc-percent-outline-returns-paragraph-blocks',
            message: 'legacy .doc should support percent outline through docx-read',
            data: result.outline
          }
        )
        runtime.assertThat(
          result.readByIds.blocks.length === 1 &&
            result.readByIds.blocks[0]?.blockId === result.firstBlock?.blockId,
          {
            name: 'legacy-doc-block-ids-return-requested-blocks',
            message: 'legacy .doc should support blockIds reads',
            data: result.readByIds
          }
        )
        runtime.assertThat(
          result.read.blocks.length > 0 &&
            result.read.blocks.every((block) => block.type === 'paragraph') &&
            result.read.blocks.some((block) => block.text.includes('reviewing')),
          {
            name: 'legacy-doc-block-range-returns-detailed-paragraphs',
            message: 'legacy .doc should support block range reads',
            data: result.read
          }
        )
        runtime.assertThat(result.search.totalMatchCount > 0 && result.search.matches.length > 0, {
          name: 'legacy-doc-literal-search-returns-matches',
          message: 'legacy .doc should support literal search',
          data: result.search
        })
        runtime.assertThat(
          result.regexSearch.totalMatchCount > 0 && result.regexSearch.matches.length > 0,
          {
            name: 'legacy-doc-regex-search-returns-matches',
            message: 'legacy .doc should support regex search',
            data: result.regexSearch
          }
        )
        runtime.assertThat(
          result.failure.error.includes('不支持写入旧版 .doc') &&
            result.failure.decisionHint?.code === 'legacy_doc_edit_unsupported' &&
            result.failure.decisionHint?.instruction ===
              '不要继续尝试编辑 .doc 文件，跳过它继续推进。' &&
            result.uppercaseFailure.decisionHint?.code === 'legacy_doc_edit_unsupported' &&
            result.unchanged &&
            result.trackedReplaySessionCount === 0,
          {
            name: 'legacy-doc-edit-returns-guided-unsupported-error',
            message: 'legacy .doc edit should fail before mutation with the decision hint',
            data: result.failure
          }
        )
      }
    })
  })
})
