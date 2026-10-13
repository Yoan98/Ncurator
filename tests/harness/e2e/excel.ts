import type { E2ETestRuntime } from './run-e2e-case'
import { getWorkbenchLocator, workbenchSelectors } from './workbench'
import {
  DEFAULT_WORKSHEET_COLUMN_TITLE_HEIGHT,
  DEFAULT_WORKSHEET_COLUMN_WIDTH,
  DEFAULT_WORKSHEET_ROW_HEIGHT,
  DEFAULT_WORKSHEET_ROW_TITLE_WIDTH
} from '@univerjs/core'

/** Copy a visible cell from fixtures with default row/column sizes through the real grid. */
export const copyExcelCell = async (runtime: E2ETestRuntime, address: string): Promise<string> => {
  const match = address.match(/^([A-Z]+)(\d+)$/)
  if (!match) throw new Error(`Invalid Excel address: ${address}`)
  const column = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
  const row = Number(match[2])
  const { page } = runtime
  await page.bringToFront()
  for (let attempt = 0; attempt < 20; attempt++) {
    // A mounted canvas can precede its first grid paint; retry the actual UI action too.
    await getWorkbenchLocator(page, workbenchSelectors.excelViewer).click({
      position: {
        x: DEFAULT_WORKSHEET_ROW_TITLE_WIDTH + (column - 0.5) * DEFAULT_WORKSHEET_COLUMN_WIDTH,
        y: DEFAULT_WORKSHEET_COLUMN_TITLE_HEIGHT + (row - 0.5) * DEFAULT_WORKSHEET_ROW_HEIGHT
      }
    })
    await runtime.electronApp.evaluate(({ clipboard }) => clipboard.clear())
    await page.keyboard.press('ControlOrMeta+c')
    await page.waitForTimeout(100)
    const value = (
      await runtime.electronApp.evaluate(({ clipboard }) => clipboard.readText())
    ).trim()
    if (value) return value
  }
  return ''
}

/** Attempt a real cell edit and compare the visible value before and after. */
export const verifyExcelCellReadOnly = async (
  runtime: E2ETestRuntime,
  address: string
): Promise<boolean> => {
  const original = await copyExcelCell(runtime, address)
  if (!original) return false
  await runtime.page.keyboard.press('F2')
  await runtime.page.keyboard.type(`EXCEL_EDIT_BLOCKED_${Date.now()}`)
  await runtime.page.keyboard.press('Enter')
  await runtime.page.keyboard.press('Escape')
  const after = await copyExcelCell(runtime, address)
  await runtime.assertThat(after === original, {
    name: `excel-readonly-${address}`,
    message: '真实网格拒绝单元格编辑，复制得到的内容保持原值。',
    data: { address, before: original, after }
  })
  return true
}
