import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  getWorkbenchAssistantStepButtons,
  getWorkbenchLocator,
  openLatestAssistantReview,
  submitWorkbenchMessage,
  waitForAssistantTurnCount,
  waitForReviewTabCount,
  waitForWorkbenchReady
} from '../../harness/e2e/workbench'

describe('workbench review e2e', () => {
  it('review-file-tabs-and-file-level-actions', async () => {
    await runE2ECase({
      caseId: 'review-file-tabs-and-file-level-actions',
      domain: 'workbench',
      suite: 'review',
      description: '多文件 review 按文件 tab 展示，文件级放弃只影响当前 tab。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        let initialVisibleTabCount = 0
        let titleAfterFirstDiscard = ''

        await runtime.step({
          name: 'create-multi-review',
          message: '提交多文件 review fixture，并进入 review 工作区。',
          run: async () => {
            await waitForWorkbenchReady(page)
            const assistantTurnCountBeforeRun = await getWorkbenchAssistantStepButtons(page).count()
            await submitWorkbenchMessage(page, '[e2e:chat-multi-review]')
            await waitForAssistantTurnCount(page, assistantTurnCountBeforeRun + 1)
            await openLatestAssistantReview(page)
            await getWorkbenchLocator(page, workbenchSelectors.reviewPanel).waitFor({
              state: 'visible'
            })
            await waitForReviewTabCount(page, 2)
            initialVisibleTabCount = await page.evaluate((selector) => {
              const host = document.querySelector(selector)
              if (!(host instanceof HTMLElement)) return 0
              return Array.from(host.querySelectorAll('button')).filter(
                (button) => button instanceof HTMLElement && button.offsetParent !== null
              ).length
            }, `[data-testid="${workbenchSelectors.reviewTabs}"]`)
          }
        })

        await runtime.step({
          name: 'discard-second-file-only',
          message: '切换到第二个文件 tab 并执行放弃，确认只移除当前文件。',
          run: async () => {
            const reviewTabs = getWorkbenchLocator(page, workbenchSelectors.reviewTabs)
            await reviewTabs
              .locator('button:visible')
              .filter({ hasText: 'e2e-review-source-b.docx' })
              .first()
              .click()
            await page.waitForFunction(
              ({ selector, title }) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes(title)
              },
              {
                selector: `[data-testid="${workbenchSelectors.contentPanelTitle}"]`,
                title: 'e2e-review-source-b.docx'
              }
            )
            await getWorkbenchLocator(page, workbenchSelectors.reviewDiscardButton).click()
            await page.waitForFunction(
              ({ selector, title }) => {
                const host = document.querySelector(selector)
                return host instanceof HTMLElement && host.innerText.includes(title)
              },
              {
                selector: `[data-testid="${workbenchSelectors.contentPanelTitle}"]`,
                title: 'e2e-review-source-a.docx'
              }
            )
            titleAfterFirstDiscard =
              (await getWorkbenchLocator(page, workbenchSelectors.contentPanelTitle).textContent()) ||
              ''
          }
        })

        await runtime.step({
          name: 'discard-remaining-file',
          message: '继续放弃剩余文件，确认所有 active review 结束后右侧退出 review 工作区。',
          run: async () => {
            await getWorkbenchLocator(page, workbenchSelectors.reviewDiscardButton).click()
            await page.getByText('右侧暂无内容').waitFor({ state: 'visible' })
            await runtime.captureScreenshot({
              name: 'review-file-tabs-and-file-level-actions-complete',
              message: '保存多文件 review 全部放弃后的截图'
            })
          }
        })

        return {
          initialVisibleTabCount,
          titleAfterFirstDiscard,
          emptyPanelVisible: await page.getByText('右侧暂无内容').isVisible()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.initialVisibleTabCount >= 2, {
          name: 'review-workspace-renders-two-file-tabs',
          message: '多文件 review 应以文件 tab 形式同时展示至少两个 active review 文件，对齐 WB-PANEL-003-AC2 与 WB-REVIEW-007-AC2。',
          data: result
        })

        await runtime.assertThat(result.titleAfterFirstDiscard.includes('e2e-review-source-a.docx'), {
          name: 'discarding-b-keeps-a-actionable',
          message: '先放弃当前的 B 文件后，右侧应切回 A 文件并继续可操作，说明文件级放弃没有串到其他文件，对齐 WB-REVIEW-004-AC3。',
          data: result
        })

        await runtime.assertThat(result.emptyPanelVisible, {
          name: 'review-workspace-closes-after-all-files-end',
          message: '所有文件级 review 都结束后，右侧应退出 review 工作区，对齐 WB-PANEL-003-AC2 与 WB-REVIEW-007-AC2。',
          data: result
        })
      }
    })
  })
})
