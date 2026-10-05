import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { createExcelToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const RED = 'FFD14343'
const GREEN = 'FF22A06B'

const collectBorderAddresses = (sheet: ExcelJS.Worksheet, color: string): string[] => {
  const addresses: string[] = []
  sheet.eachRow((row) =>
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (cell.border?.left?.color?.argb === color) addresses.push(cell.address)
    })
  )
  return addresses.sort()
}

describe('ai tool excel row diff backend', () => {
  it('excel-diff-row-structure-semantics', async () => {
    await runBackendCase({
      caseId: 'excel-diff-row-structure-semantics',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['excel'],
      description: '验证删除中间行后只标红被删除行，不把后续上移数据误判为绿色修改。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'row-delete.xlsx')
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('阶段涨幅')
        sheet.addRows([
          ['时段', '基金涨幅', '同类平均', '沪深300', '跟踪标的'],
          ['近1周', '7.31%', '2.80%', '2.26%', '6.96%'],
          ['近1月', '10.20%', '1.20%', '0.50%', '9.80%'],
          ['近3月', '26.89%', '-3.46%', '-1.44%', '26.98%'],
          ['近6月', '27.50%', '-4.15%', '-0.07%', '26.96%'],
          ['今年来', '49.53%', '2.41%', '1.57%', '50.11%'],
          ['近1年', '99.31%', '17.53%', '13.94%', '102.17%'],
          ['近2年', '187.37%', '57.75%', '37.93%', '196.70%'],
          ['近3年', '145.29%', '31.98%', '20.50%', '147.70%']
        ])
        sheet.getRow(3).height = 28
        const baselineBytes = Buffer.from(await workbook.xlsx.writeBuffer())
        await Promise.all(
          [
            sourcePath,
            path.join(runtime.workspaceRoot, 'row-insert.xlsx'),
            path.join(runtime.workspaceRoot, 'row-delete-first.xlsx'),
            path.join(runtime.workspaceRoot, 'row-delete-last.xlsx'),
            path.join(runtime.workspaceRoot, 'row-delete-contiguous.xlsx')
          ].map((filePath) => fs.writeFile(filePath, baselineBytes))
        )

        const harness = createExcelToolHarness(runtime)
        const recordOf = async (filePath: string) => {
          await harness.ctx.finalizeRunFileChanges()
          const record = (await harness.ctx.listFileChangeRecords({ runId: runtime.runId })).find(
            (item) => item.path === filePath
          )
          if (!record?.previewPath) throw new Error(`missing preview for ${filePath}`)
          return record as { previewPath: string; insertCount: number; deleteCount: number }
        }
        await harness.invoke('excel_edit', {
          type: 'delete_rows',
          sourcePath,
          sheetName: '阶段涨幅',
          startRow: 3,
          count: 1
        })
        const edited = await recordOf(sourcePath)
        await harness.invoke('excel_edit', {
          type: 'insert_rows',
          sourcePath: path.join(runtime.workspaceRoot, 'row-insert.xlsx'),
          sheetName: '阶段涨幅',
          startRow: 3,
          count: 1
        })
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: path.join(runtime.workspaceRoot, 'row-insert.xlsx'),
          sheetName: '阶段涨幅',
          range: 'A3:E3',
          values: [['新增行', '1%', '2%', '3%', '4%']]
        })
        const inserted = await recordOf(path.join(runtime.workspaceRoot, 'row-insert.xlsx'))
        await harness.invoke('excel_edit', {
          type: 'delete_rows',
          sourcePath: path.join(runtime.workspaceRoot, 'row-delete-first.xlsx'),
          sheetName: '阶段涨幅',
          startRow: 2,
          count: 1
        })
        const deletedFirst = await recordOf(
          path.join(runtime.workspaceRoot, 'row-delete-first.xlsx')
        )
        await harness.invoke('excel_edit', {
          type: 'delete_rows',
          sourcePath: path.join(runtime.workspaceRoot, 'row-delete-last.xlsx'),
          sheetName: '阶段涨幅',
          startRow: 9,
          count: 1
        })
        const deletedLast = await recordOf(path.join(runtime.workspaceRoot, 'row-delete-last.xlsx'))
        await harness.invoke('excel_edit', {
          type: 'delete_rows',
          sourcePath: path.join(runtime.workspaceRoot, 'row-delete-contiguous.xlsx'),
          sheetName: '阶段涨幅',
          startRow: 3,
          count: 2
        })
        const deletedContiguous = await recordOf(
          path.join(runtime.workspaceRoot, 'row-delete-contiguous.xlsx')
        )

        const actual = new ExcelJS.Workbook()
        await actual.xlsx.load((await fs.readFile(sourcePath)) as never)
        const diff = new ExcelJS.Workbook()
        await diff.xlsx.load((await fs.readFile(edited.previewPath)) as never)
        const actualSheet = actual.getWorksheet('阶段涨幅')!
        const diffSheet = diff.getWorksheet('阶段涨幅')!
        const inspectDiff = async (previewPath: string) => {
          const inspected = new ExcelJS.Workbook()
          await inspected.xlsx.load((await fs.readFile(previewPath)) as never)
          const inspectedSheet = inspected.getWorksheet('阶段涨幅')!
          return {
            labels: inspectedSheet.getColumn(1).values.slice(2),
            red: collectBorderAddresses(inspectedSheet, RED),
            green: collectBorderAddresses(inspectedSheet, GREEN)
          }
        }
        return {
          actualLabels: actualSheet.getColumn(1).values.slice(2),
          diffLabels: diffSheet.getColumn(1).values.slice(2),
          redAddresses: collectBorderAddresses(diffSheet, RED),
          greenAddresses: collectBorderAddresses(diffSheet, GREEN),
          deletedRowHeight: diffSheet.getRow(3).height,
          insertCount: edited.insertCount,
          deleteCount: edited.deleteCount,
          inserted: await inspectDiff(inserted.previewPath),
          deletedFirst: await inspectDiff(deletedFirst.previewPath),
          deletedLast: await inspectDiff(deletedLast.previewPath),
          deletedContiguous: await inspectDiff(deletedContiguous.previewPath)
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          JSON.stringify(result.actualLabels) ===
            JSON.stringify(['近1周', '近3月', '近6月', '今年来', '近1年', '近2年', '近3年']) &&
            JSON.stringify(result.diffLabels) ===
              JSON.stringify([
                '近1周',
                '近1月',
                '近3月',
                '近6月',
                '今年来',
                '近1年',
                '近2年',
                '近3年'
              ]) &&
            JSON.stringify(result.redAddresses) ===
              JSON.stringify(['A3', 'B3', 'C3', 'D3', 'E3']) &&
            result.greenAddresses.length === 0 &&
            result.deletedRowHeight === 28 &&
            result.insertCount === 0 &&
            result.deleteCount === 5 &&
            JSON.stringify(result.inserted.green) ===
              JSON.stringify(['A3', 'B3', 'C3', 'D3', 'E3']) &&
            result.inserted.red.length === 0 &&
            result.inserted.labels[1] === '新增行' &&
            JSON.stringify(result.deletedFirst.red) ===
              JSON.stringify(['A2', 'B2', 'C2', 'D2', 'E2']) &&
            result.deletedFirst.green.length === 0 &&
            JSON.stringify(result.deletedLast.red) ===
              JSON.stringify(['A9', 'B9', 'C9', 'D9', 'E9']) &&
            result.deletedLast.green.length === 0 &&
            JSON.stringify(result.deletedContiguous.red) ===
              JSON.stringify(['A3', 'A4', 'B3', 'B4', 'C3', 'C4', 'D3', 'D4', 'E3', 'E4']) &&
            result.deletedContiguous.green.length === 0,
          {
            name: 'excel-row-delete-produces-one-red-tombstone-without-shift-noise',
            message: '删除中间行时只应标红被删除行，后续上移行不得产生绿色标记或底部重复。',
            data: result
          }
        )
      }
    })
  })

  it('excel-diff-cumulative-net-semantics', async () => {
    await runBackendCase({
      caseId: 'excel-diff-cumulative-net-semantics',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['excel'],
      description: '验证同一 run 中改回原值、插入后删除和新增 Sheet 后删除不会留下净 Diff。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const writeBaseline = async (fileName: string): Promise<void> => {
          const workbook = new ExcelJS.Workbook()
          const sheet = workbook.addWorksheet('Data')
          sheet.addRows([
            ['Label', 'Value'],
            ['Keep', 'A']
          ])
          await fs.writeFile(
            path.join(runtime.workspaceRoot, fileName),
            Buffer.from(await workbook.xlsx.writeBuffer())
          )
        }
        await Promise.all(
          [
            'cell-restored.xlsx',
            'row-restored.xlsx',
            'sheet-restored.xlsx',
            'sheet-renamed.xlsx'
          ].map(writeBaseline)
        )

        const harness = createExcelToolHarness(runtime)
        const recordOf = async (filePath: string) => {
          await harness.ctx.finalizeRunFileChanges()
          const record = (await harness.ctx.listFileChangeRecords({ runId: runtime.runId })).find(
            (item) => item.path === filePath
          )
          if (!record) return undefined
          if (!record.previewPath) throw new Error(`missing preview for ${filePath}`)
          return {
            previewPath: record.previewPath,
            changeCount: record.changeCount,
            insertCount: record.insertCount,
            deleteCount: record.deleteCount
          }
        }
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: path.join(runtime.workspaceRoot, 'cell-restored.xlsx'),
          sheetName: 'Data',
          range: 'B2',
          values: [['B']]
        })
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: path.join(runtime.workspaceRoot, 'cell-restored.xlsx'),
          sheetName: 'Data',
          range: 'B2',
          values: [['A']]
        })
        const cellRestored = await recordOf(path.join(runtime.workspaceRoot, 'cell-restored.xlsx'))

        await harness.invoke('excel_edit', {
          type: 'insert_rows',
          sourcePath: path.join(runtime.workspaceRoot, 'row-restored.xlsx'),
          sheetName: 'Data',
          startRow: 2,
          count: 1
        })
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: path.join(runtime.workspaceRoot, 'row-restored.xlsx'),
          sheetName: 'Data',
          range: 'A2',
          values: [['Temporary']]
        })
        await harness.invoke('excel_edit', {
          type: 'delete_rows',
          sourcePath: path.join(runtime.workspaceRoot, 'row-restored.xlsx'),
          sheetName: 'Data',
          startRow: 2,
          count: 1
        })
        const rowRestored = await recordOf(path.join(runtime.workspaceRoot, 'row-restored.xlsx'))

        await harness.invoke('excel_edit', {
          type: 'add_sheet',
          sourcePath: path.join(runtime.workspaceRoot, 'sheet-restored.xlsx'),
          sheetName: 'Temporary'
        })
        await harness.invoke('excel_edit', {
          type: 'set_range',
          sourcePath: path.join(runtime.workspaceRoot, 'sheet-restored.xlsx'),
          sheetName: 'Temporary',
          range: 'A1',
          values: [['Temporary']]
        })
        await harness.invoke('excel_edit', {
          type: 'delete_sheet',
          sourcePath: path.join(runtime.workspaceRoot, 'sheet-restored.xlsx'),
          sheetName: 'Temporary'
        })
        const sheetRestored = await recordOf(
          path.join(runtime.workspaceRoot, 'sheet-restored.xlsx')
        )

        await harness.invoke('excel_edit', {
          type: 'rename_sheet',
          sourcePath: path.join(runtime.workspaceRoot, 'sheet-renamed.xlsx'),
          sheetName: 'Data',
          newName: 'Intermediate'
        })
        await harness.invoke('excel_edit', {
          type: 'rename_sheet',
          sourcePath: path.join(runtime.workspaceRoot, 'sheet-renamed.xlsx'),
          sheetName: 'Intermediate',
          newName: 'Final'
        })
        const sheetRenamed = await recordOf(path.join(runtime.workspaceRoot, 'sheet-renamed.xlsx'))

        const inspect = async (
          record:
            | {
                previewPath: string
                changeCount: number
                insertCount: number
                deleteCount: number
              }
            | undefined
        ) => {
          if (!record) return undefined
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load((await fs.readFile(record.previewPath)) as never)
          return {
            sheetNames: workbook.worksheets.map((sheet) => sheet.name),
            tabColors: workbook.worksheets.map((sheet) => sheet.properties.tabColor?.argb || null),
            red: workbook.worksheets.flatMap((sheet) => collectBorderAddresses(sheet, RED)),
            green: workbook.worksheets.flatMap((sheet) => collectBorderAddresses(sheet, GREEN)),
            changeCount: record.changeCount,
            insertCount: record.insertCount,
            deleteCount: record.deleteCount
          }
        }

        return {
          cell: await inspect(cellRestored),
          row: await inspect(rowRestored),
          sheet: await inspect(sheetRestored),
          renamed: await inspect(sheetRenamed)
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          [result.cell, result.row, result.sheet].every((item) => item === undefined) &&
            JSON.stringify(result.renamed?.sheetNames) === JSON.stringify(['Final']) &&
            result.renamed?.red.length === 0 &&
            result.renamed.green.includes('A1') &&
            result.renamed.changeCount === 1 &&
            result.renamed.insertCount === 1 &&
            result.renamed.deleteCount === 0,
          {
            name: 'excel-cumulative-diff-removes-zero-net-change-noise',
            message: '改回 baseline、插入后删除和新增 Sheet 后删除都不得留下红绿标记或变更计数。',
            data: result
          }
        )
      }
    })
  })
})
