import { describe, it } from 'vitest'
import type { ChatSessionUiStateV1 } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'session-ui-state-isolation'

const createUiState = (input: {
  draft: string
  mode: 'ai' | 'search'
  executionPermission: 'review' | 'full_access'
  collapsed: boolean
  panelTitle: string
}): ChatSessionUiStateV1 => ({
  version: 1,
  composer: {
    mode: input.mode,
    aiPreference: input.mode === 'ai' ? 'local_sources_strict' : 'default',
    executionPermission: input.executionPermission,
    modelSelection: { mainModel: null },
    workspaceId: null,
    draft: {
      input: input.draft,
      contentNodes: [{ kind: 'text', text: input.draft }],
      selectedReferences: [],
      attachments: [],
      assetBucketId: null
    }
  },
  panel: {
    tabs:
      input.mode === 'ai'
        ? [
            {
              id: 'file:launcher',
              kind: 'file',
              title: input.panelTitle,
              state: { kind: 'file_launcher', title: input.panelTitle }
            }
          ]
        : [],
    activeTabId: input.mode === 'ai' ? 'file:launcher' : null,
    collapsed: input.collapsed,
    fallbackState:
      input.mode === 'search'
        ? {
            kind: 'search_list',
            title: input.panelTitle,
            query: input.draft,
            results: [],
            tokens: [input.draft]
          }
        : { kind: 'empty', title: '资源工作台', description: 'A empty' }
  }
})

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['session'],
        description: '验证两个会话的 Composer 和右侧面板状态反复切换后互不覆盖。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const sessionA = {
            id: 'ui-state-a',
            title: '状态会话 A',
            created_at: 10,
            workspace_id: '',
          pinned: false,
          pinned_at: null
          }
          const sessionB = {
            id: 'ui-state-b',
            title: '状态会话 B',
            created_at: 20,
            workspace_id: '',
          pinned: false,
          pinned_at: null
          }
          const workspaceId = await page.evaluate(async () => {
            const response = await window.api.workspaceCreate({ name: '会话状态隔离工作区' })
            if (!response.success || !response.workspace) throw new Error('workspace create failed')
            return response.workspace.id
          })
          sessionA.workspace_id = workspaceId
          sessionB.workspace_id = workspaceId
          const stateA = createUiState({
            draft: 'A 独立草稿',
            mode: 'ai',
            executionPermission: 'full_access',
            collapsed: false,
            panelTitle: 'A 文件标签'
          })
          const stateB = createUiState({
            draft: 'B 独立搜索',
            mode: 'search',
            executionPermission: 'review',
            collapsed: true,
            panelTitle: 'B 搜索结果'
          })
          await page.evaluate(
            async ({ sessionA, sessionB, stateA, stateB }) => {
              await window.api.chatSessionSave(sessionA)
              await window.api.chatSessionSave(sessionB)
              await window.api.chatSessionUiStateSave({ sessionId: sessionA.id, state: stateA })
              await window.api.chatSessionUiStateSave({ sessionId: sessionB.id, state: stateB })
              await window.api.workbenchUiStateSave({
                activeViewKey: sessionA.id,
                draftState: null
              })
            },
            { sessionA, sessionB, stateA, stateB }
          )
          await page.reload()
          await navigateToWorkbench(page)

          const readOptionalText = async (testId: string) => {
            const locator = getWorkbenchLocator(page, testId)
            return (await locator.count()) > 0 ? ((await locator.textContent()) || '').trim() : ''
          }
          const readVisibleState = async () => ({
            input: (
              (await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || ''
            ).trim(),
            mode: (
              (await getWorkbenchLocator(page, workbenchSelectors.modeSwitch).textContent()) || ''
            ).trim(),
            preference: await readOptionalText(workbenchSelectors.aiPreferenceSwitch),
            executionPermission: await readOptionalText(
              workbenchSelectors.executionPermissionSwitch
            ),
            panelText: await readOptionalText(workbenchSelectors.contentPanelShell),
            panelVisible:
              (await getWorkbenchLocator(page, workbenchSelectors.contentPanelShell).getAttribute(
                'data-panel-visible'
              )) === 'true'
          })
          const selectSession = async (id: string, draft: string) => {
            await getWorkbenchLocator(page, `${workbenchSelectors.sessionItemPrefix}-${id}`).click()
            await page.waitForFunction(
              ({ testId, draft }) =>
                document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() === draft,
              { testId: workbenchSelectors.input, draft }
            )
          }

          const firstA = await readVisibleState()
          await selectSession(sessionB.id, stateB.composer.draft.input)
          const collapsedB = await readVisibleState()
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle).click()
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelShell).waitFor({
            state: 'visible'
          })
          const expandedB = await readVisibleState()
          await selectSession(sessionA.id, stateA.composer.draft.input)
          const secondA = await readVisibleState()
          await selectSession(sessionB.id, stateB.composer.draft.input)
          const secondB = await readVisibleState()
          const persisted = await page.evaluate(
            async ({ sessionAId, sessionBId }) => {
              const [openedA, openedB] = await Promise.all([
                window.api.chatSessionOpen({ sessionId: sessionAId }),
                window.api.chatSessionOpen({ sessionId: sessionBId })
              ])
              return { stateA: openedA.uiState, stateB: openedB.uiState }
            },
            { sessionAId: sessionA.id, sessionBId: sessionB.id }
          )

          return { firstA, collapsedB, expandedB, secondA, secondB, persisted }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.firstA.input === 'A 独立草稿' &&
              result.firstA.mode.includes('AI') &&
              result.firstA.preference.includes('本地资料') &&
              result.firstA.executionPermission.includes('完全访问') &&
              result.firstA.panelText.includes('A 文件标签') &&
              result.firstA.panelVisible &&
              result.collapsedB.input === 'B 独立搜索' &&
              result.collapsedB.mode.includes('搜索') &&
              !result.collapsedB.executionPermission &&
              !result.collapsedB.panelVisible &&
              result.expandedB.panelVisible &&
              result.expandedB.panelText.includes('搜索结果') &&
              result.secondA.input === result.firstA.input &&
              result.secondA.panelText.includes('A 文件标签') &&
              result.secondA.executionPermission.includes('完全访问') &&
              result.secondB.input === result.collapsedB.input &&
              result.secondB.panelText.includes('搜索结果') &&
              result.persisted.stateA?.composer.aiPreference === 'local_sources_strict' &&
              result.persisted.stateA?.composer.executionPermission === 'full_access' &&
              result.persisted.stateA?.panel.activeTabId === 'file:launcher' &&
              result.persisted.stateB?.composer.mode === 'search' &&
              result.persisted.stateB?.composer.executionPermission === 'review' &&
              result.persisted.stateB?.panel.collapsed === false,
            {
              name: 'workbench-session-ui-state-isolation',
              message: 'A/B 会话必须恢复各自的输入、模式、偏好和右侧面板状态。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
