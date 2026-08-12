import { describe, it } from 'vitest'
import type { ChatSessionUiStateV1 } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  getWorkbenchLocator,
  navigateToWorkbench,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'background-session-ui-event-isolation'

const emptyState = (draft: string): ChatSessionUiStateV1 => ({
  version: 1,
  composer: {
    mode: 'search',
    aiPreference: 'default',
    executionPermission: 'review',
    modelSelection: { mainModel: null, visionModel: null },
    workspaceId: null,
    draft: {
      input: draft,
      contentNodes: [{ kind: 'text', text: draft }],
      selectedReferences: [],
      attachments: [],
      assetBucketId: null
    }
  },
  panel: {
    tabs: [],
    activeTabId: null,
    collapsed: true,
    fallbackState: { kind: 'empty', title: '资源工作台', description: '' }
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
        description: '验证后台 A 会话的浏览器状态变化不会覆盖当前 B 会话。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          const sessionA = { id: 'background-a', title: '后台 A', created_at: 10, workspace_id: '' }
          const sessionB = { id: 'background-b', title: '当前 B', created_at: 20, workspace_id: '' }
          const workspaceId = await page.evaluate(async () => {
            const response = await window.api.workspaceCreate({ name: '后台会话隔离工作区' })
            if (!response.success || !response.workspace) throw new Error('workspace create failed')
            return response.workspace.id
          })
          sessionA.workspace_id = workspaceId
          sessionB.workspace_id = workspaceId
          const stateA = emptyState('A 后台草稿')
          const stateB = emptyState('B 当前草稿')
          await page.evaluate(async ({ sessionA, sessionB, stateA, stateB }) => {
            await window.api.chatSessionSave(sessionA)
            await window.api.chatSessionSave(sessionB)
            await window.api.chatSessionUiStateSave({
              sessionId: sessionA.id,
              state: stateA
            })
            await window.api.chatSessionUiStateSave({
              sessionId: sessionB.id,
              state: stateB
            })
            await window.api.workbenchUiStateSave({ activeViewKey: sessionB.id, draftState: null })
          }, { sessionA, sessionB, stateA, stateB })
          await page.reload()
          await navigateToWorkbench(page)
          const browser = await page.evaluate(async (ownerId) => {
            const created = await window.api.browserTabCreate({ ownerId })
            if (!created.success || !created.state) throw new Error('browser create failed')
            const listed = await window.api.browserTabList({ ownerId })
            return { state: created.state, listed }
          }, sessionA.id)
          const currentAfterBackgroundEvent = {
            input: ((await getWorkbenchLocator(page, workbenchSelectors.input).textContent()) || '').trim(),
            shellCount: await getWorkbenchLocator(page, workbenchSelectors.contentPanelShell).count()
          }
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.sessionItemPrefix}-${sessionA.id}`
          ).click()
          await page.waitForFunction(
            ({ testId, draft }) =>
              document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() === draft,
            { testId: workbenchSelectors.input, draft: 'A 后台草稿' }
          )
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle).click()
          await getWorkbenchLocator(page, workbenchSelectors.contentPanelShell).waitFor({
            state: 'visible'
          })
          const aTabVisible = await getWorkbenchLocator(
            page,
            `${workbenchSelectors.resourceTabPrefix}-browser-${browser.state.id}`
          ).isVisible()
          const listedAfterSwitch = await page.evaluate(
            (ownerId) => window.api.browserTabList({ ownerId }),
            sessionA.id
          )
          return { currentAfterBackgroundEvent, browser, listedAfterSwitch, aTabVisible }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.currentAfterBackgroundEvent.input === 'B 当前草稿' &&
              result.currentAfterBackgroundEvent.shellCount === 0 &&
              result.aTabVisible,
            {
              name: 'workbench-background-session-ui-event-isolation',
              message: 'A 的后台浏览器状态只能归属 A，不能展开或覆盖当前 B。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
