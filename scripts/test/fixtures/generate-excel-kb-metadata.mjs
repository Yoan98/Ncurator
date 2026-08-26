import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const workspaceFixtureRoot = path.join(root, 'tests/fixtures/workspace')

const salesWorkbook = new ExcelJS.Workbook()
salesWorkbook.title = '2026年度销售汇总'
const quarterSheet = salesWorkbook.addWorksheet('季度销售')
quarterSheet.getCell('A1').value = 'cedar-xlsx-cell-secret'
quarterSheet.getCell('B2').value = 12800
const customerSheet = salesWorkbook.addWorksheet('客户明细')
customerSheet.getCell('A1').value = 'cedar-xlsx-sheet-secret'
const categorySheet = salesWorkbook.addWorksheet('产品&分类')
categorySheet.getCell('A1').value = 'cedar-xlsx-category-secret'

const budgetWorkbook = new ExcelJS.Workbook()
const sheetOne = budgetWorkbook.addWorksheet('Sheet1')
sheetOne.getCell('A1').value = 'cedar-xlsm-cell-secret'
budgetWorkbook.addWorksheet('Sheet2')

await fs.mkdir(workspaceFixtureRoot, { recursive: true })
await fs.writeFile(
  path.join(workspaceFixtureRoot, '销售额统计表.xlsx'),
  Buffer.from(await salesWorkbook.xlsx.writeBuffer())
)
await fs.writeFile(
  path.join(workspaceFixtureRoot, '预算底稿.xlsm'),
  Buffer.from(await budgetWorkbook.xlsx.writeBuffer())
)
console.log('generated excel kb metadata fixtures')
