import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  createWorkspaceThroughSettingsUi,
  getWorkbenchLocator,
  getWorkbenchReferenceTokenTexts,
  insertWorkbenchReferenceToken,
  navigateToWorkbench,
  removeFirstWorkbenchReferenceToken,
  selectWorkbenchWorkspace,
  setWorkbenchInput,
  setupWorkbenchWorkspaceOnly,
  startLocalWorkbenchHttpServer,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'reference-token-lifecycle'

describe('workbench conversation e2e', () => {
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'conversation',
      groups: ['scope'],
      description: '真实 workspace + 真实 web source 下验证 @ 候选、token 追加共存、同资料去重、删除和切工作区清理。',
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
          await insertWorkbenchReferenceToken(page, 'human-input.txt')
          const afterFile = await getWorkbenchReferenceTokenTexts(page)
          await insertWorkbenchReferenceToken(page, '工作')
          const afterDirectory = await getWorkbenchReferenceTokenTexts(page)
          await insertWorkbenchReferenceToken(page, server.url)
          const afterWeb = await getWorkbenchReferenceTokenTexts(page)

          await appendWorkbenchInputText(page, '@')
          await getWorkbenchLocator(page, workbenchSelectors.mentionPanel).waitFor({
            state: 'visible'
          })
          const duplicateCandidateVisible = await getWorkbenchLocator(
            page,
            workbenchSelectors.mentionPanel
          )
            .getByText('human-input.txt')
            .isVisible()
            .catch(() => false)
          const tokensBeforeDelete = await getWorkbenchReferenceTokenTexts(page)
          await removeFirstWorkbenchReferenceToken(page)
          const afterDelete = await getWorkbenchReferenceTokenTexts(page)

          await createWorkspaceThroughSettingsUi(page, 'Workbench Empty Scope Workspace')
          await navigateToWorkbench(page)
          await selectWorkbenchWorkspace(page, 'Workbench Empty Scope Workspace')
          const afterWorkspaceSwitch = await getWorkbenchReferenceTokenTexts(page)
          await setWorkbenchInput(page, '@')
          await getWorkbenchLocator(page, workbenchSelectors.mentionPanel).waitFor({
            state: 'visible'
          })
          const emptyPanelText =
            ((await getWorkbenchLocator(page, workbenchSelectors.mentionPanel).textContent()) ||
              '').trim()

          return {
            afterFile,
            afterDirectory,
            afterWeb,
            duplicateCandidateVisible,
            tokensBeforeDelete,
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
          result.afterFile.some((text) => text.includes('human-input.txt')) &&
            result.afterDirectory.some((text) => text.includes('工作')) &&
            result.afterWeb.some((text) => text.includes('human-input.txt')) &&
            result.afterWeb.some((text) => text.includes('工作')) &&
            result.afterWeb.some((text) => text.includes('Workbench Web Fixture') || text.includes('127.0.0.1')) &&
            !result.duplicateCandidateVisible &&
            result.tokensBeforeDelete.length === 3 &&
            result.afterDelete.length === 2 &&
            result.afterWorkspaceSwitch.length === 0 &&
            /没有匹配项|请先选择工作区/u.test(result.emptyPanelText),
          {
            name: 'workbench-reference-token-real-lifecycle',
            message:
              '@ 参考资料应来自真实 workspace/web 索引；选择文件、目录、网页时应追加共存，同一资料不重复出现，删除后移除 token，切换工作区后清理旧 token，空候选给出提示，对齐 WB-SCOPE-001 至 WB-SCOPE-004。',
            data: result
          }
        )
        await assertNoWorkbenchFakeSignals(runtime)
      }
    })
  }, WORKBENCH_LONG_E2E_TIMEOUT_MS)
})
