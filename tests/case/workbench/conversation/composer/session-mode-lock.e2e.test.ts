import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  createWorkbenchNewSession,
  inspectWorkbenchModeOption,
  insertWorkbenchReferenceToken,
  selectWorkbenchWorkspace,
  setupWorkbenchWorkspaceOnly,
  submitWorkbenchCurrentDraft,
  switchWorkbenchMode,
  waitForWorkbenchSearchResults
} from '../../../../harness/e2e/workbench'
import { WORKBENCH_MODE_LOCK_HINTS } from '../../../../../src/shared/workbenchSessionModeLock'

const CASE_ID = 'session-mode-lock'
const WORKSPACE_NAME = 'Workbench Session Mode Lock Workspace'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description:
          '同一会话搜索后不能切回 AI；禁用项悬浮提示原因；新建对话后模式再次可切换。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await setupWorkbenchWorkspaceOnly(page, {
            caseId: CASE_ID,
            workspaceName: WORKSPACE_NAME
          })

          const draftAi = await inspectWorkbenchModeOption(page, 'AI')
          const draftSearch = await inspectWorkbenchModeOption(page, '搜索')
          await switchWorkbenchMode(page, '搜索')
          await switchWorkbenchMode(page, 'AI')
          await switchWorkbenchMode(page, '搜索')

          await insertWorkbenchReferenceToken(page, 'human-input.txt')
          await appendWorkbenchInputText(page, '确认这段资料存在')
          await submitWorkbenchCurrentDraft(page)
          await waitForWorkbenchSearchResults(page)

          const aiAfterSearch = await inspectWorkbenchModeOption(page, 'AI')
          const searchAfterSearch = await inspectWorkbenchModeOption(page, '搜索')

          await createWorkbenchNewSession(page)
          await selectWorkbenchWorkspace(page, WORKSPACE_NAME)
          const aiAfterNewSession = await inspectWorkbenchModeOption(page, 'AI')
          const searchAfterNewSession = await inspectWorkbenchModeOption(page, '搜索')
          await switchWorkbenchMode(page, '搜索')
          await switchWorkbenchMode(page, 'AI')

          return {
            draftAi,
            draftSearch,
            aiAfterSearch,
            searchAfterSearch,
            aiAfterNewSession,
            searchAfterNewSession
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            !result.draftAi.disabled &&
              !result.draftSearch.disabled &&
              result.aiAfterSearch.disabled &&
              result.aiAfterSearch.tooltip.includes(WORKBENCH_MODE_LOCK_HINTS.disableAi) &&
              !result.searchAfterSearch.disabled &&
              !result.aiAfterNewSession.disabled &&
              !result.searchAfterNewSession.disabled,
            {
              name: 'session-mode-lock-search-then-new-chat',
              message:
                '空草稿应可切换 AI/搜索；搜索发出后 AI 应禁用并显示 Tooltip；新建对话后应再次可切换。',
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
