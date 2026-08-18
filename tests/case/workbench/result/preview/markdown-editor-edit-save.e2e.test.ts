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

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description: 'Markdown 打开即所见即所得编辑，保存按钮与 Cmd+S 落盘，外部冲突与未保存放弃确认。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          const firstPath = path.join(workspace.rootPath, 'edit-first.md')
          const secondPath = path.join(workspace.rootPath, 'edit-second.md')
          await fs.writeFile(firstPath, '# First Title\n\noriginal markdown content')
          await fs.writeFile(secondPath, '# Second Title\n\nsecond markdown content')

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
          const paragraph = editor.getByText(/original markdown content/)
          await paragraph.first().waitFor({ timeout: 30_000 })

          const saveButton = getWorkbenchLocator(page, workbenchSelectors.editableFileSaveButton)
          const dirtyBadge = getWorkbenchLocator(page, workbenchSelectors.editableFileDirtyBadge)
          const saveInitiallyDisabled = await saveButton.isDisabled()

          await paragraph.click()
          await page.keyboard.press('End')
          await page.keyboard.type(' appended text')
          await dirtyBadge.waitFor({ state: 'visible', timeout: 10_000 })

          await saveButton.click()
          await page.waitForFunction(
            async (testId) => {
              const button = document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null
              if (!button) return false
              if (button.disabled) return true
              return false
            },
            workbenchSelectors.editableFileSaveButton,
            { timeout: 10_000 }
          )
          await page.waitForTimeout(300)
          const diskAfterButtonSave = await fs.readFile(firstPath, 'utf8')
          const dirtyBadgeClearedAfterButtonSave = (await dirtyBadge.count()) === 0

          await paragraph.click()
          await page.keyboard.press('End')
          await page.keyboard.type(' via shortcut')
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
          const diskAfterShortcutSave = await fs.readFile(firstPath, 'utf8')
          const dirtyBadgeClearedAfterShortcut = (await dirtyBadge.count()) === 0

          await paragraph.click()
          await page.keyboard.press('End')
          await page.keyboard.type(' local edit')
          await dirtyBadge.waitFor({ state: 'visible', timeout: 10_000 })
          await fs.writeFile(firstPath, '# First Title\n\nexternal override content')
          const conflictBanner = getWorkbenchLocator(page, workbenchSelectors.editableFileConflictBanner)
          await conflictBanner.waitFor({ state: 'visible', timeout: 15_000 })
          await getWorkbenchLocator(page, workbenchSelectors.editableFileConflictSave).click()
          await page.waitForTimeout(500)
          const diskAfterForceSave = await fs.readFile(firstPath, 'utf8')
          const conflictClearedAfterForceSave = (await conflictBanner.count()) === 0

          await paragraph.click()
          await page.keyboard.press('End')
          await page.keyboard.type(' reload me')
          await dirtyBadge.waitFor({ state: 'visible', timeout: 10_000 })
          await fs.writeFile(firstPath, '# First Title\n\nreloaded external content')
          await conflictBanner.waitFor({ state: 'visible', timeout: 15_000 })
          await getWorkbenchLocator(page, workbenchSelectors.editableFileConflictReload).click()
          await editor
            .getByText('reloaded external content', { exact: true })
            .waitFor({ timeout: 15_000 })
          const dirtyClearedAfterReload = (await dirtyBadge.count()) === 0

          const reloadedParagraph = editor.getByText(/reloaded external content/)
          await reloadedParagraph.first().click()
          await page.keyboard.press('End')
          await page.keyboard.type(' will be discarded')
          await dirtyBadge.waitFor({ state: 'visible', timeout: 10_000 })
          await page.getByRole('button', { name: '关闭 edit-first.md' }).click()
          const discardModal = getWorkbenchLocator(page, workbenchSelectors.editableDiscardConfirmModal)
          await discardModal.waitFor({ state: 'visible', timeout: 10_000 })
          await page.getByRole('button', { name: '放弃修改' }).click()
          await discardModal.waitFor({ state: 'hidden', timeout: 10_000 })
          const tabClosedAfterDiscard = (await page.getByTitle('edit-first.md', { exact: true }).count()) === 0
          const diskUnchangedAfterDiscard = (await fs.readFile(firstPath, 'utf8')).includes(
            'reloaded external content'
          )

          const signals = await runtime.collectSignals()
          return {
            saveInitiallyDisabled,
            buttonSaveApplied: diskAfterButtonSave.includes('original markdown content appended text'),
            dirtyBadgeClearedAfterButtonSave,
            shortcutSaveApplied: diskAfterShortcutSave.includes('appended text via shortcut'),
            dirtyBadgeClearedAfterShortcut,
            forceSaveApplied: diskAfterForceSave.includes('local edit'),
            conflictClearedAfterForceSave,
            reloadShowedExternal: dirtyClearedAfterReload,
            tabClosedAfterDiscard,
            diskUnchangedAfterDiscard,
            writeTextFileCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'writeTextFile'
            ).length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.saveInitiallyDisabled &&
              result.buttonSaveApplied &&
              result.dirtyBadgeClearedAfterButtonSave &&
              result.shortcutSaveApplied &&
              result.dirtyBadgeClearedAfterShortcut &&
              result.forceSaveApplied &&
              result.conflictClearedAfterForceSave &&
              result.reloadShowedExternal &&
              result.tabClosedAfterDiscard &&
              result.diskUnchangedAfterDiscard &&
              result.writeTextFileCalls >= 3,
            {
              name: 'workbench-markdown-editor-edit-save-real',
              message:
                'Markdown 打开即编辑：保存按钮与 Cmd+S 落盘，未保存标记随保存清除；外部修改冲突可仍然保存或重新加载；未保存关闭前有放弃确认且磁盘不被改动。\n' +
                JSON.stringify(result, null, 2),
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
