import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { writeOfficeFile } from '../../../../src/main/services/files/OfficeFileWriteService'
import { writeTextFileAtomically } from '../../../../src/main/services/files/TextFileWriteService'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const hashOf = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

describe('unit text-file-write-service', () => {
  it('text-file-write-service', async () => {
    await runBackendCase({
      caseId: 'text-file-write-service',
      harnessMode: 'tool-real',
      domain: 'unit',
      suite: 'files',
      groups: ['write'],
      description: 'write-text-file 原子写入的 UTF-8 校验、冲突检测与字节保真。',
      fixtures: ['tests/fixtures/workspace'],
      runMode: 'single',
      execute: async (runtime) => {
        const workspaceRoot = runtime.workspaceRoot
        const newFilePath = path.join(workspaceRoot, 'write-new.txt')
        const existingPath = path.join(workspaceRoot, 'write-existing.txt')
        const crlfPath = path.join(workspaceRoot, 'write-crlf.txt')

        const created = writeTextFileAtomically(newFilePath, 'hello\nworld\n')
        const createdBytes = await fs.readFile(newFilePath, 'utf8')
        const tempFilesLeft = (await fs.readdir(workspaceRoot)).filter((name) =>
          name.startsWith('.ncurator-write-')
        )

        await fs.writeFile(existingPath, 'original')
        const matchedHash = writeTextFileAtomically(existingPath, 'updated', 'no-hash-match')
        const matchedHashWriteSkipped = (await fs.readFile(existingPath, 'utf8')) === 'original'
        const currentHash = hashOf(await fs.readFile(existingPath))
        const overwriteOk = writeTextFileAtomically(existingPath, 'updated', currentHash)
        const overwriteApplied = (await fs.readFile(existingPath, 'utf8')) === 'updated'
        const missingFileConflict = writeTextFileAtomically(
          path.join(workspaceRoot, 'never-created.txt'),
          'x',
          'some-hash'
        )
        const deletedPath = path.join(workspaceRoot, 'deleted-editor-file.txt')
        await fs.writeFile(deletedPath, 'before deletion')
        await fs.unlink(deletedPath)
        const delayedEditorSave = writeTextFileAtomically(
          deletedPath,
          'pending save',
          undefined,
          true
        )
        const deletedFileNotRecreated = !delayedEditorSave.ok && !(await pathExists(deletedPath))

        const crlfContent = 'line one\r\nline two\r\n'
        const crlfOk = writeTextFileAtomically(crlfPath, crlfContent)
        const crlfBytes = await fs.readFile(crlfPath)
        const crlfPreserved = crlfBytes.equals(Buffer.from(crlfContent, 'utf8'))

        const loneSurrogate = `bad\uD800chars`
        const invalid = writeTextFileAtomically(
          path.join(workspaceRoot, 'invalid.txt'),
          loneSurrogate
        )
        const invalidFileNotCreated = !(await pathExists(path.join(workspaceRoot, 'invalid.txt')))

        const shared = path.join(workspaceRoot, 'concurrent.docx')
        await fs.writeFile(shared, 'original')
        const expectedHash = hashOf(await fs.readFile(shared))
        const competing = await Promise.all(
          ['first', 'second'].map((value) =>
            writeOfficeFile({ filePath: shared, bytes: Buffer.from(value), expectedHash })
          )
        )
        const savedHash = hashOf(await fs.readFile(shared))
        return {
          coordinated:
            competing.filter((r) => r.success && r.hash === savedHash).length === 1 &&
            competing.filter((r) => r.conflict).length === 1,
          created: created.ok && createdBytes === 'hello\nworld\n' && Boolean(created.hash),
          noTempLeftovers: tempFilesLeft.length === 0,
          matchedHashRejected:
            !matchedHash.ok && Boolean(matchedHash.conflict) && matchedHashWriteSkipped,
          overwriteOk: overwriteOk.ok && overwriteApplied,
          missingFileConflict: !missingFileConflict.ok && Boolean(missingFileConflict.error),
          deletedFileNotRecreated,
          crlfOk: crlfOk.ok && crlfPreserved,
          invalidRejected: !invalid.ok && Boolean(invalid.error) && invalidFileNotCreated
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.coordinated &&
            result.created &&
            result.noTempLeftovers &&
            result.matchedHashRejected &&
            result.overwriteOk &&
            result.missingFileConflict &&
            result.deletedFileNotRecreated &&
            result.crlfOk &&
            result.invalidRejected,
          {
            name: 'text-file-write-service',
            message:
              'write-text-file 原子写入应创建/覆盖文件且不残留临时文件；expectedHash 不匹配拒绝覆盖；缺失文件带 expectedHash 报冲突；CRLF 字节保真；孤立代理对内容拒绝写入。\n' +
              JSON.stringify(result),
            data: result
          }
        )
      }
    })
  })
})

