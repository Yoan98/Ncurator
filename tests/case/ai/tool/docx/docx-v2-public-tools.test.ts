import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxPublicReadRootNode } from '../../../../../src/main/services/ai/human/tools/docx/nodeTypes'

type OutlineNode = {
  nodeId: string
  nodeIndex: number
  type: 'paragraph' | 'table' | 'table_cell' | 'content_control' | 'revision'
  text: string
}

type OutlineResult = { sourcePath: string; totalNodeCount: number; nodes: OutlineNode[] }
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
          {
            type: 'table',
            rows: [
              ['Name', 'Owner'],
              ['Risk', 'Alice']
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
            ranges: [{ type: 'node_index', fromNodeIndex: 0, toNodeIndex: 20 }]
          })
          const paragraph = outline.nodes.find((node) => node.type === 'paragraph')!
          const table = outline.nodes.find((node) => node.type === 'table')!
          const readBefore = await harness.invoke<ReadResult>('docx_read', {
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
            nodeId: paragraph.nodeId,
            format: { alignment: 'center', keepWithNext: true }
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
          const readAfter = await harness.invoke<ReadResult>('docx_read', {
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
          result.outline.totalNodeCount >= 4 &&
            result.created.changes.length === 2 &&
            result.created.changes.every((change) => change.kind === 'created') &&
            result.readBefore.nodes.length === 2 &&
            result.content.changes.some((change) => change.kind === 'updated') &&
            result.format.changes.some((change) => change.kind === 'updated') &&
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
