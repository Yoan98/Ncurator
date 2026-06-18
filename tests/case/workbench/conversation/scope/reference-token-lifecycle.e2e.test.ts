import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  createWorkspaceThroughSettingsUi,
  getWorkbenchLocator,
  getWorkbenchLatestUserMessageReferenceTokenTexts,
  getWorkbenchReferenceTokenTexts,
  insertWorkbenchReferenceToken,
  navigateToWorkbench,
  removeFirstWorkbenchReferenceToken,
  selectWorkbenchWorkspace,
  setupWorkbenchWorkspaceOnly,
  startLocalWorkbenchHttpServer,
  submitWorkbenchCurrentDraft,
  switchWorkbenchMode,
  waitForWorkbenchSearchScopeEmptyThroughUi,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'reference-token-lifecycle'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['scope'],
        description:
          '真实 workspace + 真实 web source 下验证 @ 候选、token 追加共存、同资料去重、删除和切工作区清理。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const server = await startLocalWorkbenchHttpServer(
            '<!doctype html><title>Workbench Web Fixture</title><main>Workbench web fixture unique fact: cedar-scope-731.</main>'
          )
          const setup = await setupWorkbenchWorkspaceOnly(page, {
            caseId: CASE_ID,
            workspaceName: 'Workbench Scope Workspace',
            webSourceUrl: server.url
          })
          try {
            await switchWorkbenchMode(page, '大聪明')
            await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
            const afterFile = await getWorkbenchReferenceTokenTexts(page)
            await insertWorkbenchReferenceToken(page, '工作')
            const afterDirectory = await getWorkbenchReferenceTokenTexts(page)

            await appendWorkbenchInputText(page, '@')
            await getWorkbenchLocator(page, workbenchSelectors.mentionPanel).waitFor({
              state: 'visible'
            })
            const mentionPanel = getWorkbenchLocator(page, workbenchSelectors.mentionPanel)
            const mentionPanelText = ((await mentionPanel.textContent()) || '').trim()
            const fileGroupVisible = await mentionPanel.getByText('文件').isVisible()
            const webGroupVisible = await mentionPanel.getByText('网页').isVisible()
            const legacyDirectoryGroupVisible = await mentionPanel
              .getByText('目录')
              .isVisible()
              .catch(() => false)
            const legacyTypeTagVisible = await mentionPanel
              .locator('.nc-tag')
              .filter({ hasText: /DOCX|PDF|文件|网页|目录/u })
              .first()
              .isVisible()
              .catch(() => false)
            const directoryIconVisible = await mentionPanel
              .locator('[data-reference-kind="directory"] [data-reference-icon-kind="directory"]')
              .first()
              .isVisible()
              .catch(() => false)
            const webIconVisible = await mentionPanel
              .locator('[data-reference-kind="web"] [data-reference-icon-kind="web"]')
              .first()
              .isVisible()
              .catch(() => false)
            const duplicateCandidateVisible = await getWorkbenchLocator(
              page,
              workbenchSelectors.mentionPanel
            )
              .getByText('sample-edit.docx')
              .isVisible()
              .catch(() => false)
            await mentionPanel
              .getByRole('button')
              .filter({ hasText: 'Workbench Web Fixture' })
              .click()
            const afterWeb = await getWorkbenchReferenceTokenTexts(page)
            const tokensBeforeSubmit = await getWorkbenchReferenceTokenTexts(page)
            await switchWorkbenchMode(page, '没头脑')
            await appendWorkbenchInputText(page, '请用一句话说明这些资料。')
            await submitWorkbenchCurrentDraft(page)
            const latestUserMessageReferenceTokens =
              await getWorkbenchLatestUserMessageReferenceTokenTexts(page)
            await getWorkbenchLocator(page, workbenchSelectors.sendButton).waitFor({
              state: 'visible'
            })
            await page.waitForFunction(
              (testId: string) => {
                const button = document.querySelector(`[data-testid="${testId}"]`)
                return button instanceof HTMLButtonElement && !button.disabled
              },
              workbenchSelectors.sendButton,
              { timeout: WORKBENCH_LONG_E2E_TIMEOUT_MS }
            )

            await switchWorkbenchMode(page, '大聪明')
            await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
            await insertWorkbenchReferenceToken(page, '工作')
            await insertWorkbenchReferenceToken(page, 'Workbench Web Fixture', server.url)
            const tokensBeforeDelete = await getWorkbenchReferenceTokenTexts(page)
            await removeFirstWorkbenchReferenceToken(page)
            const afterDelete = await getWorkbenchReferenceTokenTexts(page)

            await createWorkspaceThroughSettingsUi(page, 'Workbench Empty Scope Workspace')
            await navigateToWorkbench(page)
            await selectWorkbenchWorkspace(page, 'Workbench Empty Scope Workspace')
            const afterWorkspaceSwitch = await getWorkbenchReferenceTokenTexts(page)
            const emptyPanelText = await waitForWorkbenchSearchScopeEmptyThroughUi(page)

            return {
              afterFile,
              afterDirectory,
              afterWeb,
              mentionPanelText,
              fileGroupVisible,
              webGroupVisible,
              legacyDirectoryGroupVisible,
              legacyTypeTagVisible,
              directoryIconVisible,
              webIconVisible,
              duplicateCandidateVisible,
              tokensBeforeSubmit,
              tokensBeforeDelete,
              latestUserMessageReferenceTokens,
              afterDelete,
              afterWorkspaceSwitch,
              emptyPanelText
            }
          } finally {
            await setup.workspace.cleanup()
            await server.close()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.afterFile.some((text) => text.includes('sample-edit.docx')) &&
              result.afterDirectory.some((text) => text.includes('工作')) &&
              result.afterWeb.some((text) => text.includes('sample-edit.docx')) &&
              result.afterWeb.some((text) => text.includes('工作')) &&
              result.afterWeb.some(
                (text) => text.includes('Workbench Web Fixture') || text.includes('127.0.0.1')
              ) &&
              result.fileGroupVisible &&
              result.webGroupVisible &&
              !result.legacyDirectoryGroupVisible &&
              !result.legacyTypeTagVisible &&
              result.directoryIconVisible &&
              result.webIconVisible &&
              !result.duplicateCandidateVisible &&
              result.tokensBeforeSubmit.length === 3 &&
              result.tokensBeforeDelete.length === 3 &&
              result.latestUserMessageReferenceTokens.length === 3 &&
              result.latestUserMessageReferenceTokens.some((text) =>
                text.includes('sample-edit.docx')
              ) &&
              result.latestUserMessageReferenceTokens.some((text) => text.includes('工作')) &&
              result.latestUserMessageReferenceTokens.some(
                (text) => text.includes('Workbench Web Fixture') || text.includes('127.0.0.1')
              ) &&
              result.afterDelete.length === 2 &&
              result.afterWorkspaceSwitch.length === 0 &&
              /没有匹配项|No data|请先选择工作区/u.test(result.emptyPanelText),
            {
              name: 'workbench-reference-token-real-lifecycle',
              message:
                '@ 参考资料应来自真实 workspace/web 索引；候选按文件/网页分组，目录在文件组内用图标区分，右侧只显示索引状态；选择文件、目录、网页时应追加共存，发送后用户消息保留紧凑 token，同一资料不重复出现，删除后移除 token，切换工作区后清理旧 token，空候选给出提示，对齐 WB-SCOPE-001 至 WB-SCOPE-004。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LONG_E2E_TIMEOUT_MS
  )
})
