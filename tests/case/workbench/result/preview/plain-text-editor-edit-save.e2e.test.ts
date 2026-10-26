import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchLocator,
  navigateToWorkbench,
  prepareWorkbenchWorkspaceThroughUi,
  selectWorkbenchResourceMenuItem,
  selectWorkbenchWorkspace,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'plain-text-editor-edit-save'

const openWorkspaceFile = async (
  page: import('playwright').Page,
  fileFilter: import('playwright').Locator,
  fileName: string
): Promise<void> => {
  if (!(await fileFilter.isVisible().catch(() => false))) {
    await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
    await fileFilter.waitFor({ state: 'visible' })
  }
  await fileFilter.fill(fileName)
  await page.getByTitle(fileName, { exact: true }).click()
}

const waitForDiskIncludes = async (
  filePath: string,
  needle: string,
  timeout = 10_000
): Promise<boolean> => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if ((await fs.readFile(filePath, 'utf8')).includes(needle)) return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description:
          'TXT/JSON 等 UTF-8 普通文本打开即纯文本编辑，输入自动落盘并保留 CRLF 与 BOM、不 markdown 化改写。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID, 'empty')
          const crlfPath = path.join(workspace.rootPath, 'notes-crlf.txt')
          const jsonPath = path.join(workspace.rootPath, 'config.json')
          const crlfBytes = Buffer.concat([
            Buffer.from([0xef, 0xbb, 0xbf]),
            Buffer.from('line one\r\nline two\r\n', 'utf8')
          ])
          await fs.writeFile(crlfPath, crlfBytes)
          await fs.writeFile(jsonPath, '{\n  "title": "original json"\n}\n', 'utf8')

          const workspaceName = `Workbench ${CASE_ID}`
          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName,
            rootPath: workspace.rootPath,
            prepareFiles: false
          })
          await navigateToWorkbench(page)
          await selectWorkbenchWorkspace(page, workspaceName)
          const panelToggle = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
          if ((await panelToggle.getAttribute('aria-label')) === '展开右侧栏') {
            await panelToggle.click()
          }
          await selectWorkbenchResourceMenuItem(runtime, 'file')

          const fileFilter = page.getByPlaceholder('筛选文件…')
          await openWorkspaceFile(page, fileFilter, 'notes-crlf.txt')
          const textEditor = getWorkbenchLocator(page, workbenchSelectors.plainTextEditor)
          await textEditor.waitFor({ state: 'visible', timeout: 30_000 })
          await page.waitForFunction(
            (testId) =>
              (
                document.querySelector(`[data-testid="${testId}"]`) as HTMLTextAreaElement | null
              )?.value?.includes('line one'),
            workbenchSelectors.plainTextEditor,
            { timeout: 30_000 }
          )

          await textEditor.fill('line one\nline two\nappended line\n')
          const autoSavedTxt = await waitForDiskIncludes(crlfPath, 'appended line')
          const savedBytes = await fs.readFile(crlfPath)
          const bomPreserved =
            savedBytes[0] === 0xef && savedBytes[1] === 0xbb && savedBytes[2] === 0xbf
          const crlfPreserved = savedBytes.toString('utf8').includes('appended line\r\n')
          const noBareLf = !savedBytes.toString('utf8').match(/(?<!\r)\n/)

          const gutter = getWorkbenchLocator(page, workbenchSelectors.lineNumberOverlay)
          const gutterText = (await gutter.textContent()) || ''
          const lineNumbersShown =
            gutterText.includes('1') && gutterText.includes('2') && gutterText.includes('3')

          await openWorkspaceFile(page, fileFilter, 'config.json')
          const jsonEditor = getWorkbenchLocator(page, workbenchSelectors.plainTextEditor)
          await page.waitForFunction(
            (testId) =>
              (
                document.querySelector(`[data-testid="${testId}"]`) as HTMLTextAreaElement | null
              )?.value?.includes('original json'),
            workbenchSelectors.plainTextEditor,
            { timeout: 30_000 }
          )
          const jsonValueBefore = await jsonEditor.inputValue()
          await jsonEditor.fill('{\n  "title": "original json",\n  "items": [1, 2]\n}\n')
          const autoSavedJson = await waitForDiskIncludes(jsonPath, '"items"')
          const jsonOnDisk = await fs.readFile(jsonPath, 'utf8')
          const jsonNotMarkdownified =
            jsonOnDisk.includes('"title"') &&
            jsonOnDisk.includes('"items"') &&
            !jsonOnDisk.replace(/[{}[\],:\s]/g, '').includes('#')

          const signals = await runtime.collectSignals()
          return {
            autoSavedTxt,
            bomPreserved,
            crlfPreserved,
            noBareLf,
            lineNumbersShown,
            jsonEditable: jsonValueBefore.includes('original json'),
            autoSavedJson,
            jsonNotMarkdownified,
            writeTextFileCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'writeTextFile'
            ).length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.autoSavedTxt &&
              result.bomPreserved &&
              result.crlfPreserved &&
              result.noBareLf &&
              result.lineNumbersShown &&
              result.jsonEditable &&
              result.autoSavedJson &&
              result.jsonNotMarkdownified &&
              result.writeTextFileCalls >= 2,
            {
              name: 'workbench-plain-text-editor-edit-save-real',
              message:
                'TXT/JSON 打开即纯文本编辑，编辑后自动落盘，保留 UTF-8 BOM 与 CRLF 换行、内容不被 markdown 化改写；每行前显示行号。\n' +
                JSON.stringify(result),
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
