import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'
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
            workspaceRoot: workspace.rootPath
          }
        },
        assert: async (result, runtime) => {
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
