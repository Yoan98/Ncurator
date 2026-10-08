import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import type { AiRunState } from '../../../src/main/services/ai/types'
import type { PptDiffManifest } from '../../../src/main/services/ai/human/tools/ppt/types'
import type { TextFileDiffArtifact } from '../../../src/shared/types'
import type { BackendTestRuntime } from './test-types'

const checksum = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

/** Verifies production finalization and parses the retained review after working B was removed. */
export const assertRunFileReviews = async (runtime: BackendTestRuntime, output: AiRunState) => {
  for (const artifact of output.finalArtifacts.filter((item) => item.applyId)) {
    const record = (
      await runtime.storageService.aiFileChange.getRecord({ changeId: artifact.applyId! })
    ).record
    if (!record || !['docx', 'ppt', 'excel', 'text_file'].includes(record.capability)) continue
    // The oracle concerns user workspace deliverables, rather than disposable scratch probes.
    const relative = path.relative(runtime.workspaceRoot, record.path)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      continue
    runtime.assertThat(Boolean(record.previewPath) && !record.error, {
      name: 'live-file-review-finalized',
      message: '已保存文件必须经过生产收尾并生成审核。',
      data: { changeId: record.id, capability: record.capability, error: record.error || null }
    })
    const formal = await fs.readFile(record.path)
    const review = await fs.readFile(record.previewPath!)
    if (record.capability === 'docx') {
      const zip = await JSZip.loadAsync(review)
      const xml = await zip.file('word/document.xml')?.async('text')
      runtime.assertThat(Boolean(xml?.includes('w:document')), {
        name: 'live-word-review-parses',
        message: 'Word 审核应为包含正文及资源的可解析 DOCX。'
      })
    } else if (record.capability === 'excel') {
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(review as never)
      runtime.assertThat(book.worksheets.length > 0, {
        name: 'live-excel-review-parses',
        message: 'Excel 审核应为可解析工作簿。',
        data: { sheets: book.worksheets.map((sheet) => sheet.name) }
      })
    } else if (record.capability === 'ppt') {
      const manifest = JSON.parse(review.toString('utf8')) as PptDiffManifest
      runtime.assertThat(manifest.version === 4 && manifest.slides.length > 0, {
        name: 'live-ppt-review-parses',
        message: 'PPT 审核应有完整前后页面。'
      })
      for (const slide of manifest.slides) {
        for (const side of [slide.before, slide.after]) {
          if (!side) continue
          runtime.assertThat((await fs.readFile(side.svg, 'utf8')).includes('<svg'), {
            name: 'live-ppt-review-svg',
            message: 'PPT 审核页面 SVG 应独立可读。'
          })
        }
      }
    } else {
      const diff = JSON.parse(review.toString('utf8')) as TextFileDiffArtifact
      runtime.assertThat(diff.version === 3 && Array.isArray(diff.lines), {
        name: 'live-text-review-parses',
        message: '文本审核应包含完整有序行数据。',
        data: { oldLineCount: diff.oldLineCount, newLineCount: diff.newLineCount }
      })
    }
    const pending = await runtime.docxApplyService.fileChanges.sessions.read(
      record.partnerId,
      record.runId,
      record.path
    )
    const currentChecksum = checksum(formal)
    if (currentChecksum !== record.afterChecksum) {
      runtime.recordEvent({
        type: 'step',
        name: 'live-file-current-version-differs-from-confirmed-b',
        status: 'info',
        message: '当前正式文件与最后受控写入 B 不同，需复核后续终端写入；审核仍固定 B。',
        data: {
          path: record.path,
          currentChecksum,
          confirmedChecksum: record.afterChecksum || null
        }
      })
    }
    runtime.assertThat(
      /^[a-f0-9]{64}$/.test(record.afterChecksum || '') &&
        !record.afterSnapshotPath &&
        !record.afterObjectHash &&
        !pending,
      {
        name: 'live-file-review-matches-confirmed-b',
        message: '审核保留确认 B 校验，清理工作快照后审核仍可解析。',
        data: {
          changeId: record.id,
          capability: record.capability,
          afterChecksum: record.afterChecksum || null,
          pending: Boolean(pending)
        }
      }
    )
  }
}
