import fs from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchLocator,
  navigateToWorkbench,
  prepareWorkbenchWorkspaceThroughUi,
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
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description:
          '打开工作区文件列表时刷新目录；列表收起时焦点不刷，展开时焦点才刷。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          await fs.writeFile(path.join(workspace.rootPath, SEED_FILE), 'seed for explorer refresh\n')

          const workspaceName = `Workbench ${CASE_ID}`
          await prepareWorkbenchWorkspaceThroughUi(page, {
            workspaceName,
            rootPath: workspace.rootPath
          })
          await createPartnerThroughWorkbenchUi(page, workspaceName)
          await navigateToWorkbench(page)

          const panelToggle = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
          if ((await panelToggle.getAttribute('aria-label')) === '展开右侧栏') {
            await panelToggle.click()
          }
          await selectWorkbenchResourceMenuItem(runtime, 'file')

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

          return {
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
