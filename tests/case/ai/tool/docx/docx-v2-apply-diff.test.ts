import fs from 'node:fs/promises'
import JSZip from 'jszip'
import { describe, it } from 'vitest'
import type { DocxApplyRecord } from '../../../../../src/shared/types'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type OutlineNode = { nodeId: string; type: string; text: string }
type OutlineResult = { nodes: OutlineNode[] }

const documentXml = async (filePath: string): Promise<string> => {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath))
  const document = zip.file('word/document.xml')
  if (!document) throw new Error('word/document.xml is missing')
  return await document.async('text')
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
        const restoredPath = await writeTestDocxFile(runtime.workspaceRoot, 'v2-restored.docx', [
          { type: 'paragraph', text: 'Restore A' }
        ])
        const before = await fs.readFile(sourcePath)
        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxApplyRun()
          const outline = await harness.invoke<OutlineResult>('docx_read_outline', {
            sourcePath,
            ranges: [{ type: 'node_index', fromNodeIndex: 0, toNodeIndex: 20 }]
          })
          const paragraph = outline.nodes.find((node) => node.text === 'Version A')!
          const table = outline.nodes.find((node) => node.type === 'table')!
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

          const restoredOutline = await harness.invoke<OutlineResult>('docx_read_outline', {
            sourcePath: restoredPath,
            ranges: [{ type: 'node_index', fromNodeIndex: 0, toNodeIndex: 10 }]
          })
          const restoredNode = restoredOutline.nodes.find((node) => node.text === 'Restore A')!
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
          const finalXml = await documentXml(sourcePath)
          const revert = await runtime.docxApplyService.revertRecord({ applyId: record.id })
          return {
            records,
            record,
            diffXml,
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
          result.records.map((item) => item.source_name).join(',') === 'v2-apply.docx' &&
            record.status === 'applied' &&
            count(result.diffXml, 'Version A') === 1 &&
            count(result.diffXml, 'Version B') === 0 &&
            count(result.diffXml, 'Version C') === 1 &&
            result.diffXml.includes('w:fill="FDECEC"') &&
            result.diffXml.includes('w:fill="E9F7EF"') &&
            result.diffXml.includes('Single operation') &&
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
