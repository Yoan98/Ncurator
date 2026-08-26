import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxPublicReadRootNode } from '../../../../../src/main/services/ai/human/tools/docx/nodeTypes'

type OutlineNode = {
  nodeId: string
  nodeIndex: number
  type: 'paragraph' | 'table' | 'content_control' | 'revision'
  textPreview: string
}

type OutlineResult = {
  startPage: number
  endPage: number
  totalPages: number
  nodes: OutlineNode[]
}
type SearchResult = {
  matches: Array<{ nodeId: string; nodeIndex: number; text: string }>
}
type ReadResult = { sourcePath: string; nodes: DocxPublicReadRootNode[] }
type MutationResult = {
  changes: Array<{ kind: string; node?: DocxPublicReadRootNode; nodeId?: string }>
}

const nodeText = (node: DocxPublicReadRootNode): string => JSON.stringify(node)

describe('ai tool docx v2 backend', () => {
  it('docx-v2-public-tools', async () => {
    await runBackendCase({
      caseId: 'docx-v2-public-tools',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 9 工具中的读取、内容、格式、表格和批注工具按单 operation 协议协作。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = await writeTestDocxFile(runtime.workspaceRoot, 'docx-v2.docx', [
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
        const imagePath = path.join(runtime.workspaceRoot, 'docx-v2-image.png')
        const createdPath = path.join(runtime.workspaceRoot, 'docx-v2-created.docx')
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
          const outline = await harness.invoke<OutlineResult>('docx_read_outline', {
            sourcePath,
            startPage: 1,
            pageCount: 1
          })
          const paragraph = outline.nodes.find((node) => node.type === 'paragraph')!
          const secondParagraph = outline.nodes.find(
            (node) => node.type === 'paragraph' && node.nodeId !== paragraph.nodeId
          )!
          const table = outline.nodes.find((node) => node.type === 'table')!
          const secondTable = outline.nodes.find(
            (node) => node.type === 'table' && node.nodeId !== table.nodeId
          )!
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
          const tableFormat = await harness.invoke<MutationResult>('docx_format', {
            sourcePath,
            type: 'format_table',
            nodeIds: [table.nodeId, secondTable.nodeId],
            format: { alignment: 'center' }
          })
          const rowFormat = await harness.invoke<MutationResult>('docx_format', {
            sourcePath,
            type: 'format_row',
            nodeIds: rowNodeIds,
            format: { repeatHeader: true }
          })
          const cellFormat = await harness.invoke<MutationResult>('docx_format', {
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
          const media = await harness.invoke<MutationResult>('docx_media_edit', {
            sourcePath,
            type: 'insert_image',
            nodeId: paragraph.nodeId,
            position: 'after',
            imagePath,
            widthCm: 1,
            heightCm: 1,
            altText: 'DOCX v2 test image'
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
          const readAfter = await harness.invoke<ReadResult>('docx_read_nodes', {
            sourcePath,
            range: { type: 'node_ids', nodeIds: [paragraph.nodeId, table.nodeId] }
          })
          return {
            outline,
            created,
            paragraph,
            readBefore,
            content,
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
            comment,
            revisions,
            searchAfter,
            readAfter
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.outline.totalPages === 1 &&
            result.outline.nodes.filter((node) => node.type === 'paragraph' && node.nodeIndex < 3)
              .length === 2 &&
            result.outline.nodes.filter((node) => node.type === 'table').length === 2 &&
            result.outline.nodes.every((node) => node.type !== 'table_cell') &&
            result.created.changes.length === 2 &&
            result.created.changes.every((change) => change.kind === 'created') &&
            result.readBefore.nodes.length === 2 &&
            result.content.changes.some((change) => change.kind === 'updated') &&
            result.format.changes.filter((change) => change.kind === 'updated').length === 2 &&
            JSON.stringify(result.rejectedFormat).includes('invalid_input') &&
            result.readAfterRejectedFormat.nodes.every(
              (node) => node.type !== 'paragraph' || node.style?.alignment === 'center'
            ) &&
            JSON.stringify(result.missingTargetFormat).includes('invalid_input') &&
            result.readAfterMissingTarget.nodes.every(
              (node) => node.type !== 'paragraph' || node.style?.alignment === 'center'
            ) &&
            result.tableFormat.changes.length === 2 &&
            result.rowFormat.changes.length === 2 &&
            result.cellFormat.changes.length === 2 &&
            result.sectionFormat.changes.length >= 1 &&
            result.resetFormat.changes.length === 2 &&
            result.namedStyle.changes.length === 2 &&
            result.numbering.changes.length === 2 &&
            result.tableEdit.changes.some((change) => change.kind === 'updated') &&
            result.media.changes.some((change) => change.kind === 'updated') &&
            result.comment.changes.some((change) => change.kind === 'comment_created') &&
            result.revisions.changes.some((change) => change.kind === 'track_changes_updated') &&
            result.searchAfter.matches[0]?.nodeId === result.paragraph.nodeId &&
            result.readAfter.nodes.some(
              (node) => node.nodeId === result.paragraph.nodeId && nodeText(node).includes('Beta')
            ) &&
            result.readAfter.nodes.some(
              (node) => node.type === 'table' && nodeText(node).includes('Open')
            ) &&
            result.readAfter.nodes.some((node) => nodeText(node).includes('visualId')),
          {
            name: 'docx-v2-tools-share-one-working-session',
            message: 'DOCX v2 工具应共享 Working 文档，连续调用后 nodeId 保持稳定且结果可回读。',
            data: result
          }
        )
      }
    })
  })
})
