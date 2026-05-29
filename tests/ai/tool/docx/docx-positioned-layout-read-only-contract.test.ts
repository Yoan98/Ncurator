import { describe, it } from 'vitest'
import { createDocxToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type {
  DocxFailureResult,
  DocxHistoryResult,
  DocxReadResult
} from './testUtils'

type PositionedOutlineResult = {
  sourcePath: string
  currentRevisionRef: string
  blocks: Array<{
    blockId: string
    type: 'paragraph' | 'table' | 'table_cell'
    layoutMode?: 'normal' | 'positioned'
    text: string
  }>
}

const POSITIONED_FIXTURE_PATH = 'tests/fixtures/workspace/学习笔记/图形学.docx'
const POSITIONED_READ_ONLY_MESSAGE = '当前命中复杂定位排版区域，暂不支持自动编辑'

describe('ai tool docx backend', () => {
  it('docx-positioned-layout-read-only-contract', async () => {
    await runBackendCase({
      caseId: 'docx-positioned-layout-read-only-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证命中 positioned block 时，所有 docx 写工具都会被拒绝。',
      fixtures: [POSITIONED_FIXTURE_PATH],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createDocxToolHarness(runtime)
        try {
          const sourcePath = runtime.getFixtureWorkspacePath(POSITIONED_FIXTURE_PATH)
          const outline = await harness.invoke<PositionedOutlineResult>('docx_outline', {
            sourcePath,
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 80 }]
          })
          const positionedParagraph = outline.blocks.find(
            (block) => block.type === 'paragraph' && block.layoutMode === 'positioned'
          )
          if (!positionedParagraph) {
            throw new Error('expected positioned paragraph block was not found')
          }

          const readPositionedParagraph = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: outline.sourcePath,
            range: { type: 'block_ids', blockIds: [positionedParagraph.blockId] }
          })
          const paragraphText =
            readPositionedParagraph.blocks[0]?.type === 'paragraph'
              ? readPositionedParagraph.blocks[0].text
              : ''
          const query = paragraphText.trim().slice(0, 6)
          if (query.length === 0) {
            throw new Error('expected non-empty text from positioned paragraph block')
          }

          const historyBefore = await harness.invoke<DocxHistoryResult>('docx_history', {
            sourcePath: outline.sourcePath,
            limit: 10
          })
          const paragraphInsertFailure = await harness.invoke<DocxFailureResult>(
            'docx_edit',
            {
              sourcePath: outline.sourcePath,
              actions: [{
                type: 'insert_blocks',
                position: 'after',
                anchorBlockId: positionedParagraph.blockId,
                blocks: [{ type: 'paragraph', text: '补充说明：这里不应自动插入。' }]
              }]
            }
          )
          const textEditFailure = await harness.invoke<DocxFailureResult>('docx_edit', {
            sourcePath: outline.sourcePath,
            actions: [{
              type: 'replace_text',
              query,
              replace: `${query}（修改）`,
              blockIds: [positionedParagraph.blockId]
            }]
          })
          const textStyleFailure = await harness.invoke<DocxFailureResult>('docx_edit', {
            sourcePath: outline.sourcePath,
            actions: [{
              type: 'style_text',
              blockId: positionedParagraph.blockId,
              query,
              style: {
              bold: true
            }
            }]
          })
          const tableInsertFailure = await harness.invoke<DocxFailureResult>('docx_edit', {
            sourcePath: outline.sourcePath,
            actions: [{
              type: 'insert_blocks',
              position: 'after',
              anchorBlockId: positionedParagraph.blockId,
              blocks: [{ type: 'table', rows: [['问题类型', '核心原因']] }]
            }]
          })
          const historyAfter = await harness.invoke<DocxHistoryResult>('docx_history', {
            sourcePath: outline.sourcePath,
            limit: 10
          })

          return {
            outline,
            positionedParagraph,
            readPositionedParagraph,
            historyBefore,
            paragraphInsertFailure,
            textEditFailure,
            textStyleFailure,
            tableInsertFailure,
            historyAfter
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const failures = [
          result.paragraphInsertFailure,
          result.textEditFailure,
          result.textStyleFailure,
          result.tableInsertFailure
        ]

        runtime.assertThat(
          failures.every(
            (failure) =>
              failure.error.length > 0 &&
              failure.error.includes(POSITIONED_READ_ONLY_MESSAGE)
          ),
          {
            name: 'positioned-layout-rejects-all-write-tools',
            message: '命中 positioned block 时，段落、文本、样式和表格写工具都应统一拒绝自动编辑。',
            data: {
              positionedParagraph: result.positionedParagraph,
              paragraphInsertFailure: result.paragraphInsertFailure,
              textEditFailure: result.textEditFailure,
              textStyleFailure: result.textStyleFailure,
              tableInsertFailure: result.tableInsertFailure
            }
          }
        )

        runtime.assertThat(
          result.historyBefore.currentRevisionRef === result.historyAfter.currentRevisionRef &&
            result.historyBefore.revisions.length === result.historyAfter.revisions.length,
          {
            name: 'positioned-layout-failures-do-not-create-new-revisions',
            message: 'positioned 写入失败后不应产生新的修订。',
            data: {
              historyBefore: result.historyBefore,
              historyAfter: result.historyAfter
            }
          }
        )
      }
    })
  })
})
