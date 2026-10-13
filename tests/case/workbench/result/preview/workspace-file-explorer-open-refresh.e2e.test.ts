import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'
import JSZip from 'jszip'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  addWorkspaceDirectoryThroughNativeDialog,
  getSettingsLocator,
  removeWorkspaceDirectoryThroughSettingsUi
} from '../../../../harness/e2e/settings'
import { settingsSelectors } from '../../../../../src/renderer/src/testing/selectors'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  navigateToWorkbench,
  selectWorkbenchResourceMenuItem,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'workspace-file-explorer-open-refresh'
const SEED_FILE = 'open-refresh-seed.txt'
const LATE_FILE_A = 'open-refresh-late-a.txt'
const LATE_FILE_B = 'open-refresh-late-b.txt'
const LATE_FILE_C = 'open-refresh-late-c.txt'

const countDirectoryListCalls = async (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      (
        window as typeof window & {
          __NCURATOR_E2E_OBSERVER__?: { ipcInvokeEntries: Array<{ name: string }> }
        }
      ).__NCURATOR_E2E_OBSERVER__?.ipcInvokeEntries.filter(
        (entry) => entry.name === 'workspaceDirectoryList'
      ).length || 0
  )

const triggerWindowFocusRefresh = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true
    })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false
    })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
  await page.waitForTimeout(800)
}

const openAllModeExplorer = async (page: Page): Promise<void> => {
  const filter = page.getByPlaceholder('筛选文件…')
  if (!(await filter.isVisible().catch(() => false))) {
    await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
    await filter.waitFor({ state: 'visible', timeout: 15_000 })
  }
  const modeSwitch = getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerModeSwitch)
  await modeSwitch.getByRole('button', { name: '全部', exact: true }).click()
}

const waitForExplorerFile = async (page: Page, fileName: string): Promise<boolean> => {
  const filter = page.getByPlaceholder('筛选文件…')
  await filter.fill(fileName)
  return await page
    .getByTitle(fileName, { exact: true })
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
}

const closeExplorerIfOpen = async (page: Page): Promise<void> => {
  const overlay = getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerOverlay)
  if (!(await overlay.isVisible().catch(() => false))) return
  const backdrop = getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerBackdrop)
  if (await backdrop.isVisible().catch(() => false)) {
    await backdrop.click({ position: { x: 5, y: 5 } })
  } else {
    await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
  }
  await overlay.waitFor({ state: 'hidden', timeout: 10_000 })
}

