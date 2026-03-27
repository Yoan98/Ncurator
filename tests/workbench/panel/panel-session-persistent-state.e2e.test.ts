import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  expandLatestAssistantTurn,
  getWorkbenchAssistantStepButtons,
  getWorkbenchLocator,
  openFirstEditedFileChipFromExpandedTurn,
  openLatestAssistantReview,
  submitWorkbenchMessage,
  switchWorkbenchMode,
  waitForAssistantTurnCount,
  waitForWorkbenchReady
} from '../../harness/e2e/workbench'

describe('workbench panel e2e', () => {
  it('panel-session-persistent-state', async () => {
    await runE2ECase({
      caseId: 'panel-session-persistent-state',
      domain: 'workbench',
      suite: 'panel',
      description: '同会话继续发送时，搜索列表 / 文件预览 / review 工作区不默认清空；切会话后重置。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'prepare-search-list-state',
          message: '先进入搜索模式，建立右侧搜索列表状态。',
          run: async () => {
            await waitForWorkbenchReady(page)
            await switchWorkbenchMode(page, 'search')
            await submitWorkbenchMessage(page, '[e2e:search-results]')
            await getWorkbenchLocator(page, workbenchSelectors.searchResults).waitFor({
              state: 'visible'
            })
          }
        })

        const assistantTurnsBeforeFirstAi = await getWorkbenchAssistantStepButtons(page).count()
        await runtime.step({
          name: 'keep-search-list-during-ai-send',
          message: '在同一会话发送 AI 请求，确认搜索列表不会被默认清空。',
          run: async () => {
            await switchWorkbenchMode(page, 'ai')
            await submitWorkbenchMessage(page, '[e2e:chat-edit-review]')
            await waitForAssistantTurnCount(page, assistantTurnsBeforeFirstAi + 1)
            await getWorkbenchLocator(page, workbenchSelectors.searchResults).waitFor({
              state: 'visible'
            })
          }
        })

        const assistantTurnsBeforeSecondAi = await getWorkbenchAssistantStepButtons(page).count()
        await runtime.step({
          name: 'keep-file-preview-during-ai-send',
          message: '打开文件预览后继续发送 AI 请求，确认文件预览不会被默认清空。',
          run: async () => {
            await expandLatestAssistantTurn(page)
            await openFirstEditedFileChipFromExpandedTurn(page)
            await getWorkbenchLocator(page, workbenchSelectors.documentView).waitFor({
              state: 'visible'
            })

            await submitWorkbenchMessage(page, '[e2e:chat-edit-review]')
            await waitForAssistantTurnCount(page, assistantTurnsBeforeSecondAi + 1)
            await getWorkbenchLocator(page, workbenchSelectors.documentView).waitFor({
              state: 'visible'
            })
          }
        })

        const assistantTurnsBeforeThirdAi = await getWorkbenchAssistantStepButtons(page).count()
        await runtime.step({
          name: 'keep-review-workspace-during-ai-send',
          message: '进入 review 工作区后继续发送 AI 请求，确认 review 工作区原地保留。',
          run: async () => {
            await openLatestAssistantReview(page)
            await getWorkbenchLocator(page, workbenchSelectors.reviewPanel).waitFor({
              state: 'visible'
            })

            await submitWorkbenchMessage(page, '[e2e:chat-edit-review]')
            await waitForAssistantTurnCount(page, assistantTurnsBeforeThirdAi + 1)
            await getWorkbenchLocator(page, workbenchSelectors.reviewPanel).waitFor({
              state: 'visible'
            })
            await runtime.captureScreenshot({
              name: 'panel-session-persistent-review-workspace',
              message: '保存同会话 review 工作区持续存在的截图'
            })
          }
        })

        await runtime.step({
          name: 'clear-panel-on-session-switch',
          message: '创建新会话后，确认右侧回到空态。',
          run: async () => {
            await getWorkbenchLocator(page, workbenchSelectors.newSessionButton).click()
            await page.getByText('右侧暂无内容').waitFor({ state: 'visible' })
          }
        })

        return {
          searchResultsVisible: await getWorkbenchLocator(
            page,
            workbenchSelectors.searchResults
          ).isVisible().catch(() => false),
          documentViewVisible: await getWorkbenchLocator(
            page,
            workbenchSelectors.documentView
          ).isVisible().catch(() => false),
          reviewPanelVisible: await getWorkbenchLocator(
            page,
            workbenchSelectors.reviewPanel
          ).isVisible().catch(() => false),
          emptyPanelVisible: await page.getByText('右侧暂无内容').isVisible()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.emptyPanelVisible, {
          name: 'session-switch-resets-right-panel',
          message: '切换到新会话后，右侧应回到空态，对齐 WB-PANEL-001-AC2。',
          data: result
        })

        await runtime.assertThat(
          !result.searchResultsVisible && !result.documentViewVisible && !result.reviewPanelVisible,
          {
            name: 'no-previous-state-remains-after-session-switch',
            message: '切换会话后，上一会话的搜索列表、文件预览与 review 工作区都不应继续残留。',
            data: result
          }
        )
      }
    })
  })
})
