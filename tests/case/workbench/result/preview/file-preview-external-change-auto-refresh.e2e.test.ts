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

const CASE_ID = 'file-preview-external-change-auto-refresh'
const EXTERNAL_CHANGE_NOTICE = '检测到当前文件被外部修改，已自动刷新'
const EXTERNAL_APPLICATION_NOTICE = '如果外部应用仍显示旧内容，请关闭该文档后重新打开。'

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description: '普通文件被外部保存后自动刷新，切换或关闭文件后停止旧监听。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        extraEnv: {
          NCURATOR_E2E_OPEN_WITH_NOOP: '1'
        },
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
          const markdownPath = path.join(workspace.rootPath, 'external-watch.md')
          const textPath = path.join(workspace.rootPath, 'external-watch.txt')
          await fs.writeFile(markdownPath, '# External Watch\n\noriginal markdown content')
          await fs.writeFile(textPath, 'original text content')

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
          await fileFilter.fill('external-watch.md')
          await page.getByTitle('external-watch.md', { exact: true }).click()
          const markdownViewer = getWorkbenchLocator(page, workbenchSelectors.markdownViewer)
          await markdownViewer.getByText('original markdown content', { exact: true }).waitFor()
          await page.waitForFunction(() =>
            Boolean(
              (
                window as unknown as {
                  __NCURATOR_E2E_OBSERVER__?: { ipcInvokeEntries?: Array<{ name: string }> }
                }
              ).__NCURATOR_E2E_OBSERVER__?.ipcInvokeEntries?.some(
                (entry) => entry.name === 'fileWatchStart'
              )
            )
          )
          await page.evaluate((noticeText) => {
            const target = window as unknown as {
              __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number
              __NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__?: MutationObserver
            }
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ = 0
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__?.disconnect()
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__ = new MutationObserver(
              (mutations) => {
                if (
                  mutations.some((mutation) =>
                    [...mutation.addedNodes].some((node) => node.textContent?.includes(noticeText))
                  )
                ) {
                  target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ =
                    (target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0) + 1
                }
              }
            )
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__.observe(document.body, {
              childList: true,
              subtree: true
            })
          }, EXTERNAL_CHANGE_NOTICE)

          await fs.writeFile(markdownPath, '# External Watch\n\nfirst external content')
          await fs.writeFile(markdownPath, '# External Watch\n\nsecond external content')
          await fs.writeFile(markdownPath, '# External Watch\n\nfinal external content')
          await markdownViewer.getByText('final external content', { exact: true }).waitFor()
          await page.waitForFunction(
            () =>
              (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ === 1
          )
          const externalChangeNoticeCount = await page.evaluate(
            () =>
              (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0
          )

          await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
          await fileFilter.waitFor({ state: 'visible' })
          await fileFilter.fill('external-watch.txt')
          await page.getByTitle('external-watch.txt', { exact: true }).click()
          const textViewer = getWorkbenchLocator(page, workbenchSelectors.plainTextViewer)
          await textViewer.getByText('original text content', { exact: true }).waitFor()

          await fs.writeFile(markdownPath, '# External Watch\n\nchanged while inactive')
          await page.waitForTimeout(1_000)
          const inactiveFileDidNotRefreshCurrentPreview = await textViewer
            .getByText('original text content', { exact: true })
            .isVisible()
          const inactiveFileNoticeAbsent =
            (await page.evaluate(
              () =>
                (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                  .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0
            )) === externalChangeNoticeCount

          await page.getByRole('button', { name: '选择打开应用' }).last().click()
          await page
            .locator(`[data-testid^="${workbenchSelectors.openWithApplicationPrefix}-"]`)
            .first()
            .waitFor({ state: 'visible' })
          await page.keyboard.press('Escape')
          await getWorkbenchLocator(page, workbenchSelectors.openWithButton).click()
          await page.waitForTimeout(500)
          const ordinaryOpenHintAbsent =
            (await page.getByText(EXTERNAL_APPLICATION_NOTICE, { exact: true }).count()) === 0

          await page.getByRole('button', { name: '关闭 external-watch.txt' }).click()
          await fs.writeFile(textPath, 'changed after tab close')
          await page.waitForTimeout(1_000)
          const closedFileNoticeAbsent =
            (await page.evaluate(
              () =>
                (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                  .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0
            )) === externalChangeNoticeCount
          const signals = await runtime.collectSignals()

          return {
            externalChangeNoticeCount,
            inactiveFileDidNotRefreshCurrentPreview,
            inactiveFileNoticeAbsent,
            ordinaryOpenHintAbsent,
            closedFileNoticeAbsent,
            watchStartCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'fileWatchStart'
            ).length,
            watchStopCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'fileWatchStop'
            ).length,
            openWithCalls: signals.ipcInvokeEntries.filter(
              (entry) => entry.name === 'openFileWithApplication'
            ).length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.externalChangeNoticeCount === 1 &&
              result.inactiveFileDidNotRefreshCurrentPreview &&
              result.inactiveFileNoticeAbsent &&
              result.ordinaryOpenHintAbsent &&
              result.closedFileNoticeAbsent &&
              result.watchStartCalls >= 2 &&
              result.watchStopCalls >= 2 &&
              result.openWithCalls >= 1,
            {
              name: 'workbench-file-preview-external-change-auto-refresh-real',
              message:
                '普通预览应监听真实磁盘变化并自动刷新；切换或关闭文件后应停止旧监听，普通文件打开外部应用不显示 AI 修改提醒。',
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
