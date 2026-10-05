import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxPublicReadRootNode } from '../../../../../src/main/services/ai/human/tools/docx/nodeTypes'

type OutlineResult = {
  fromPercent: number
  toPercent: number
  fromNodeIndex: number
  toNodeIndex: number
  totalRootCount: number
  segments: Array<{ story: string; fromNodeIndex: number; toNodeIndex: number; textMap: string }>
}
type SearchResult = {
  matches: Array<{
    nodeId: string
    nodeIndex: number
    tableNodeId?: string
    textContext: string
    node?: DocxPublicReadRootNode
    beforeNodes?: DocxPublicReadRootNode[]
    afterNodes?: DocxPublicReadRootNode[]
  }>
}
type ReadResult = { sourcePath: string; nodes: DocxPublicReadRootNode[] }
type MutationResult = {
  createdIds?: string[]
}

const nodeText = (node: DocxPublicReadRootNode): string => JSON.stringify(node)
const isEmptyResult = (result: MutationResult): boolean => Object.keys(result).length === 0

describe('ai tool docx backend', () => {
  it('docx-public-tools', async () => {
    await runBackendCase({
      caseId: 'docx-public-tools',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 9 工具中的读取、内容、格式、表格和批注工具按单 operation 协议协作。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = await writeTestDocxFile(runtime.workspaceRoot, 'docx.docx', [
          { type: 'paragraph', text: 'Alpha paragraph' },
          { type: 'paragraph', text: 'Second paragraph' },
          {
            type: 'table',
            rows: [
              ['Name', 'Owner'],
              ['Risk', 'Alice']
            ]
          },
          {
            type: 'table',
            rows: [
              ['Metric', 'Value'],
              ['Score', '90']
            ]
          }
        ])
        const imagePath = path.join(runtime.workspaceRoot, 'docx-image.png')
        const createdPath = path.join(runtime.workspaceRoot, 'docx-created.docx')
        const createdTablePath = path.join(runtime.workspaceRoot, 'docx-created-table.docx')
        const pureImageDocxPath = await writeTestDocxFile(
          runtime.workspaceRoot,
          'docx-pure-image.docx',
          [{ type: 'paragraph', text: '' }]
        )
        await fs.writeFile(
          imagePath,
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=',
            'base64'
          )
        )
        const harness = createDocxToolHarness(runtime)
        try {
          const created = await harness.invoke<MutationResult>('docx_content_edit', {
            sourcePath: createdPath,
            type: 'insert_nodes',
            position: 'document_end',
            nodes: [
              { type: 'paragraph', text: 'Created one' },
              { type: 'paragraph', text: 'Created two' }
            ]
          })
          const createdReadback = await harness.invoke<ReadResult>('docx_read_nodes', {
            sourcePath: createdPath,
            range: { type: 'node_ids', nodeIds: created.createdIds || [] }
          })
          const createdTable = await harness.invoke<MutationResult>('docx_table_edit', {
            sourcePath: createdTablePath,
            type: 'create_table',
            position: 'document_end',
            rows: [
              ['Header', 'Value'],
              ['Created', 'Table']
            ]
          })
          const createdTableReadback = await harness.invoke<ReadResult>('docx_read_nodes', {
            sourcePath: createdTablePath,
            range: { type: 'node_ids', nodeIds: createdTable.createdIds || [] }
          })
          const pureImageCreated = await harness.invoke<MutationResult>('docx_content_edit', {
            sourcePath: pureImageDocxPath,
            type: 'insert_nodes',
            position: 'document_end',
            nodes: [{ type: 'visual', imagePath, altText: 'Only image' }]
          })
          if (!pureImageCreated.createdIds?.length) {
            throw new Error(`pure image insertion failed: ${JSON.stringify(pureImageCreated)}`)
          }
          const pureImageReadback = await harness.invoke<ReadResult>('docx_read_nodes', {
            sourcePath: pureImageDocxPath,
            range: { type: 'node_index', fromNodeIndex: 0, toNodeIndex: 0 }
          })
          const outline = await harness.invoke<OutlineResult>('docx_read_outline', {
            sourcePath,
            fromPercent: 0,
            toPercent: 100
          })
          const alphaSearch = await harness.invoke<SearchResult>('docx_search', {
            sourcePath,
            query: 'Alpha paragraph'
          })
          const secondSearch = await harness.invoke<SearchResult>('docx_search', {
            sourcePath,
            query: 'Second paragraph'
          })
          const firstTableSearch = await harness.invoke<SearchResult>('docx_search', {
            sourcePath,
            query: 'Risk'
          })
          const secondTableSearch = await harness.invoke<SearchResult>('docx_search', {
            sourcePath,
            query: 'Score'
          })
          const paragraph = alphaSearch.matches[0]!
          const secondParagraph = secondSearch.matches[0]!
          const table = { nodeId: firstTableSearch.matches[0]!.tableNodeId! }
          const secondTable = { nodeId: secondTableSearch.matches[0]!.tableNodeId! }
          const readBefore = await harness.invoke<ReadResult>('docx_read_nodes', {
            sourcePath,
            range: { type: 'node_ids', nodeIds: [paragraph.nodeId, table.nodeId] }
          })
          const content = await harness.invoke<MutationResult>('docx_content_edit', {
            sourcePath,
            type: 'replace_text',
            nodeId: paragraph.nodeId,
            oldText: 'Alpha',
            newText: 'Beta'
          })
          const appended = await harness.invoke<MutationResult>('docx_content_edit', {
            sourcePath,
            type: 'insert_nodes',
            position: 'document_end',
            nodes: [{ type: 'paragraph', text: 'Appended once' }]
          })
          const appendedReadback = await harness.invoke<ReadResult>('docx_read_nodes', {
            sourcePath,
            range: { type: 'node_ids', nodeIds: appended.createdIds || [] }
          })
          const format = await harness.invoke<MutationResult>('docx_format', {
            sourcePath,
            type: 'format_paragraph',
            nodeIds: [paragraph.nodeId, secondParagraph.nodeId],
            format: { alignment: 'center', keepWithNext: true }
          })
          const rejectedFormat = await harness.invoke('docx_format', {
            sourcePath,
            type: 'format_paragraph',
            nodeIds: [paragraph.nodeId, table.nodeId],
            format: { alignment: 'right' }
          })
          const readAfterRejectedFormat = await harness.invoke<ReadResult>('docx_read_nodes', {
            sourcePath,
            range: { type: 'node_ids', nodeIds: [paragraph.nodeId, secondParagraph.nodeId] }
          })
          const missingTargetFormat = await harness.invoke('docx_format', {
            sourcePath,
            type: 'format_paragraph',
            nodeIds: [paragraph.nodeId, 'missing-node-id'],
            format: { alignment: 'left' }
          })
          const readAfterMissingTarget = await harness.invoke<ReadResult>('docx_read_nodes', {
            sourcePath,
            range: { type: 'node_ids', nodeIds: [paragraph.nodeId, secondParagraph.nodeId] }
          })
          const tableNodes = await harness.invoke<ReadResult>('docx_read_nodes', {
            sourcePath,
            range: { type: 'node_ids', nodeIds: [table.nodeId, secondTable.nodeId] }
          })
          const publicTables = tableNodes.nodes.filter((node) => node.type === 'table')
          const rowNodeIds = publicTables.map((node) => node.children[0]!.nodeId)
          const cellNodeIds = publicTables.map((node) => node.children[0]!.children[0]!.nodeId)
          const tableFormat = await harness.invoke<MutationResult>('docx_table_edit', {
            sourcePath,
            type: 'format_table',
            nodeIds: [table.nodeId, secondTable.nodeId],
            format: { alignment: 'center' }
          })
          const rowFormat = await harness.invoke<MutationResult>('docx_table_edit', {
            sourcePath,
            type: 'format_row',
            nodeIds: rowNodeIds,
            format: { repeatHeader: true }
          })
          const cellFormat = await harness.invoke<MutationResult>('docx_table_edit', {
            sourcePath,
            type: 'format_cell',
            nodeIds: cellNodeIds,
            format: { shading: 'FFFF00' }
          })
          const sectionFormat = await harness.invoke<MutationResult>('docx_format', {
            sourcePath,
            type: 'format_section',
            nodeIds: [paragraph.nodeId, secondParagraph.nodeId],
            orientation: 'landscape'
          })
          const resetFormat = await harness.invoke<MutationResult>('docx_format', {
            sourcePath,
            type: 'reset_format',
            nodeIds: [paragraph.nodeId, secondParagraph.nodeId]
          })
          const namedStyle = await harness.invoke<MutationResult>('docx_format', {
            sourcePath,
            type: 'apply_named_style',
            nodeIds: [paragraph.nodeId, secondParagraph.nodeId],
            styleId: 'Normal'
          })
          const numbering = await harness.invoke<MutationResult>('docx_format', {
            sourcePath,
            type: 'set_numbering',
            nodeIds: [paragraph.nodeId, secondParagraph.nodeId],
            kind: 'bullet',
            level: 0
          })
          const tableEdit = await harness.invoke<MutationResult>('docx_table_edit', {
            sourcePath,
            type: 'insert_row',
            tableNodeId: table.nodeId,
            cells: ['Status', 'Open']
          })
          const media = await harness.invoke<MutationResult>('docx_content_edit', {
            sourcePath,
            type: 'insert_nodes',
            nodeId: paragraph.nodeId,
            position: 'after',
            nodes: [
              {
                type: 'visual',
                imagePath,
                widthCm: 1,
                heightCm: 1,
                altText: 'DOCX test image'
              }
            ]
          })
          const visualNodeId = media.createdIds?.[0]
          if (!visualNodeId) throw new Error('inserted visual nodeId missing')
          const visualReplacement = await harness.invoke<MutationResult>('docx_content_edit', {
            sourcePath,
            type: 'replace_node',
            nodeId: visualNodeId,
            node: {
              type: 'visual',
              imagePath,
              widthCm: 1.5,
              heightCm: 1.5,
              altText: 'Replaced DOCX test image'
            }
          })
          const visualMove = await harness.invoke<MutationResult>('docx_content_edit', {
            sourcePath,
            type: 'move_node',
            nodeId: visualNodeId,
            anchorNodeId: secondParagraph.nodeId,
            position: 'inside_end'
          })
          const comment = await harness.invoke<MutationResult>('docx_comments_revisions', {
            sourcePath,
            type: 'add_comment',
            nodeId: paragraph.nodeId,
            text: 'Beta',
            comment: 'Check this paragraph',
            author: 'NCurator'
          })
          const revisions = await harness.invoke<MutationResult>('docx_comments_revisions', {
            sourcePath,
            type: 'enable_track_changes'
          })
          const searchAfter = await harness.invoke<SearchResult>('docx_search', {
            sourcePath,
            query: 'Beta'
          })
          const visualSearch = await harness.invoke<SearchResult>('docx_search', {
            sourcePath,
            query: 'Second paragraph',
            includeContext: true
          })
          const readAfter = await harness.invoke<ReadResult>('docx_read_nodes', {
            sourcePath,
            range: {
              type: 'node_ids',
              nodeIds: [paragraph.nodeId, secondParagraph.nodeId, table.nodeId]
            }
          })
          return {
            outline,
            created,
            createdReadback,
            createdTable,
            createdTableReadback,
            pureImageCreated,
            pureImageReadback,
            paragraph,
            readBefore,
            content,
            appended,
            appendedReadback,
            format,
            rejectedFormat,
            readAfterRejectedFormat,
            missingTargetFormat,
            readAfterMissingTarget,
            tableFormat,
            rowFormat,
            cellFormat,
            sectionFormat,
            resetFormat,
            namedStyle,
            numbering,
            tableEdit,
            media,
            visualNodeId,
            visualReplacement,
            visualMove,
            comment,
            revisions,
            searchAfter,
            visualSearch,
            readAfter
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.outline.totalRootCount > 0 &&
            result.outline.fromPercent === 0 &&
            result.outline.toPercent === 100 &&
            result.outline.segments.length === 3 &&
            result.outline.segments.filter((segment) => segment.textMap.includes('表格 2x2'))
              .length === 2 &&
            !JSON.stringify(result.outline).includes('nodeId') &&
            result.created.createdIds?.length === 2 &&
            result.createdReadback.nodes.length === 2 &&
            result.createdReadback.nodes.every((node) => nodeText(node).includes('Created')) &&
            result.createdTable.createdIds?.length === 1 &&
            result.createdTableReadback.nodes.some(
              (node) => node.type === 'table' && nodeText(node).includes('Created')
            ) &&
            result.pureImageCreated.createdIds?.length === 1 &&
            JSON.stringify(result.pureImageReadback.nodes).includes('"type":"visual"') &&
            JSON.stringify(result.pureImageReadback.nodes).includes('"imagePath"') &&
            result.readBefore.nodes.length === 2 &&
            isEmptyResult(result.content) &&
            result.appended.createdIds?.length === 1 &&
            result.appendedReadback.nodes.some((node) =>
              nodeText(node).includes('Appended once')
            ) &&
            isEmptyResult(result.format) &&
            JSON.stringify(result.rejectedFormat).includes('invalid_input') &&
            result.readAfterRejectedFormat.nodes.every(
              (node) => node.type !== 'paragraph' || node.style?.alignment === 'center'
            ) &&
            JSON.stringify(result.missingTargetFormat).includes('invalid_input') &&
            result.readAfterMissingTarget.nodes.every(
              (node) => node.type !== 'paragraph' || node.style?.alignment === 'center'
            ) &&
            isEmptyResult(result.tableFormat) &&
            isEmptyResult(result.rowFormat) &&
            isEmptyResult(result.cellFormat) &&
            isEmptyResult(result.sectionFormat) &&
            isEmptyResult(result.resetFormat) &&
            isEmptyResult(result.namedStyle) &&
            isEmptyResult(result.numbering) &&
            isEmptyResult(result.tableEdit) &&
            result.media.createdIds?.length === 1 &&
            isEmptyResult(result.visualReplacement) &&
            isEmptyResult(result.visualMove) &&
            result.comment.createdIds?.length === 1 &&
            isEmptyResult(result.revisions) &&
            !JSON.stringify(result).includes('"changes"') &&
            result.searchAfter.matches[0]?.nodeId === result.paragraph.nodeId &&
            result.readAfter.nodes.some(
              (node) => node.nodeId === result.paragraph.nodeId && nodeText(node).includes('Beta')
            ) &&
            result.readAfter.nodes.some(
              (node) => node.type === 'table' && nodeText(node).includes('Open')
            ) &&
            JSON.stringify(result.readAfter.nodes).includes('"type":"visual"') &&
            JSON.stringify(result.readAfter.nodes).includes('"imagePath"') &&
            JSON.stringify(result.readAfter.nodes).includes(result.visualNodeId) &&
            JSON.stringify(result.readAfter.nodes).includes('Replaced DOCX test image') &&
            JSON.stringify(result.visualSearch.matches[0]?.node).includes('"type":"visual"') &&
            JSON.stringify(result.visualSearch.matches[0]?.node).includes('"imagePath"'),
          {
            name: 'docx-tools-share-one-working-session',
            message: 'DOCX 工具应共享 Working 文档，连续调用后 nodeId 保持稳定且结果可回读。',
            data: result
          }
        )
      }
    })
  })
})
