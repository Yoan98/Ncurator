import { officeReviewIndexSchema } from '../../../../../src/shared/fileReview'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { describe, it, expect } from 'vitest'
import {
  createDocxToolHarness,
  createPptToolHarness,
  createExcelToolHarness,
  createTextFileToolHarness,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { releaseRunFiles } from '../../../../../src/main/services/ai/run/fileLease'
import type { PptDiffManifest } from '../../../../../src/main/services/ai/human/tools/ppt/types'
import type { TextFileDiffArtifact } from '../../../../../src/shared/types'

const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
describe('owner file review', () => {
  it('file-change-immutable-review', async () => {
    await runBackendCase({
      caseId: 'file-change-immutable-review',
      domain: 'ai',
      suite: 'tool',
      groups: ['file-changes'],
      harnessMode: 'tool-real',
      fixtures: [],
      runMode: 'single',
      description: '四类真实工具确认落盘、运行中无审核、C 后固定 A→B、清理工作版本与回退。',
      execute: async (runtime) => {
        const word = createDocxToolHarness(runtime),
          excel = createExcelToolHarness(runtime),
          text = createTextFileToolHarness(runtime)
        const wordPath = await writeTestDocxFile(runtime.workspaceRoot, 'word.docx', [
          { type: 'paragraph', text: 'Word A' }
        ])
        const excelPath = path.join(runtime.workspaceRoot, 'book.xlsx'),
          textPath = path.join(runtime.workspaceRoot, 'text.md'),
          pptPath = path.join(runtime.workspaceRoot, 'slides.pptx')
        const book = new ExcelJS.Workbook()
        book.addWorksheet('Data').getCell('A1').value = 'Excel A'
        await fs.writeFile(excelPath, Buffer.from(await book.xlsx.writeBuffer()))
        await fs.writeFile(
          textPath,
          '\ufeffText A\r\n' + Array.from({ length: 20 }, (_, i) => `unchanged ${i}\r\n`).join('')
        )
        const seed = createPptToolHarness(runtime, { runId: `${runtime.runId}-seed` })
        const slide = await seed.invoke<{ slideId: string }>('ppt_edit', {
          sourcePath: pptPath,
          type: 'insert_slide',
          notes: 'A',
          elements: [
            { type: 'text', text: 'PPT A', bounds: { x: 50, y: 50, width: 500, height: 80 } }
          ]
        })
        await seed.ctx.finalizeRunFileChanges()
        releaseRunFiles(seed.ctx.runId)
        const originals = await Promise.all(
          [wordPath, pptPath, excelPath, textPath].map((file) => fs.readFile(file))
        )
        const node = (
          await word.invoke<{ matches: { nodeId: string }[] }>('docx_search', {
            sourcePath: wordPath,
            query: 'Word A'
          })
        ).matches[0].nodeId
        await word.invoke('docx_content_edit', {
          sourcePath: wordPath,
          type: 'replace_text',
          nodeId: node,
          oldText: 'Word A',
          newText: 'Word B'
        })
        await excel.invoke('excel_edit', {
          sourcePath: excelPath,
          type: 'set_range',
          sheetName: 'Data',
          range: 'A1',
          values: [['Excel B']]
        })
        await text.invoke('text_file_edit', {
          sourcePath: textPath,
          action: 'edit',
          edits: [{ oldText: 'Text A', newText: 'Text B' }]
        })
        const ppt = createPptToolHarness(runtime)
        await ppt.invoke('ppt_edit', {
          sourcePath: pptPath,
          type: 'replace_text',
          query: 'PPT A',
          replace: 'PPT B'
        })
        await ppt.invoke('ppt_edit', {
          sourcePath: pptPath,
          type: 'set_notes',
          slideId: slide.slideId,
          text: 'B'
        })
        const paths = [wordPath, pptPath, excelPath, textPath]
        const confirmed = await Promise.all(paths.map((file) => fs.readFile(file)))
        const pending = await Promise.all(paths.map((file) => word.ctx.getFileChangeSession(file)))
        expect(
          pending.every((session) => session?.workingPath && !session.record.previewPath)
        ).toBe(true)
        expect(
          (await JSZip.loadAsync(confirmed[0])).file('word/document.xml') && confirmed[0].length > 0
        ).toBeTruthy()
        const formalExcel = new ExcelJS.Workbook()
        await formalExcel.xlsx.load(confirmed[2] as never)
        expect(formalExcel.getWorksheet('Data')!.getCell('A1').value).toBe('Excel B')
        expect(confirmed[3].toString('utf8')).toContain('Text B\r\n')
        // External C remains the current source; no finalizer is allowed to use it as B.
        for (const file of paths) await fs.writeFile(file, 'external C')
        const records = await word.ctx.finalizeRunFileChanges()
        expect(records).toHaveLength(4)
        for (let index = 0; index < paths.length; index++) {
          const record = records.find((record) => record.path === paths[index])!
          expect(record.afterChecksum).toBe(hash(confirmed[index]))
          expect(await fs.readFile(record.beforeSnapshotPath!)).toEqual(originals[index])
          expect(record.afterSnapshotPath).toBeUndefined()
          expect(record.afterObjectHash).toBeUndefined()
          await expect(fs.access(pending[index]!.workingPath!)).rejects.toThrow()
          expect(await word.ctx.getFileChangeSession(paths[index])).toBeUndefined()
          expect(await fs.readFile(paths[index], 'utf8')).toBe('external C')
        }
        const wordRecord = records.find((record) => record.path === wordPath)!
        const wordXml = await (await JSZip.loadAsync(await fs.readFile(wordRecord.previewPath!)))
          .file('word/document.xml')!
          .async('text')
        expect(wordXml).toContain('Word ')
        expect(wordXml).toContain('B')
        expect(wordXml).not.toContain('external C')
        const excelRecord = records.find((record) => record.path === excelPath)!
        const reviewBook = new ExcelJS.Workbook()
        await reviewBook.xlsx.load((await fs.readFile(excelRecord.previewPath!)) as never)
        expect(reviewBook.getWorksheet('Data')!.getCell('A1').value).toBe('Excel B')
        expect(reviewBook.getWorksheet('Data')!.getCell('A1').border.left?.color?.argb).toBe(
          'FF22A06B'
        )
        const pptRecord = records.find((record) => record.path === pptPath)!
        const manifest = JSON.parse(
          await fs.readFile(pptRecord.previewPath!, 'utf8')
        ) as PptDiffManifest
        expect(manifest.slides[0].changed).toBe(true)
        expect(await fs.readFile(manifest.slides[0].after!.svg, 'utf8')).toContain('PPT B')
        expect(JSON.stringify(manifest)).not.toContain('notes')
        const textRecord = records.find((record) => record.path === textPath)!
        const textReview = JSON.parse(
          await fs.readFile(textRecord.previewPath!, 'utf8')
        ) as TextFileDiffArtifact
        expect(textReview.version).toBe(4)
        expect(textReview.before).toContain('Text A')
        expect(textReview.after).toContain('Text B')
        expect(textReview.before.split('\n').length).toBeGreaterThan(20)
        expect(textReview.after).not.toContain('external C')
        for (const record of records.filter((r) => r.capability !== 'text_file')) {
          const index = officeReviewIndexSchema.parse(
            JSON.parse(
              await fs.readFile(
                path.join(path.dirname(record.previewPath!), 'navigation.json'),
                'utf8'
              )
            )
          )
          expect(index.afterChecksum).toBe(record.afterChecksum)
          expect(index.regions.length).toBeGreaterThan(0)
          expect(
            index.regions.some(
              (r) =>
                r.target?.kind ===
                (record.capability === 'ppt'
                  ? 'ppt'
                  : record.capability === 'excel'
                    ? 'excel'
                    : 'docx')
            )
          ).toBe(true)
          if (record.capability === 'docx') {
            expect(wordXml).toContain('ncr:region=')
            expect(
              index.regions.some((r) => r.target?.kind === 'docx' && r.target.text === 'Word B')
            ).toBe(true)
          }
          if (record.capability === 'excel')
            expect(index.regions[0].target).toMatchObject({
              sheet: 'Data',
              address: 'A1',
              value: 'Excel B'
            })
          if (record.capability === 'ppt') {
            const svg = await fs.readFile(manifest.slides[0].after!.svg, 'utf8')
            const shapeRegions = index.regions.filter(
              (region) =>
                region.target?.kind === 'ppt' &&
                region.target.shapeId &&
                region.key === String(region.target.shapeId)
            )
            expect(shapeRegions.length).toBeGreaterThan(0)
            for (const region of shapeRegions)
              expect(svg).toContain(`data-nc-shape-id="${region.key}"`)
          }
        }
        const repeated = await word.ctx.finalizeRunFileChanges()
        expect(repeated.map((record) => record.previewPath)).toEqual(
          records.map((record) => record.previewPath)
        )
        for (const record of records) {
          expect(
            (await runtime.docxApplyService.fileChanges.revertRecord({ changeId: record.id }))
              .requiresForce
          ).toBe(true)
          expect(
            (
              await runtime.docxApplyService.fileChanges.revertRecord({
                changeId: record.id,
                force: true
              })
            ).success
          ).toBe(true)
        }
        for (let index = 0; index < paths.length; index++)
          expect(await fs.readFile(paths[index])).toEqual(originals[index])
        await word.release()
        runtime.assertThat(true, {
          name: 'immutable-four-format-review',
          message: '正式写盘、固定 B、自包含审核、临时清理和精确字节回退均通过'
        })
        return {
          records: records.map((record) => ({
            capability: record.capability,
            checksum: record.afterChecksum,
            previewPath: record.previewPath
          }))
        }
      },
      assert: async () => undefined
    })
  })
})
