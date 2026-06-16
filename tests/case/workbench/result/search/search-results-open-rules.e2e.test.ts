import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  createWorkspaceThroughSettingsUi,
  getWorkbenchLocator,
  insertWorkbenchReferenceToken,
  navigateToWorkbench,
  selectWorkbenchWorkspace,
  setWorkbenchInput,
  setupWorkbenchWorkspaceOnly,
  startLocalWorkbenchHttpServer,
  submitWorkbenchCurrentDraft,
  switchWorkbenchMode,
  waitForWorkbenchSearchScopeEmptyThroughUi,
  waitForWorkbenchSearchResults,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'search-results-open-rules'
const LOCAL_RESULT_FILE = '交付合规同步记录.docx'
const LOCAL_RESULT_QUERY = 'Alice'

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['search'],
        description:
          '真实索引本地文件和网页资料后，搜索模式展示右侧结果并按本地/网页规则打开，不启动 AI。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const server = await startLocalWorkbenchHttpServer(
            '<!doctype html><title>Workbench Search Web</title><main>cedar-search-888 web indexed content.</main>'
          )
          const setup = await runtime.step({
            name: 'prepare-search-workspace',
            message: '通过真实 Settings UI 创建工作区、绑定临时目录并索引本地文件和网页资料。',
            data: {
              webSourceUrl: server.url
            },
            run: async () =>
              await setupWorkbenchWorkspaceOnly(page, {
                caseId: CASE_ID,
                workspaceName: 'Workbench Search Workspace',
                webSourceUrl: server.url
              })
          })
          try {
            const fileSearch = await runtime.step({
              name: 'search-local-docx',
              message: `切换搜索模式并从真实本地索引结果打开 ${LOCAL_RESULT_FILE} 预览。`,
              run: async () => {
                await switchWorkbenchMode(page, '没头脑')
                await insertWorkbenchReferenceToken(page, LOCAL_RESULT_FILE, '交付合规')
                await appendWorkbenchInputText(page, LOCAL_RESULT_QUERY)
                await submitWorkbenchCurrentDraft(page)
                const fileResults = await waitForWorkbenchSearchResults(page)
                const fileResultsText = ((await fileResults.textContent()) || '').trim()
                await fileResults
                  .locator('div')
                  .filter({ hasText: LOCAL_RESULT_FILE })
                  .first()
                  .getByRole('button', { name: '预览文件' })
                  .click()
                await getWorkbenchLocator(page, workbenchSelectors.documentView).waitFor({
                  state: 'visible'
                })
                const docxViewerVisible = await getWorkbenchLocator(
                  page,
                  workbenchSelectors.docxViewer
                )
                  .isVisible()
                  .catch(() => false)
                return {
                  fileResultsText,
                  docxViewerVisible
                }
              }
            })

            const webSearch = await runtime.step({
              name: 'search-web-source',
              message: '切换搜索模式并从真实网页索引结果触发系统浏览器打开。',
              run: async () => {
                await switchWorkbenchMode(page, '没头脑')
                await insertWorkbenchReferenceToken(page, 'Workbench Search Web', server.url)
                await appendWorkbenchInputText(page, 'cedar-search-888')
                await submitWorkbenchCurrentDraft(page)
                const webResults = await waitForWorkbenchSearchResults(page)
                const webResultsText = ((await webResults.textContent()) || '').trim()
                await webResults
                  .locator('div')
                  .filter({ hasText: 'cedar-search-888' })
                  .first()
                  .getByRole('button', { name: '打开网页' })
                  .click()
                return webResultsText
              }
            })

            const emptySearchResult = await runtime.step({
              name: 'search-empty-workspace',
              message: '创建无可检索资料的真实工作区并验证搜索模式拦截提示。',
              run: async () => {
                await createWorkspaceThroughSettingsUi(page, 'Workbench Empty Search Workspace')
                await navigateToWorkbench(page)
                await selectWorkbenchWorkspace(page, 'Workbench Empty Search Workspace')
                await switchWorkbenchMode(page, '没头脑')
                const emptyScopeProbe = await waitForWorkbenchSearchScopeEmptyThroughUi(page)
                runtime.signal({
                  name: 'workbench-empty-search-scope-settled',
                  message: '切换空工作区后通过真实 @ 候选空态确认搜索范围刷新完成。',
                  data: {
                    emptyScopeProbe
                  }
                })
                const messagesBefore = await getWorkbenchLocator(page, workbenchSelectors.messageList)
                  .locator('.ant-chat-message')
                  .count()
                await setWorkbenchInput(page, 'anything')
                const sendButtonStateBefore = await getWorkbenchLocator(
                  page,
                  workbenchSelectors.sendButton
                ).evaluate((element) => {
                  if (!(element instanceof HTMLButtonElement)) {
                    throw new Error('workbench send button is not an HTMLButtonElement')
                  }
                  return {
                    disabled: element.disabled,
                    text: (element.textContent || '').trim()
                  }
                })
                await getWorkbenchLocator(page, workbenchSelectors.sendButton).evaluate((element) => {
                  if (!(element instanceof HTMLButtonElement)) {
                    throw new Error('workbench send button is not an HTMLButtonElement')
                  }
                  element.click()
                })
                await page.waitForTimeout(1000)
                const messagesAfter = await getWorkbenchLocator(page, workbenchSelectors.messageList)
                  .locator('.ant-chat-message')
                  .count()
                const draftText = (
                  (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
                ).trim()
                const rightPanelText = (
                  (await getWorkbenchLocator(page, workbenchSelectors.contentPanel).textContent()) || ''
                ).trim()
                return {
                  messagesBefore,
                  messagesAfter,
                  sendButtonStateBefore,
                  draftText,
                  rightPanelText
                }
              }
            })
            const signals = await runtime.collectSignals()

            return {
              fileResultsText: fileSearch.fileResultsText,
              docxViewerVisible: fileSearch.docxViewerVisible,
              webResultsText: webSearch,
              emptySearchResult,
              aiEventCount: signals.aiRunEventEntries.length,
              openExternalCalls: signals.ipcInvokeEntries.filter(
                (entry) => entry.name === 'openExternal'
              ).length
            }
          } finally {
            await setup.workspace.cleanup()
            await server.close()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.aiEventCount === 0 &&
              result.fileResultsText.includes(LOCAL_RESULT_FILE) &&
              result.docxViewerVisible &&
              /cedar-search-888/u.test(result.webResultsText) &&
              result.openExternalCalls >= 1 &&
              result.emptySearchResult.messagesBefore === result.emptySearchResult.messagesAfter &&
              result.emptySearchResult.draftText.includes('anything') &&
              result.emptySearchResult.rightPanelText.includes('右侧暂无内容'),
            {
              name: 'workbench-search-results-real-open-rules',
              message:
                '搜索模式应使用真实索引结果且不启动 AI；本地结果进入文件预览，网页结果走系统打开，无可检索资料时应拦截发送并保留输入，对齐 WB-COMPOSER-004、WB-PANEL-002、WB-MODE-002。',
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
