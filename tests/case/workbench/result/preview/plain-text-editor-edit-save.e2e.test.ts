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

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description: 'TXT/JSON 等 UTF-8 普通文本打开即纯文本编辑，保存保留 CRLF 与 BOM、不 markdown 化改写。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
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
            rootPath: workspace.rootPath
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
          await page.waitForFunction(
            (testId) =>
              (document.querySelector(`[data-testid="${testId}"]`) as HTMLTextAreaElement | null)
                ?.value?.includes('line one'),
            workbenchSelectors.plainTextEditor,
            { timeout: 30_000 }
          )
          const dirtyBadge = getWorkbenchLocator(page, workbenchSelectors.editableFileDirtyBadge)
          const saveButton = getWorkbenchLocator(page, workbenchSelectors.editableFileSaveButton)

          await textEditor.fill('line one\r\nline two\r\nappended line\r\n')
          await dirtyBadge.waitFor({ state: 'visible', timeout: 10_000 })
          await saveButton.click()
          await page.waitForFunction(
            async (testId) => {
              const button = document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null
              return Boolean(button?.disabled)
            },
            workbenchSelectors.editableFileSaveButton,
            { timeout: 10_000 }
          )
          await page.waitForTimeout(300)
          const savedBytes = await fs.readFile(crlfPath)
          const bomPreserved = savedBytes[0] === 0xef && savedBytes[1] === 0xbb && savedBytes[2] === 0xbf
          const crlfPreserved = savedBytes.toString('utf8').includes('appended line\r\n')
          const noLfOnly = !savedBytes.toString('utf8').match(/(?<!\r)\n/)
          const dirtyCleared = (await dirtyBadge.count()) === 0

          await openWorkspaceFile(page, fileFilter, 'config.json')
          await page.waitForFunction(
            (testId) =>
              (document.querySelector(`[data-testid="${testId}"]`) as HTMLTextAreaElement | null)
                ?.value?.includes('original json'),
            workbenchSelectors.plainTextEditor,
            { timeout: 30_000 }
          )
          const jsonValueBefore = await textEditor.inputValue()
          const jsonEditor = getWorkbenchLocator(page, workbenchSelectors.plainTextEditor)
          await jsonEditor.fill('{\n  "title": "original json",\n  "items": [1, 2]\n}\n')
          await dirtyBadge.waitFor({ state: 'visible', timeout: 10_000 })
          await page.keyboard.press('Meta+S')
          await page.waitForFunction(
            async (testId) => {
              const button = document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null
              return Boolean(button?.disabled)
            },
            workbenchSelectors.editableFileSaveButton,
            { timeout: 10_000 }
          )
          await page.waitForTimeout(300)
          const jsonOnDisk = await fs.readFile(jsonPath, 'utf8')
          const jsonNotMarkdownified =
            jsonOnDisk.includes('"title"') &&
            jsonOnDisk.includes('"items"') &&
            !jsonOnDisk.replace(/[{}[\],:\s]/g, '').includes('#')

          const signals = await runtime.collectSignals()
          return {
            bomPreserved,
            crlfPreserved,
            noLfOnly,
            dirtyCleared,
            jsonEditable: jsonValueBefore.includes('original json'),
            jsonNotMarkdownified,
            writeTextFileCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'writeTextFile'
            ).length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.bomPreserved &&
              result.crlfPreserved &&
              result.noLfOnly &&
              result.dirtyCleared &&
              result.jsonEditable &&
              result.jsonNotMarkdownified &&
              result.writeTextFileCalls >= 2,
            {
              name: 'workbench-plain-text-editor-edit-save-real',
              message:
                'TXT/JSON 打开即纯文本编辑，保存后保留 UTF-8 BOM 与 CRLF 换行、内容不被 markdown 化改写。',
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
