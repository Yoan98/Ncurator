import path from 'node:path'
import { describe, it } from 'vitest'
import type { DocxDetailedBlock, DocxOutlineBlock } from '../../../../../src/main/services/ai/tools/docx/types'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createDocxToolHarness, writeWorkbenchSampleDocx } from '../../../../harness/backend/aiToolHarness'

type DocxOpenResult = {
  ok: boolean
  code: string
  summary: string
  docId: string
  stats: {
    blockCount: number
    tableCount: number
  }
}

type DocxOutlineResult = {
  ok: boolean
  code: string
  summary: string
  blocks: DocxOutlineBlock[]
  truncated: boolean
}

type DocxSearchResult = {
  ok: boolean
  code: string
  summary: string
  matches: Array<{
    blockId: string
    text: string
    offsets: Array<{ start: number; end: number }>
  }>
}

type DocxGetBlockResult = {
  ok: boolean
  code: string
  summary: string
  block: DocxDetailedBlock
}

describe('docx open outline search', () => {
  it('opens a generated docx and exposes deterministic outline/search primitives', async () => {
    await runBackendCase({
      caseId: 'docx-open-outline-search',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'tools',
      groups: ['docx'],
      description: '验证 docx capability 能完成打开、结构读取、文本搜索与 block 明细读取',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = await writeWorkbenchSampleDocx(runtime.workspaceRoot, 'docx-open-search.docx')
        const harness = createDocxToolHarness(runtime)

        try {
          const openResult = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: path.relative(runtime.workspaceRoot, sourcePath)
          })
          if (!openResult.ok) {
            throw new Error(openResult.summary)
          }

          const outlineResult = await harness.invoke<DocxOutlineResult>('docx_outline', {
            docId: openResult.docId,
            includeTables: true,
            includeCells: true
          })
          if (!outlineResult.ok) {
            throw new Error(outlineResult.summary)
          }

          const helloBlock = outlineResult.blocks.find(
            (block) => block.type === 'paragraph' && block.text.includes('Hello team')
          )
          if (!helloBlock) {
            throw new Error('failed to locate paragraph block with Hello team')
          }

          const searchResult = await harness.invoke<DocxSearchResult>('docx_search', {
            docId: openResult.docId,
            query: 'Hello team',
            mode: 'literal'
          })
          if (!searchResult.ok) {
            throw new Error(searchResult.summary)
          }

          const blockResult = await harness.invoke<DocxGetBlockResult>('docx_get_block', {
            docId: openResult.docId,
            blockId: helloBlock.blockId
          })
          if (!blockResult.ok) {
            throw new Error(blockResult.summary)
          }

          runtime.recordEvent({
            type: 'step',
            name: 'docx-open-outline-search',
            status: 'ok',
            message: 'docx 文档已完成打开、outline、search 与 get_block 验证',
            data: {
              sourcePath,
              docId: openResult.docId,
              outlineBlockCount: outlineResult.blocks.length,
              matchCount: searchResult.matches.length,
              blockType: blockResult.block.type
            }
          })

          return {
            openResult,
            outlineResult,
            searchResult,
            blockResult,
            aiEvents: runtime.eventCollector.snapshot()
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.openResult.stats.tableCount === 1, {
          name: 'docx-open-table-count',
          message: 'docx_open 返回了正确的 tableCount',
          data: {
            tableCount: result.openResult.stats.tableCount
          }
        })
        runtime.assertThat(result.outlineResult.blocks.some((block) => block.type === 'table_cell'), {
          name: 'docx-outline-includes-table-cell',
          message: 'docx_outline 已包含 table_cell block'
        })
        runtime.assertThat(result.searchResult.matches.length === 1, {
          name: 'docx-search-literal-match',
          message: 'docx_search literal 模式命中了目标段落',
          data: {
            matchCount: result.searchResult.matches.length
          }
        })
        runtime.assertThat(result.searchResult.matches[0]?.offsets.length === 1, {
          name: 'docx-search-offsets-recorded',
          message: 'docx_search 返回了命中 offset',
          data: {
            offsets: result.searchResult.matches[0]?.offsets
          }
        })
        runtime.assertThat(
          result.blockResult.block.type === 'paragraph' &&
            result.blockResult.block.text.includes('Hello team'),
          {
            name: 'docx-get-block-paragraph-detail',
            message: 'docx_get_block 返回了段落细节',
            data: {
              blockType: result.blockResult.block.type
            }
          }
        )

        const toolStartedEvents = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'tool_call_started'
        )
        const toolResultEvents = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'tool_call_result'
        )

        runtime.assertThat(toolStartedEvents.length === 4 && toolResultEvents.length === 4, {
          name: 'docx-tool-events-complete',
          message: 'docx open/outline/search/get_block 均记录了 started/result 事件',
          data: {
            started: toolStartedEvents.length,
            completed: toolResultEvents.length
          }
        })
      }
    })
  })
})
