import fs from 'node:fs/promises'
import JSZip from 'jszip'
import { describe, it } from 'vitest'
import type { DocxApplyRecord } from '../../../../../src/shared/types'
import {
  createDocxToolHarness,
  writeRichTestDocxFile,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxPublicReadRootNode } from '../../../../../src/main/services/ai/human/tools/docx/nodeTypes'

type SearchResult = { matches: Array<{ nodeId: string; tableNodeId?: string }> }

const documentXml = async (filePath: string): Promise<string> => {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath))
  const document = zip.file('word/document.xml')
  if (!document) throw new Error('word/document.xml is missing')
  return await document.async('text')
}

const packageXml = async (filePath: string, partName: string): Promise<string> => {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath))
  const part = zip.file(partName)
  if (!part) throw new Error(`${partName} is missing`)
  return await part.async('text')
}

const count = (value: string, needle: string): number => value.split(needle).length - 1

describe('ai tool docx v2 apply and diff backend', () => {
  it('docx-v2-apply-diff', async () => {
    await runBackendCase({
      caseId: 'docx-v2-apply-diff',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 DOCX v2 Source 到 Working 净 Diff、apply 预览和 checkpoint 回退。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = await writeTestDocxFile(runtime.workspaceRoot, 'v2-apply.docx', [
          { type: 'paragraph', text: 'Version A' },
          { type: 'paragraph', text: 'Keep this paragraph' },
          {
            type: 'table',
            rows: [
              ['Capability', 'State'],
              ['Stable nodeId', 'Ready']
            ]
          }
        ])
        const sourceZip = await JSZip.loadAsync(await fs.readFile(sourcePath))
        const relationshipsPath = 'word/_rels/document.xml.rels'
        const relationships = await sourceZip.file(relationshipsPath)!.async('text')
        sourceZip.file(
          relationshipsPath,
          relationships.replace(
            '</Relationships>',
            '<Relationship Id="rIdDiffHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>'
          )
        )
        sourceZip.file(
          'word/header1.xml',
          '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header A</w:t></w:r></w:p></w:hdr>'
        )
        await fs.writeFile(sourcePath, await sourceZip.generateAsync({ type: 'nodebuffer' }))
        const stylePath = await writeTestDocxFile(runtime.workspaceRoot, 'v2-style.docx', [
          { type: 'paragraph', text: 'Style package' }
        ])
        const restoredStylePath = await writeTestDocxFile(
          runtime.workspaceRoot,
          'v2-style-restored.docx',
          [{ type: 'paragraph', text: 'Style restored' }]
        )
        const restoredCommentPath = await writeTestDocxFile(
          runtime.workspaceRoot,
          'v2-comment-restored.docx',
          [{ type: 'paragraph', text: 'Comment restored' }]
        )
        const restoredPath = await writeTestDocxFile(runtime.workspaceRoot, 'v2-restored.docx', [
          { type: 'paragraph', text: 'Restore A' }
        ])
        const batchFormatPath = await writeRichTestDocxFile(
          runtime.workspaceRoot,
          'v2-batch-format.docx',
          [
            {
              type: 'paragraph',
              paragraph: {
                runs: [{ text: 'First' }, { text: ' gap ' }, { text: 'Second' }]
              }
            }
          ]
        )
        const before = await fs.readFile(sourcePath)
        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxApplyRun()
          const paragraph = (
            await harness.invoke<SearchResult>('docx_search', { sourcePath, query: 'Version A' })
          ).matches[0]!
          const header = (
            await harness.invoke<SearchResult>('docx_search', { sourcePath, query: 'Header A' })
          ).matches[0]!
          const table = {
            nodeId: (
              await harness.invoke<SearchResult>('docx_search', { sourcePath, query: 'Capability' })
            ).matches[0]!.tableNodeId!
          }
          await harness.invoke('docx_content_edit', {
            sourcePath,
            type: 'replace_text',
            nodeId: paragraph.nodeId,
            oldText: 'Version A',
            newText: 'Version B'
          })
          await harness.invoke('docx_content_edit', {
            sourcePath,
            type: 'replace_text',
            nodeId: paragraph.nodeId,
            oldText: 'Version B',
            newText: 'Version C'
          })
          await harness.invoke('docx_table_edit', {
            sourcePath,
            type: 'insert_row',
            tableNodeId: table.nodeId,
            cells: ['Single operation', 'Passed']
          })
          await harness.invoke('docx_content_edit', {
            sourcePath,
            type: 'replace_text',
            nodeId: header.nodeId,
            oldText: 'Header A',
            newText: 'Header B'
          })
          await harness.invoke('docx_format', {
            sourcePath: stylePath,
            type: 'create_named_style',
            styleId: 'NCuratorAuditStyle',
            name: 'NCurator Audit Style',
            run: { bold: true }
          })
          await harness.invoke('docx_format', {
            sourcePath: restoredStylePath,
            type: 'create_named_style',
            styleId: 'TemporaryAuditStyle',
            name: 'Temporary Audit Style'
          })
          await harness.invoke('docx_format', {
            sourcePath: restoredStylePath,
            type: 'delete_named_style',
            styleId: 'TemporaryAuditStyle'
          })
          const batchNode = (
            await harness.invoke<SearchResult>('docx_search', {
              sourcePath: batchFormatPath,
              query: 'First'
            })
          ).matches[0]!
          const batchRead = await harness.invoke<{ nodes: DocxPublicReadRootNode[] }>(
            'docx_read_nodes',
            {
              sourcePath: batchFormatPath,
              range: { type: 'node_ids', nodeIds: [batchNode.nodeId] }
            }
          )
          const batchParagraph = batchRead.nodes[0]
          if (!batchParagraph || batchParagraph.type !== 'paragraph') {
            throw new Error('batch format paragraph missing')
          }
          const batchRunIds = batchParagraph.children
            .filter((node) => node.type === 'run')
            .map((node) => node.nodeId)
          await harness.invoke('docx_format', {
            sourcePath: batchFormatPath,
            type: 'format_text',
            targets: [
              { nodeId: batchRunIds[0]!, text: 'First' },
              { nodeId: batchRunIds[2]!, text: 'Second' }
            ],
            format: { bold: true }
          })
          const restoredCommentNode = (
            await harness.invoke<SearchResult>('docx_search', {
              sourcePath: restoredCommentPath,
              query: 'Comment restored'
            })
          ).matches[0]!
          await harness.invoke('docx_comments_revisions', {
            sourcePath: restoredCommentPath,
            type: 'add_comment',
            nodeId: restoredCommentNode.nodeId,
            text: 'Comment',
            comment: 'Temporary comment'
          })
          await harness.invoke('docx_comments_revisions', {
            sourcePath: restoredCommentPath,
            type: 'delete_comment',
            commentId: '0'
          })

          const restoredNode = (
            await harness.invoke<SearchResult>('docx_search', {
              sourcePath: restoredPath,
              query: 'Restore A'
            })
          ).matches[0]!
          await harness.invoke('docx_content_edit', {
            sourcePath: restoredPath,
            type: 'replace_text',
            nodeId: restoredNode.nodeId,
            oldText: 'Restore A',
            newText: 'Restore B'
          })
          await harness.invoke('docx_content_edit', {
            sourcePath: restoredPath,
            type: 'replace_text',
            nodeId: restoredNode.nodeId,
            oldText: 'Restore B',
            newText: 'Restore A'
          })

          const records = await harness.ctx.applyDocxRunEdits()
          const record = records.find((candidate) => candidate.source_name === 'v2-apply.docx')
          if (!record) throw new Error('expected v2-apply.docx apply record')
          const diffXml = await documentXml(record.preview_diff_artifact_path)
          const diffHeaderXml = await packageXml(
            record.preview_diff_artifact_path,
            'word/header1.xml'
          )
          const styleRecord = records.find((candidate) => candidate.source_name === 'v2-style.docx')
          if (!styleRecord) throw new Error('expected package-only style apply record')
          const styleDiffXml = await documentXml(styleRecord.preview_diff_artifact_path)
          const batchFormatRecord = records.find(
            (candidate) => candidate.source_name === 'v2-batch-format.docx'
          )
          if (!batchFormatRecord) throw new Error('expected batch format apply record')
          const batchFormatDiffXml = await documentXml(batchFormatRecord.preview_diff_artifact_path)
          const finalXml = await documentXml(sourcePath)
          const revert = await runtime.docxApplyService.revertRecord({ applyId: record.id })
          return {
            records,
            record,
            diffXml,
            diffHeaderXml,
            styleDiffXml,
            batchFormatDiffXml,
            finalXml,
            revert,
            revertedMatchesSource: Buffer.compare(before, await fs.readFile(sourcePath)) === 0
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const record = result.record as DocxApplyRecord
        runtime.assertThat(
          result.records
            .map((item) => item.source_name)
            .sort()
            .join(',') === 'v2-apply.docx,v2-batch-format.docx,v2-style.docx' &&
            record.status === 'applied' &&
            count(result.diffXml, 'Version A') === 1 &&
            count(result.diffXml, 'Version B') === 0 &&
            count(result.diffXml, 'Version C') === 1 &&
            result.diffXml.includes('w:fill="FDECEC"') &&
            result.diffXml.includes('w:fill="E9F7EF"') &&
            result.diffXml.includes('Single operation') &&
            result.diffHeaderXml.includes('Header A') &&
            result.diffHeaderXml.includes('Header B') &&
            result.diffHeaderXml.includes('w:fill="FDECEC"') &&
            result.diffHeaderXml.includes('w:fill="E9F7EF"') &&
            result.styleDiffXml.includes('文档级变更') &&
            result.batchFormatDiffXml.includes('First') &&
            result.batchFormatDiffXml.includes('Second') &&
            count(result.batchFormatDiffXml, 'w:fill="E9F7EF"') >= 2 &&
            !result.finalXml.includes('w:fill="FDECEC"') &&
            !result.finalXml.includes('w:fill="E9F7EF"') &&
            result.revert.success === true &&
            result.revertedMatchesSource,
          {
            name: 'docx-v2-apply-diff-keeps-only-source-and-final-state',
            message: 'DOCX v2 应生成净 Diff、跳过恢复原值文档，并可从 checkpoint 回退。',
            data: {
              record,
              recordNames: result.records.map((item) => item.source_name),
              revert: result.revert
            }
          }
        )
      }
    })
  })
})