describe('manual workbook saves', () => {
  it('persists values, formulas, styles, merges and sheet order without replacing untouched rich cells', async () => {
    const ExcelJS = (await import('exceljs')).default
    const { toExcelWorkbookData } = await import('../../../../src/shared/excelWorkbook')
    const { exportExcelEdits } =
      await import('../../../../src/main/services/files/ExcelWorkbookEdit')
    const { BooleanNumber } = await import('@univerjs/core')
    const { expect } = await import('vitest')
    const source = new ExcelJS.Workbook()
    const data = source.addWorksheet('Data'),
      notes = source.addWorksheet('Notes')
    data.getCell('A1').value = '金额'
    data.getCell('B2').value = 10
    data.getCell('C2').value = { formula: 'B2*2', result: 20 }
    data.getCell('E2').value = { text: '手册', hyperlink: 'https://example.com/manual' }
    data.getCell('E2').note = '保留原批注'
    data.getCell('F2').value = new Date('2026-11-24T00:00:00Z')
    data.getCell('F2').numFmt = 'yyyy-mm-dd'
    data.getCell('A1').font = { name: '宋体', size: 11, bold: true }
    notes.getCell('A1').value = '保留其他工作表'
    const bytes = new Uint8Array(await source.xlsx.writeBuffer())
    const before = toExcelWorkbookData(source, 'test.xlsx')
    const after = structuredClone(before),
      id = after.sheetOrder[0]
    after.sheets[id].cellData![1][1].v = 35
    after.sheets[id].cellData![1][2] = { f: '=B2+5', v: 40 }
    after.sheets[id].cellData![0][0].s = {
      ...(after.sheets[id].cellData![0][0].s as object),
      it: BooleanNumber.TRUE
    }
    after.sheets[id].mergeData = [{ startRow: 4, endRow: 4, startColumn: 0, endColumn: 1 }]
    after.sheetOrder.reverse()
    after.sheets[id].name = '最终数据'
    const result = new ExcelJS.Workbook()
    await result.xlsx.load((await exportExcelEdits(bytes, before, after)) as never)
    expect(result.worksheets.map((sheet) => sheet.name)).toEqual(['Notes', '最终数据'])
    const edited = result.getWorksheet('最终数据')!
    expect(edited.getCell('B2').value).toBe(35)
    expect(edited.getCell('C2').formula).toBe('B2+5')
    expect(edited.getCell('C2').result).toBe(40)
    expect(edited.getCell('A1').font).toMatchObject({
      name: '宋体',
      size: 11,
      bold: true,
      italic: true
    })
    expect(edited.getCell('E2').hyperlink).toBe('https://example.com/manual')
    expect(edited.getCell('E2').note).toBe('保留原批注')
    expect(edited.getCell('F2').value).toEqual(new Date('2026-11-24T00:00:00Z'))
    expect(edited.getCell('F2').numFmt).toBe('yyyy-mm-dd')
    expect(edited.model.merges).toContain('A5:B5')
    const next = structuredClone(after)
    next.sheetOrder.push('new-sheet-ui-id')
    next.sheets['new-sheet-ui-id'] = {
      id: 'new-sheet-ui-id',
      name: '新增表',
      cellData: { 0: { 0: { v: '首次写入' } } }
    }
    const firstSave = await exportExcelEdits(
      new Uint8Array(await result.xlsx.writeBuffer()),
      after,
      next
    )
    const another = structuredClone(next)
    another.sheets['new-sheet-ui-id'].cellData![1] = { 0: { v: '后续写入' } }
    const secondSave = await exportExcelEdits(firstSave, next, another)
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(secondSave as never)
    expect(reopened.getWorksheet('新增表')!.getCell('A1').value).toBe('首次写入')
    expect(reopened.getWorksheet('新增表')!.getCell('A2').value).toBe('后续写入')
    const { default: JSZip } = await import('jszip')
    const advanced = await JSZip.loadAsync(bytes)
    advanced.file('xl/charts/chart1.xml', '<chartSpace/>')
    const advancedBytes = await advanced.generateAsync({ type: 'uint8array' })
    await expect(exportExcelEdits(advancedBytes, before, after)).rejects.toThrow('read-only')
  })
})