const startFileCreation = async (
  page: Page,
  typeLabel: string,
  targetPath?: string
): Promise<void> => {
  if (targetPath) await page.getByTitle(targetPath, { exact: true }).click({ button: 'right' })
  else {
    const list = getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerList)
    const height = await list.evaluate((element) => element.clientHeight)
    await list.click({ button: 'right', position: { x: 8, y: height - 8 } })
  }
  await page.getByRole('menuitem', { name: /^新建文件/u }).hover()
  const typeItem = page.getByRole('menuitem', { name: typeLabel, exact: true })
  await typeItem.waitFor({ state: 'visible' })
  await page.waitForTimeout(250)
  const iconSize = await typeItem.locator('svg[data-file-icon]').evaluate((icon) => ({
    width: Number.parseFloat(getComputedStyle(icon).width),
    height: Number.parseFloat(getComputedStyle(icon).height)
  }))
  if (iconSize.width !== 16 || iconSize.height !== 16)
    throw new Error(`Menu icon must be 16px: ${JSON.stringify(iconSize)}`)
  await typeItem.click()
  await page.getByRole('textbox', { name: '新建文件名', exact: true }).waitFor({ state: 'visible' })
  await typeItem.waitFor({ state: 'hidden' })
}

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      const modelsPath = path.join(os.tmpdir(), `ncurator-empty-models-${randomUUID()}`)
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description: '无目录统一引导、设置往返恢复和空目录；打开列表刷新，展开时焦点才刷。',
        fixtures: [],
        serviceMode: 'real',
        extraEnv: { NCURATOR_MODELS_PATH: modelsPath },
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          runtime.registerResource({
            name: 'empty-model-directory',
            phase: 'after-app-close',
            dispose: async () => await fs.rm(modelsPath, { recursive: true, force: true })
          })
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID, 'empty')
          await navigateToWorkbench(page)
          await createPartnerThroughWorkbenchUi(page, '第一个伙伴')
          const workspaceName = await createPartnerThroughWorkbenchUi(page, '目录引导伙伴')
          const composer = getWorkbenchLocator(page, workbenchSelectors.input)
          const draft = '添加文件目录后继续查看这份资料。'
          await composer.fill(draft)
          await selectWorkbenchResourceMenuItem(runtime, 'file')
          const tabs = getWorkbenchPrefixLocator(page, workbenchSelectors.resourceTabPrefix)
          const launcherId = await tabs.first().getAttribute('data-testid')
          const emptyState = getWorkbenchLocator(page, workbenchSelectors.workspaceFilesEmptyState)
          await emptyState
            .getByText('尚未添加文件目录', { exact: true })
            .waitFor({ state: 'visible' })
          const emptyLayout = await emptyState.evaluate((element) => {
            const panel = element.closest('aside')
            return {
              width: element.getBoundingClientRect().width,
              panelWidth: panel?.getBoundingClientRect().width || 0
            }
          })
          const unifiedEmpty =
            (await emptyState.count()) === 1 &&
            (await page.getByPlaceholder('筛选文件…').count()) === 0 &&
            (await page.getByText('从右侧工作区文件列表中选择').count()) === 0 &&
            emptyLayout.panelWidth - emptyLayout.width < 3
          await runtime.captureScreenshot({
            name: 'workspace-missing-unified',
            message: '未配置目录时，文件 Tab 只显示一个全宽引导和前往设置按钮。'
          })

          await emptyState.getByRole('button', { name: '前往设置' }).click()
          await getSettingsLocator(page, settingsSelectors.workspacePanel).waitFor({
            state: 'visible'
          })
          const settingsTargetCorrect =
            page.url().endsWith('#/settings/workspace') &&
            (await page.getByRole('tab', { name: /文件/u }).getAttribute('aria-selected')) ===
              'true'
          await addWorkspaceDirectoryThroughNativeDialog(page, workspace.rootPath)
          await getSettingsLocator(page, settingsSelectors.backRow).click()
          await page.getByText('目录中暂无文件', { exact: true }).waitFor({ state: 'visible' })
          const selectedPartner = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.partnerItemPrefix
          ).filter({ hasText: workspaceName })
          const returnedStatePreserved =
            ((await selectedPartner.getAttribute('class')) || '').includes(
              'nc-sidebar-item-active'
            ) &&
            (await composer.innerText()) === draft &&
            (await tabs.count()) === 1 &&
            (await tabs.first().getAttribute('data-testid')) === launcherId &&
            (await tabs.first().locator('[aria-current="page"]').count()) === 1
          const emptyDirectoryVisible = await page
            .getByText('目录中暂无文件', { exact: true })
            .isVisible()
          const noVectorModel = await page.evaluate(async () =>
            (await window.api.getModels()).every((model) => !model.isDownloaded)
          )
          await runtime.captureScreenshot({
            name: 'workspace-added-empty-directory',
            message: '添加空目录返回后，原伙伴、草稿和文件 Tab 恢复，列表显示空目录说明。'
          })
          const fileNames = {
            docx: '行内空白文档',
            xlsx: '行内空白工作簿',
            pptx: '行内空白演示',
            md: '行内其他类型'
          }
          const rootCreationResults: boolean[] = []
          for (const [extension, label] of [
            ['docx', 'Word 文档'],
            ['xlsx', 'Excel 工作簿'],
            ['pptx', 'PPT 演示'],
            ['md', '其他类型']
          ] as const) {
            await page.getByPlaceholder('筛选文件…').fill('不会匹配的筛选')
            await startFileCreation(page, label)
            const input = page.getByRole('textbox', { name: '新建文件名', exact: true })
            const focused = await input.evaluate((element) => document.activeElement === element)
            await input.fill(`${fileNames[extension]}.${extension}`)
            await input.press('Enter')
            await page
              .getByTitle(`${fileNames[extension]}.${extension}`, { exact: true })
              .waitFor({ state: 'visible' })
            rootCreationResults.push(
              focused &&
                (await page.getByPlaceholder('筛选文件…').inputValue()) === '' &&
                (await tabs.count()) === 1 &&
                (await tabs.first().getAttribute('data-testid')) === launcherId &&
                (await page.getByText('从右侧工作区文件列表中选择').isVisible())
            )
          }
          const docxPath = path.join(workspace.rootPath, `${fileNames.docx}.docx`)
          const docxBefore = await fs.readFile(docxPath)
          const docxZip = await JSZip.loadAsync(docxBefore)
          const xlsxZip = await JSZip.loadAsync(
            await fs.readFile(path.join(workspace.rootPath, `${fileNames.xlsx}.xlsx`))
          )
          const pptxZip = await JSZip.loadAsync(
            await fs.readFile(path.join(workspace.rootPath, `${fileNames.pptx}.pptx`))
          )
          const blankFilesValid =
            Boolean(docxZip.file('word/document.xml')) &&
            Boolean(
              (await xlsxZip.file('xl/workbook.xml')?.async('string'))?.includes('name="Sheet1"')
            ) &&
            Object.keys(pptxZip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
              .length === 1 &&
            (await fs.readFile(path.join(workspace.rootPath, `${fileNames.md}.md`))).length === 0

          await startFileCreation(page, 'Word 文档')
          const newNameInput = page.getByRole('textbox', { name: '新建文件名', exact: true })
          await newNameInput.fill(fileNames.docx)
          await newNameInput.press('Enter')
          await page
            .getByRole('alert')
            .filter({ hasText: '同名文件或文件夹已存在' })
            .waitFor({ state: 'visible' })
          const duplicatePreserved =
            docxBefore.equals(await fs.readFile(docxPath)) && (await newNameInput.isVisible())
          await newNameInput.fill('bad:name')
          await newNameInput.press('Enter')
          await page
            .getByRole('alert')
            .filter({ hasText: '文件名包含不允许' })
            .waitFor({ state: 'visible' })
          await newNameInput.press('Escape')
          const invalidCancelled =
            !(await newNameInput.isVisible()) &&
            (await page.getByPlaceholder('筛选文件…').isVisible())

          await fs.mkdir(path.join(workspace.rootPath, '子目录'))
          await triggerWindowFocusRefresh(page)
          await startFileCreation(page, '其他类型', '子目录')
          await newNameInput.fill('文件夹内新建.txt')
          await newNameInput.press('Enter')
          await page
            .getByTitle('子目录/文件夹内新建.txt', { exact: true })
            .waitFor({ state: 'visible' })
          const nestedFile = page.getByTitle('子目录/文件夹内新建.txt', { exact: true })
          await nestedFile.click({ button: 'right' })
          const fileMenuCorrect =
            (await page.getByRole('menuitem', { name: /^新建文件/u }).count()) === 0 &&
            (await page.getByRole('menuitem', { name: '重命名', exact: true }).isVisible())
          await page
            .getByRole('menuitem', { name: '重命名', exact: true })
            .waitFor({ state: 'visible' })
          await page.waitForTimeout(250)
          await runtime.captureScreenshot({
            name: 'workspace-file-context-menu',
            message: '紧凑文件菜单只提供重命名和删除，右键行保持灰色选择。'
          })
          await page.keyboard.press('Escape')
          const selectionSurvivedMenu = (await nestedFile.getAttribute('aria-current')) === 'true'
          const untouchedFile = page.getByTitle(`${fileNames.docx}.docx`, { exact: true })
          const backgroundBefore = await untouchedFile.evaluate(
            (node) => getComputedStyle(node).backgroundColor
          )
          await untouchedFile.hover()
          const noHoverHighlight =
            backgroundBefore ===
              (await untouchedFile.evaluate((node) => getComputedStyle(node).backgroundColor)) &&
            (await nestedFile.getAttribute('aria-current')) === 'true'
          await page.getByPlaceholder('筛选文件…').click()
          const outsideClearedSelection = (await nestedFile.getAttribute('aria-current')) === null
          await page.getByPlaceholder('筛选文件…').fill('文件夹内新建.txt')
          await nestedFile.click({ button: 'right' })
          await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
          const renameInput = page.getByRole('textbox', { name: '重命名文件名', exact: true })
          await renameInput.fill('同级重命名.txt')
          await renameInput.press('Enter')
          await page
            .getByTitle('子目录/同级重命名.txt', { exact: true })
            .waitFor({ state: 'visible' })
          const nestedCreationCorrect =
            !(await fs.stat(path.join(workspace.rootPath, '子目录/文件夹内新建.txt')).then(
              () => true,
              () => false
            )) && (await fs.stat(path.join(workspace.rootPath, '子目录/同级重命名.txt'))).isFile()
          await startFileCreation(page, 'Word 文档')
          const list = getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerList)
          const draftPositionCorrect = await list.evaluate((node) => {
            const input = node.querySelector('input[aria-label="新建文件名"]')
            const folder = node.querySelector('[title="子目录"]')
            const firstFile = Array.from(
              node.querySelectorAll('button[data-workspace-entry]')
            ).find(
              (button) =>
                !button.getAttribute('title')?.includes('/') &&
                !button.querySelector('svg[data-file-icon="directory"]')
            )
            return (
              !!input &&
              !!folder &&
              !!firstFile &&
              !!(folder.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING) &&
              !!(input.compareDocumentPosition(firstFile) & Node.DOCUMENT_POSITION_FOLLOWING) &&
              node.querySelectorAll('input').length === 1
            )
          })
          const fixedSuffixSelection = await newNameInput.evaluate(
            (node: HTMLInputElement) =>
              node.value.endsWith('.docx') &&
              node.selectionStart === 0 &&
              node.selectionEnd === node.value.length - 5
          )
          await page.waitForTimeout(250)
          await runtime.captureScreenshot({
            name: 'workspace-create-single-input',
            message: '新建采用单个完整文件名输入框，放在同层目录之后、文件之前。'
          })
          await newNameInput.press('End')
          await newNameInput.press('Delete')
          const fixedSuffixPreserved = (await newNameInput.inputValue()).endsWith('.docx')
          await newNameInput.press('Escape')
          await runtime.captureScreenshot({
            name: 'workspace-inline-create-files',
            message: '四种类型新建有效文件，保留打开文件 Tab，目录右键定位、文件菜单与重命名正确。'
          })
          await fs.writeFile(
            path.join(workspace.rootPath, SEED_FILE),
            'seed for explorer refresh\n'
          )
          await triggerWindowFocusRefresh(page)

          const seedVisibleOnLauncher = await waitForExplorerFile(page, SEED_FILE)
          await page.getByTitle(SEED_FILE, { exact: true }).click()
          await getWorkbenchLocator(page, workbenchSelectors.plainTextEditor).waitFor({
            state: 'visible',
            timeout: 30_000
          })
          await closeExplorerIfOpen(page)

          await fs.writeFile(
            path.join(workspace.rootPath, LATE_FILE_A),
            'created while explorer closed\n'
          )
          await openAllModeExplorer(page)
          const lateAVisibleAfterOpen = await waitForExplorerFile(page, LATE_FILE_A)
          await closeExplorerIfOpen(page)

          const closedFocusBaseline = await countDirectoryListCalls(page)
          await fs.writeFile(
            path.join(workspace.rootPath, LATE_FILE_B),
            'created before focus while closed\n'
          )
          await triggerWindowFocusRefresh(page)
          const closedFocusCallCount = await countDirectoryListCalls(page)
          const focusWhileClosedDidNotRefresh = closedFocusCallCount === closedFocusBaseline

          await openAllModeExplorer(page)
          const lateBVisibleAfterReopen = await waitForExplorerFile(page, LATE_FILE_B)

          const openFocusBaseline = await countDirectoryListCalls(page)
          await fs.writeFile(
            path.join(workspace.rootPath, LATE_FILE_C),
            'created while explorer open\n'
          )
          await triggerWindowFocusRefresh(page)
          const openFocusCallCount = await countDirectoryListCalls(page)
          const focusWhileOpenDidRefresh = openFocusCallCount > openFocusBaseline
          const lateCVisibleAfterOpenFocus = await waitForExplorerFile(page, LATE_FILE_C)

          await page.getByPlaceholder('筛选文件…').fill('')
          await page.getByPlaceholder('筛选文件…').fill('无匹配项')
          await startFileCreation(page, '其他类型')
          await newNameInput.press('Escape')
          const floatingEscapePreservedList =
            !(await newNameInput.isVisible()) &&
            (await getWorkbenchLocator(
              page,
              workbenchSelectors.workspaceExplorerOverlay
            ).isVisible())
          await page.getByPlaceholder('筛选文件…').fill('无匹配项')
          await startFileCreation(page, '其他类型')
          await page.getByPlaceholder('筛选文件…').click()
          const outsideClickCancelled = !(await newNameInput.isVisible())

          const deleteBaseName = `回收站测试-${randomUUID()}`
          let deleteFileName = `${deleteBaseName}.txt`
          let deleteFilePath = path.join(workspace.rootPath, deleteFileName)
          const activeTabBeforeCreate = await tabs
            .locator('[aria-current="page"]')
            .locator('..')
            .getAttribute('data-testid')
          await page.getByPlaceholder('筛选文件…').fill('无匹配项')
          await startFileCreation(page, '其他类型')
          await newNameInput.fill(deleteFileName)
          await newNameInput.press('Enter')
          await page.getByTitle(deleteFileName, { exact: true }).waitFor({ state: 'visible' })
          const floatingCreatePreservedPreview =
            (await getWorkbenchLocator(
              page,
              workbenchSelectors.workspaceExplorerOverlay
            ).isVisible()) &&
            (await getWorkbenchLocator(page, workbenchSelectors.plainTextEditor).isVisible()) &&
            (await tabs
              .locator('[aria-current="page"]')
              .locator('..')
              .getAttribute('data-testid')) === activeTabBeforeCreate
          await page.getByTitle(deleteFileName, { exact: true }).click()
          const editor = getWorkbenchLocator(page, workbenchSelectors.plainTextEditor)
          await editor.waitFor({ state: 'visible' })
          await editor.fill('删除前通过真实编辑器保存的内容')
          await openAllModeExplorer(page)
          await page.getByPlaceholder('筛选文件…').fill('')
          await page.getByTitle(deleteFileName, { exact: true }).click({ button: 'right' })
          await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
          const openRenameInput = page.getByRole('textbox', { name: '重命名文件名', exact: true })
          await openRenameInput.fill(SEED_FILE)
          await openRenameInput.press('Enter')
          await page
            .getByRole('alert')
            .filter({ hasText: '同名文件或文件夹已存在' })
            .waitFor({ state: 'visible' })
          const renameDuplicatePreserved =
            (await openRenameInput.isVisible()) &&
            (await fs.readFile(path.join(workspace.rootPath, SEED_FILE), 'utf8')).includes(
              'seed for explorer'
            )
          await openRenameInput.press('Escape')
          await page.getByTitle(deleteFileName, { exact: true }).click({ button: 'right' })
          await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
          const oldDeletePath = deleteFilePath
          deleteFileName = `${deleteBaseName}-已重命名.txt`
          deleteFilePath = path.join(workspace.rootPath, deleteFileName)
          await openRenameInput.fill(deleteFileName)
          await openRenameInput.press('Enter')
          await page.getByTitle(deleteFileName, { exact: true }).waitFor({ state: 'visible' })
          await editor.waitFor({ state: 'visible' })
          await editor.fill('重命名后继续编辑并保存')
          await page.waitForTimeout(700)
          const renameUpdatedPreview =
            (await tabs.filter({ hasText: deleteFileName }).count()) === 1 &&
            (await fs.readFile(deleteFilePath, 'utf8')) === '重命名后继续编辑并保存' &&
            !(await fs.stat(oldDeletePath).then(
              () => true,
              () => false
            ))
          await runtime.captureScreenshot({
            name: 'workspace-renamed-open-preview',
            message: '重命名同步普通预览与 Tab，文件继续可编辑，旧路径不重建。'
          })
          await page.getByTitle(deleteFileName, { exact: true }).click({ button: 'right' })
          await page.getByRole('menuitem', { name: '删除', exact: true }).click()
          const deleteDialog = page.getByRole('dialog', { name: '删除文件？', exact: true })
          await deleteDialog.getByRole('button', { name: /^取\s*消$/u }).click()
          const deleteCancelled = (await fs.stat(deleteFilePath)).isFile()
          await page.getByTitle(deleteFileName, { exact: true }).click({ button: 'right' })
          await page.getByRole('menuitem', { name: '删除', exact: true }).click()
          await deleteDialog.getByRole('button', { name: '移到回收站', exact: true }).click()
          await deleteDialog.waitFor({ state: 'hidden' })
          await page.getByText('文件已删除', { exact: true }).waitFor({ state: 'visible' })
          await page.getByTitle(deleteFileName, { exact: true }).waitFor({ state: 'hidden' })
          await page.waitForTimeout(1200)
          const fileAbsentAfterDelay = !(await fs.access(deleteFilePath).then(
            () => true,
            () => false
          ))
          await page.getByTitle(SEED_FILE, { exact: true }).click()
          await editor.waitFor({ state: 'visible' })
          const deletedFileNotRecreated =
            fileAbsentAfterDelay &&
            !(await fs.access(deleteFilePath).then(
              () => true,
              () => false
            ))

          await closeExplorerIfOpen(page)
          const previewTabId = await tabs.first().getAttribute('data-testid')
          await page.getByRole('button', { name: '设置', exact: true }).click()
          await page.getByRole('link', { name: '工作空间', exact: true }).click()
          await removeWorkspaceDirectoryThroughSettingsUi(page, workspace.rootPath)
          await getSettingsLocator(page, settingsSelectors.backRow).click()
          await getWorkbenchLocator(page, workbenchSelectors.plainTextEditor).waitFor({
            state: 'visible',
            timeout: 30_000
          })
          await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
          await emptyState
            .getByText('尚未添加文件目录', { exact: true })
            .waitFor({ state: 'visible' })
          const missingDirectoryPreservesPreview =
            (await getWorkbenchLocator(page, workbenchSelectors.plainTextEditor).isVisible()) &&
            (await tabs.first().getAttribute('data-testid')) === previewTabId &&
            (await emptyState.count()) === 1 &&
            (await getWorkbenchLocator(
              page,
              workbenchSelectors.workspaceExplorerOverlay
            ).isVisible()) &&
            (await emptyState.getByRole('button', { name: '前往设置' }).isVisible())
          await runtime.captureScreenshot({
            name: 'workspace-missing-floating-list',
            message: '移除目录后普通文件预览仍在，悬浮列表复用同一设置引导。'
          })

          return {
            unifiedEmpty,
            emptyLayout,
            settingsTargetCorrect,
            returnedStatePreserved,
            emptyDirectoryVisible,
            noVectorModel,
            missingDirectoryPreservesPreview,
            seedVisibleOnLauncher,
            lateAVisibleAfterOpen,
            lateBVisibleAfterReopen,
            focusWhileClosedDidNotRefresh,
            focusWhileOpenDidRefresh,
            lateCVisibleAfterOpenFocus,
            closedFocusBaseline,
            closedFocusCallCount,
            openFocusBaseline,
            openFocusCallCount,
            rootCreationResults,
            blankFilesValid,
            duplicatePreserved,
            invalidCancelled,
            nestedCreationCorrect,
            fileMenuCorrect,
            selectionSurvivedMenu,
            noHoverHighlight,
            outsideClearedSelection,
            draftPositionCorrect,
            fixedSuffixSelection,
            fixedSuffixPreserved,
            renameUpdatedPreview,
            renameDuplicatePreserved,
            floatingEscapePreservedList,
            outsideClickCancelled,
            floatingCreatePreservedPreview,
            deleteCancelled,
            deletedFileNotRecreated,
            workspaceRoot: workspace.rootPath
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.rootCreationResults.every(Boolean) &&
              result.blankFilesValid &&
              result.duplicatePreserved &&
              result.invalidCancelled &&
              result.nestedCreationCorrect &&
              result.fileMenuCorrect &&
              result.selectionSurvivedMenu &&
              result.noHoverHighlight &&
              result.outsideClearedSelection &&
              result.draftPositionCorrect &&
              result.fixedSuffixSelection &&
              result.fixedSuffixPreserved &&
              result.renameUpdatedPreview &&
              result.renameDuplicatePreserved &&
              result.floatingEscapePreservedList &&
              result.outsideClickCancelled &&
              result.floatingCreatePreservedPreview &&
              result.deleteCancelled &&
              result.deletedFileNotRecreated,
            {
              name: 'workspace-file-inline-create-and-trash',
              message:
                '真实右键创建有效 Office/自定义文件；行内重名/非法提示与取消正确；创建保留原预览和列表；删除先确认且不会延迟重建，对齐 WB-PANEL-003-AC24–AC28。',
              data: result
            }
          )
          await runtime.assertThat(
            result.unifiedEmpty &&
              result.settingsTargetCorrect &&
              result.returnedStatePreserved &&
              result.emptyDirectoryVisible &&
              result.noVectorModel &&
              result.missingDirectoryPreservesPreview,
            {
              name: 'workspace-file-empty-state-and-settings-return',
              message:
                '无目录统一引导可跳转工作空间文件页；往返恢复原伙伴、草稿和活动 Tab；无向量模型可浏览，空目录有提示；移除目录不遮替文件预览，对齐 WB-PANEL-003-AC23。',
              data: result
            }
          )
          await runtime.assertThat(
            result.seedVisibleOnLauncher &&
              result.lateAVisibleAfterOpen &&
              result.lateBVisibleAfterReopen &&
              result.focusWhileClosedDidNotRefresh &&
              result.focusWhileOpenDidRefresh &&
              result.lateCVisibleAfterOpenFocus,
            {
              name: 'workspace-file-explorer-open-refresh-real',
              message:
                '打开列表应读到外部新建文件；列表收起时窗口焦点不得触发 directory-list；列表展开时窗口焦点应刷新并展示新文件。',
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
