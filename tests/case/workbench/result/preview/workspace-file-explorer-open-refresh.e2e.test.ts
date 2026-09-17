import fs from 'node:fs/promises'
import path from 'node:path'
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

const openAllModeExplorer = async (
  page: Parameters<typeof getWorkbenchLocator>[0]
): Promise<void> => {
  const filter = page.getByPlaceholder('筛选文件…')
  if (!(await filter.isVisible().catch(() => false))) {
    await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
    await filter.waitFor({ state: 'visible', timeout: 15_000 })
  }
  const modeSwitch = getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerModeSwitch)
  await modeSwitch.getByRole('button', { name: '全部', exact: true }).click()
}

const waitForExplorerFile = async (
  page: Parameters<typeof getWorkbenchLocator>[0],
  fileName: string
): Promise<boolean> => {
  const filter = page.getByPlaceholder('筛选文件…')
  await filter.fill(fileName)
  return await page
    .getByTitle(fileName, { exact: true })
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
}

const closeExplorerIfOpen = async (
  page: Parameters<typeof getWorkbenchLocator>[0]
): Promise<void> => {
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
        description: '打开工作区文件列表时重新读取磁盘最新目录，外部新建文件可见。',
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

          await fs.writeFile(
            path.join(workspace.rootPath, LATE_FILE_B),
            'created before second open\n'
          )
          await openAllModeExplorer(page)
          const lateBVisibleAfterReopen = await waitForExplorerFile(page, LATE_FILE_B)

          return {
            seedVisibleOnLauncher,
            lateAVisibleAfterOpen,
            lateBVisibleAfterReopen,
            workspaceRoot: workspace.rootPath
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.seedVisibleOnLauncher &&
              result.lateAVisibleAfterOpen &&
              result.lateBVisibleAfterReopen,
            {
              name: 'workspace-file-explorer-open-refresh-real',
              message:
                '打开工作区文件列表时应重新读取磁盘最新目录；关闭列表期间外部新建的文件在下次打开“全部”后必须可见。',
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
