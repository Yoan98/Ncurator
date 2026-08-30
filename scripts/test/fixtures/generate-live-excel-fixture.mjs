import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const outPath = path.join(root, 'tests/fixtures/workspace/经营周报.xlsx')

const headerFill = (sheet, color) => {
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
}

const workbook = new ExcelJS.Workbook()
workbook.creator = 'NCurator fixture'
workbook.title = '2026年9月经营周报'

const orders = workbook.addWorksheet('订单明细')
orders.addRow(['产品', '区域', '负责人', '实际销售额', '退货', '月份'])
headerFill(orders, 'FF2F5496')

const baseRows = [
  ['华东-经济款', '华东', '陈琳', 820000, 12000, '2026-09'],
  ['华北-标准款', '华北', '赵静', 1040000, 0, '2026-09'],
  ['华东-旗舰款', '华东', '周宇', 650000, 45000, '2026-09'],
  ['华南-优选款', '华南', '孙悦', 910000, 8000, '2026-09'],
  ['华西-基础款', '华西', '吴浩', 430000, 21000, '2026-09']
]

const regions = ['华东', '华北', '华南', '华西']
const owners = ['陈琳', '赵静', '周宇', '孙悦', '吴浩', '刘洋', '王敏']
const tiers = ['经济款', '标准款', '优选款', '旗舰款', '基础款']

for (let index = 0; index < 120; index += 1) {
  if (index < baseRows.length) {
    orders.addRow(baseRows[index])
    continue
  }
  const region = regions[index % regions.length]
  const tier = tiers[index % tiers.length]
  const sales = 380000 + (index % 17) * 47000
  const returns = index % 11 === 0 ? 18000 + (index % 5) * 3000 : index % 7 === 0 ? 6000 : 0
  orders.addRow([
    `${region}-${tier}-${String(index + 1).padStart(3, '0')}`,
    region,
    owners[index % owners.length],
    sales,
    returns,
    '2026-09'
  ])
}

orders.getColumn(4).numFmt = '#,##0'
orders.getColumn(5).numFmt = '#,##0'
orders.getCell('D4').font = { color: { argb: 'FF9C0006' } }
orders.getCell('D4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }
orders.getCell('E4').font = { color: { argb: 'FF9C0006' } }
orders.getCell('E4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }

const targets = workbook.addWorksheet('区域目标')
targets.addRow(['产品', '区域', '目标销售额', '最低毛利率'])
headerFill(targets, 'FF548235')
const targetMargins = [0.18, 0.16, 0.14, 0.15, 0.12]
for (let index = 0; index < 20; index += 1) {
  const source = baseRows[index % baseRows.length]
  targets.addRow([
    source[0],
    source[1],
    [1000000, 1000000, 800000, 900000, 600000][index % 5],
    targetMargins[index % targetMargins.length]
  ])
}
targets.getColumn(3).numFmt = '#,##0'
targets.getColumn(4).numFmt = '0.0%'

const summary = workbook.addWorksheet('汇总看板')
summary.addRow(['指标', '数值'])
headerFill(summary, 'FF833C0C')
summary.getCell('B1').numFmt = '#,##0'
summary.getCell('A2').value = '实际合计'
summary.getCell('B2').value = { formula: 'SUM(订单明细!D2:D121)' }
summary.getCell('A3').value = '目标合计'
summary.getCell('B3').value = { formula: 'SUM(区域目标!C2:C21)' }
summary.getCell('A4').value = '缺口'
summary.getCell('B4').value = { formula: 'B2-B3' }
summary.getCell('A5').value = '低于80万计数'
summary.getCell('B5').value = { formula: 'COUNTIF(订单明细!D2:D121,"<800000")' }
summary.getCell('A6').value = '华北实际'
summary.getCell('B6').value = { formula: 'SUMIF(订单明细!B2:B121,"华北",订单明细!D2:D121)' }
;['B2', 'B3', 'B4', 'B5', 'B6'].forEach((addr) => {
  summary.getCell(addr).numFmt = addr === 'B5' ? '0' : '#,##0'
})

const notes = workbook.addWorksheet('口径说明')
notes.addRow(['备注编号', '负责人', '说明'])
headerFill(notes, 'FF7030A0')
notes.addRow([
  'N-1',
  '财务',
  '华东-旗舰款退货率异常偏高；Q3 关账前保留此备注。'
])
notes.addRow([
  'N-2',
  '销售',
  '华北-标准款退款不影响季度目标对比。'
])
notes.addRow([
  'N-3',
  '运营',
  '华西区域目标维持 600,000 基线，勿改写。'
])

await fs.mkdir(path.dirname(outPath), { recursive: true })
await fs.writeFile(outPath, Buffer.from(await workbook.xlsx.writeBuffer()))
console.log(`wrote ${outPath}`)
