import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import JSZip from 'jszip'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult, DocxSearchResult } from './testUtils'
import { findParagraphBlockIdByText } from './testUtils'

const readDocumentXml = async (filePath: string): Promise<string> => {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath))
  return await zip.file('word/document.xml')!.async('string')
}

const firstTableXml = (xml: string): string => /<w:tbl[\s\S]*?<\/w:tbl>/.exec(xml)?.[0] || ''

const addDistinctTableBorders = async (filePath: string): Promise<void> => {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath))
  const documentFile = zip.file('word/document.xml')
  if (!documentFile) throw new Error('word/document.xml is missing')
  const xml = await documentFile.async('string')
  const borders =
    '<w:tblBorders><w:top w:val="double" w:sz="12" w:color="123456"/><w:left w:val="double" w:sz="12" w:color="123456"/><w:bottom w:val="double" w:sz="12" w:color="123456"/><w:right w:val="double" w:sz="12" w:color="123456"/><w:insideH w:val="single" w:sz="6" w:color="654321"/><w:insideV w:val="single" w:sz="6" w:color="654321"/></w:tblBorders>'
  zip.file('word/document.xml', xml.replace('<w:tblPr>', `<w:tblPr>${borders}`))
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}

describe('ai tool docx backend', () => {
  it('docx-direct-apply-checkpoint-revert', async () => {
    await runBackendCase({
      caseId: 'docx-direct-apply-checkpoint-revert',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 existing docx 编辑后立即写回，run 结束时保存 checkpoint，并支持干净回退。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const relativePath = 'direct-apply.docx'
        const sourcePath = await writeTestDocxFile(runtime.workspaceRoot, relativePath, [
          { type: 'heading', level: 2, text: 'Project status' },
          { type: 'paragraph', text: 'Status: draft.' },
          { type: 'paragraph', text: 'Owner: Alice.' },
          {
            type: 'table',
            rows: [
              ['Name', 'State'],
              ['Alpha', 'Open']
            ]
          }
        ])
        await addDistinctTableBorders(sourcePath)
        const beforeBytes = await fs.readFile(sourcePath)
        const beforeXml = await readDocumentXml(sourcePath)
        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxApplyRun()
          const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath,
            ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
          })
          const headingBlockId = findParagraphBlockIdByText(outline.blocks, 'Project status')
          const edited = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath,
            actions: [
              {
                type: 'style_text',
                query: 'Project status',
                blockIds: [headingBlockId],
                style: { color: 'FF0000' }
              },
              {
                type: 'replace_text',
                query: 'Status: draft.',
                replace: 'Status: approved.'
              }
            ]
          })
          const records = await harness.ctx.applyDocxRunEdits()
          const afterBytes = await fs.readFile(sourcePath)
          const searchAfterApply = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath,
            query: 'Status: approved.',
            mode: 'literal'
          })
          const record = records[0]
          const sourceXmlAfterApply = await readDocumentXml(sourcePath)
          const diffXml = record?.preview_diff_artifact_path
            ? await readDocumentXml(record.preview_diff_artifact_path)
            : ''
          const revert = record
            ? await runtime.docxApplyService.revertRecord({ applyId: record.id })
            : { success: false }
          const revertedBytes = await fs.readFile(sourcePath)

          return {
            edited,
            records,
            beforeXml,
            sourceChangedAfterApply: Buffer.compare(beforeBytes, afterBytes) !== 0,
            sourceXmlAfterApply,
            diffXml,
            tableXmlPreserved: firstTableXml(beforeXml) === firstTableXml(diffXml),
            revertedMatchesBefore: Buffer.compare(beforeBytes, revertedBytes) === 0,
            searchAfterApply,
            revert
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.edited.changedBlocks.length === 2 &&
            result.records.length === 1 &&
            result.records[0]?.status === 'applied' &&
            result.records[0]?.operation === 'updated' &&
            result.records[0]?.before_exists === true &&
            Boolean(result.records[0]?.before_snapshot_path) &&
            Boolean(result.records[0]?.preview_diff_artifact_path) &&
            Boolean(result.records[0]?.preview_diff_checksum) &&
            result.records[0]?.preview_diff_byte_size > 0 &&
            result.sourceChangedAfterApply === true &&
            result.searchAfterApply.matches.length === 1,
          {
            name: 'docx-update-directly-writes-source-and-records-checkpoint',
            message:
              '提交当前 run 的 Docx 草稿时应写回源文件，并生成包含 checkpoint 的 applied 记录。',
            data: {
              records: result.records,
              searchAfterApply: result.searchAfterApply.matches
            }
          }
        )

        runtime.assertThat(
          result.diffXml.includes('w:fill="FDECEC"') &&
            result.diffXml.includes('w:strike') &&
            result.diffXml.includes('w:fill="E9F7EF"') &&
            !result.diffXml.includes('CFFAFE') &&
            result.diffXml.includes('w:color="123456"') &&
            result.diffXml.includes('w:color="654321"') &&
            result.tableXmlPreserved &&
            result.sourceXmlAfterApply.includes('w:val="FF0000"') &&
            !result.sourceXmlAfterApply.includes('w:fill="FDECEC"') &&
            !result.sourceXmlAfterApply.includes('w:fill="E9F7EF"') &&
            result.beforeXml.includes('w:color="123456"'),
          {
            name: 'docx-apply-diff-preview-has-markers-but-source-is-clean',
            message: 'apply 应生成带红绿标注的系统内 diff 预览稿，但真实源文件保持净稿。',
            data: {
              record: result.records[0],
              diffHasDeletedMarker: result.diffXml.includes('w:fill="FDECEC"'),
              diffHasInsertedMarker: result.diffXml.includes('w:fill="E9F7EF"'),
              sourceHasMarkers:
                result.sourceXmlAfterApply.includes('w:fill="FDECEC"') ||
                result.sourceXmlAfterApply.includes('w:fill="E9F7EF"')
            }
          }
        )

        runtime.assertThat(
          result.revert.success === true &&
            result.revert.record?.status === 'reverted' &&
            result.revertedMatchesBefore === true,
          {
            name: 'docx-update-revert-restores-checkpoint',
            message: '未发生后续修改时，回退应恢复写回前 checkpoint。',
            data: result.revert
          }
        )
      }
    })
  })

  it('docx-direct-apply-force-revert-after-user-change', async () => {
    await runBackendCase({
      caseId: 'docx-direct-apply-force-revert-after-user-change',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description:
        '验证 AI 写回后用户又改文件时，首次回退提示风险，force=true 后仍允许恢复 checkpoint。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const relativePath = 'force-revert.docx'
        const sourcePath = await writeTestDocxFile(runtime.workspaceRoot, relativePath, [
          { type: 'paragraph', text: 'Risk: pending.' },
          { type: 'paragraph', text: 'Owner: Bob.' }
        ])
        const beforeBytes = await fs.readFile(sourcePath)
        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxApplyRun()
          await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath,
            actions: [
              {
                type: 'replace_text',
                query: 'Risk: pending.',
                replace: 'Risk: mitigated.'
              }
            ]
          })
          const records = await harness.ctx.applyDocxRunEdits()
          const record = records[0]
          if (!record) throw new Error('expected docx apply record')

          await writeTestDocxFile(runtime.workspaceRoot, relativePath, [
            { type: 'paragraph', text: 'User changed after AI apply.' }
          ])
          const guardedRevert = await runtime.docxApplyService.revertRecord({
            applyId: record.id,
            force: false
          })
          const forcedRevert = await runtime.docxApplyService.revertRecord({
            applyId: record.id,
            force: true
          })
          const revertedBytes = await fs.readFile(sourcePath)

          return {
            record,
            guardedRevert,
            forcedRevert,
            revertedMatchesBefore: Buffer.compare(beforeBytes, revertedBytes) === 0
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.guardedRevert.success === false &&
            result.guardedRevert.requiresForce === true &&
            Boolean(result.guardedRevert.warning?.includes('恢复到这次修改前')),
          {
            name: 'docx-revert-detects-post-apply-user-change',
            message: 'AI 写回后文件又变化时，force=false 回退应先返回 requiresForce 风险提示。',
            data: result.guardedRevert
          }
        )

        runtime.assertThat(
          result.forcedRevert.success === true &&
            result.forcedRevert.record?.status === 'reverted' &&
            result.revertedMatchesBefore === true,
          {
            name: 'docx-force-revert-overwrites-post-apply-user-change',
            message: '用户确认后 force=true 应允许覆盖后续修改并恢复 checkpoint。',
            data: result.forcedRevert
          }
        )
      }
    })
  })
})
