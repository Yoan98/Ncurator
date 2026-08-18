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

const CASE_ID = 'markdown-editor-edit-save'

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
        description: 'Markdown 打开即即时渲染编辑、无工具栏，输入自动落盘，空闲外部改动重载、编辑中外部改动被自动覆盖。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          const firstPath = path.join(workspace.rootPath, 'edit-first.md')
          const emptyPath = path.join(workspace.rootPath, 'edit-empty.md')
          await fs.writeFile(firstPath, '# First Title\n\noriginal markdown content\n\n[example](https://example.com)\n\n- item one\n- item two')
          await fs.writeFile(emptyPath, '')

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
          await openWorkspaceFile(page, fileFilter, 'edit-first.md')
          const editor = getWorkbenchLocator(page, workbenchSelectors.markdownEditor)
          await editor.waitFor({ state: 'visible', timeout: 30_000 })

          const toolbarVisible = await editor.locator('.vditor-toolbar').isVisible().catch(() => false)
          const paragraph = editor.getByText('original markdown content', { exact: true })
          await paragraph.waitFor({ state: 'visible', timeout: 30_000 })
          const editorText = (await editor.textContent()) || ''
          const headingVisible = editorText.includes('First Title')
          const paragraphVisible = await paragraph.isVisible().catch(() => false)

          await paragraph.click()
          await page.keyboard.press('End')
          await page.keyboard.type(' appended text')
          const autoSavedAfterTyping = await waitForDiskIncludes(
            firstPath,
            'original markdown content appended text'
          )

          const link = editor.getByText('example', { exact: true }).first()
          const linkVisible = await link.isVisible().catch(() => false)
          let linkSourceRevealed = false
          if (linkVisible) {
            await link.click()
            await page.waitForTimeout(600)
            const text = (await editor.textContent()) || ''
            linkSourceRevealed = text.includes('[example](https://example.com)')
          }

          await fs.writeFile(firstPath, '# First Title\n\nidle external content\n\n[example](https://example.com)')
          await editor
            .getByText('idle external content', { exact: true })
            .waitFor({ timeout: 15_000 })
          const idleReloaded = await editor
            .getByText('idle external content', { exact: true })
            .isVisible()

          const idleParagraph = editor.getByText('idle external content', { exact: true })
          await idleParagraph.click()
          await page.keyboard.press('End')
          await page.keyboard.type(' my edit')
          await page.waitForTimeout(250)
          await fs.writeFile(firstPath, '# First Title\n\nexternal override content')
          const editingOverwroteExternal = await waitForDiskIncludes(firstPath, 'my edit')

          await openWorkspaceFile(page, fileFilter, 'edit-empty.md')
          const emptyEditor = getWorkbenchLocator(page, workbenchSelectors.markdownEditor)
          await emptyEditor.waitFor({ state: 'visible', timeout: 30_000 })
          const emptyEditorHasVditor = await emptyEditor
            .evaluate((el) => (el as HTMLElement).classList.contains('vditor'))
            .catch(() => false)

          const signals = await runtime.collectSignals()
          return {
            toolbarVisible,
            headingVisible,
            paragraphVisible,
            autoSavedAfterTyping,
            linkVisible,
            linkSourceRevealed,
            idleReloaded,
            editingOverwroteExternal,
            emptyEditorHasVditor,
            writeTextFileCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'writeTextFile'
            ).length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            !result.toolbarVisible &&
              result.headingVisible &&
              result.paragraphVisible &&
              result.autoSavedAfterTyping &&
              result.linkVisible &&
              result.linkSourceRevealed &&
              result.idleReloaded &&
              result.editingOverwroteExternal &&
              result.emptyEditorHasVditor &&
              result.writeTextFileCalls >= 1,
            {
              name: 'workbench-markdown-editor-edit-save-real',
              message:
                'Markdown 打开即即时渲染编辑且无工具栏；输入自动落盘；空闲外部改动自动重载、编辑中外部改动被自动覆盖；链接点击局部露出 markdown 源。\n' +
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
