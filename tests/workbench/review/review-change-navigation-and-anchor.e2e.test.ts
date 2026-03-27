import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  getWorkbenchAssistantStepButtons,
  getWorkbenchLocator,
  openLatestAssistantReview,
  submitWorkbenchMessage,
  waitForAssistantTurnCount,
  waitForWorkbenchReady
} from '../../harness/e2e/workbench'

describe('workbench review e2e', () => {
  it('review-change-navigation-and-anchor', async () => {
    await runE2ECase({
      caseId: 'review-change-navigation-and-anchor',
      domain: 'workbench',
      suite: 'review',
      description: '确认修改工作区支持按上一处/下一处切换改动，并把 docx 预览定位到对应 anchor。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        let initialCounter = ''
        let nextCounter = ''
        let initialAnchor = ''
        let nextAnchor = ''
        let returnedAnchor = ''

        await runtime.step({
          name: 'open-single-review',
          message: '生成单文件 review 并进入确认修改工作区。',
          run: async () => {
            await waitForWorkbenchReady(page)
            const assistantTurnCountBeforeRun = await getWorkbenchAssistantStepButtons(page).count()
            await submitWorkbenchMessage(page, '[e2e:chat-edit-review]')
            await waitForAssistantTurnCount(page, assistantTurnCountBeforeRun + 1)
            await openLatestAssistantReview(page)
            await getWorkbenchLocator(page, workbenchSelectors.reviewPanel).waitFor({
              state: 'visible'
            })
            await page.waitForFunction(
              ({ selector }) => {
                const host = document.querySelector(selector)
                return (
                  host instanceof HTMLElement &&
                  typeof host.dataset.lastScrolledAnchor === 'string' &&
                  host.dataset.lastScrolledAnchor.length > 0
                )
              },
              {
                selector: `[data-testid="${workbenchSelectors.docxViewer}"]`
              }
            )
            initialCounter =
              (await getWorkbenchLocator(page, workbenchSelectors.reviewCounter).textContent()) || ''
            initialAnchor =
              (await getWorkbenchLocator(page, workbenchSelectors.docxViewer).getAttribute(
                'data-last-scrolled-anchor'
              )) || ''
          }
        })

        await runtime.step({
          name: 'navigate-to-next-change',
          message: '点击下一处，确认计数变化且预览切到新的 anchor。',
          run: async () => {
            await getWorkbenchLocator(page, workbenchSelectors.reviewNextButton).click()
            await page.waitForFunction(
              ({ selector, expectedCounter }) => {
                const host = document.querySelector(selector)
                return (
                  host instanceof HTMLElement &&
                  typeof host.textContent === 'string' &&
                  host.textContent.includes(expectedCounter)
                )
              },
              {
                selector: `[data-testid="${workbenchSelectors.reviewCounter}"]`,
                expectedCounter: '2 / 2'
              }
            )
            await page.waitForFunction(
              ({ selector, previousAnchor }) => {
                const host = document.querySelector(selector)
                return (
                  host instanceof HTMLElement &&
                  typeof host.dataset.lastScrolledAnchor === 'string' &&
                  host.dataset.lastScrolledAnchor.length > 0 &&
                  host.dataset.lastScrolledAnchor !== previousAnchor
                )
              },
              {
                selector: `[data-testid="${workbenchSelectors.docxViewer}"]`,
                previousAnchor: initialAnchor
              }
            )
            nextCounter =
              (await getWorkbenchLocator(page, workbenchSelectors.reviewCounter).textContent()) || ''
            nextAnchor =
              (await getWorkbenchLocator(page, workbenchSelectors.docxViewer).getAttribute(
                'data-last-scrolled-anchor'
              )) || ''
          }
        })

        await runtime.step({
          name: 'navigate-back-to-first-change',
          message: '点击上一处，确认计数回到第一条且 anchor 回到最初位置。',
          run: async () => {
            await getWorkbenchLocator(page, workbenchSelectors.reviewPrevButton).click()
            await page.waitForFunction(
              ({ selector, expectedCounter }) => {
                const host = document.querySelector(selector)
                return (
                  host instanceof HTMLElement &&
                  typeof host.textContent === 'string' &&
                  host.textContent.includes(expectedCounter)
                )
              },
              {
                selector: `[data-testid="${workbenchSelectors.reviewCounter}"]`,
                expectedCounter: '1 / 2'
              }
            )
            await page.waitForFunction(
              ({ selector, expectedAnchor }) => {
                const host = document.querySelector(selector)
                return (
                  host instanceof HTMLElement &&
                  host.dataset.lastScrolledAnchor === expectedAnchor
                )
              },
              {
                selector: `[data-testid="${workbenchSelectors.docxViewer}"]`,
                expectedAnchor: initialAnchor
              }
            )
            returnedAnchor =
              (await getWorkbenchLocator(page, workbenchSelectors.docxViewer).getAttribute(
                'data-last-scrolled-anchor'
              )) || ''
          }
        })

        return {
          initialCounter,
          nextCounter,
          initialAnchor,
          nextAnchor,
          returnedAnchor
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.initialCounter.includes('1 / 2'), {
          name: 'initial-review-counter-starts-at-first-change',
          message: '打开 review 后应默认选中第一条修改，对齐 WB-REVIEW-001-AC2 与 WB-REVIEW-002-AC1。',
          data: result
        })

        await runtime.assertThat(result.nextCounter.includes('2 / 2'), {
          name: 'next-navigation-updates-counter',
          message: '点击下一处后，当前修改计数应前进到下一条，对齐 WB-REVIEW-002-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.initialAnchor.length > 0 &&
            result.nextAnchor.length > 0 &&
            result.nextAnchor !== result.initialAnchor,
          {
            name: 'next-navigation-scrolls-to-different-anchor',
            message: '点击下一处后，docx 预览应定位到新的 anchor，而不是停留在原位置，对齐 WB-REVIEW-002-AC2。',
            data: result
          }
        )

        await runtime.assertThat(result.returnedAnchor === result.initialAnchor, {
          name: 'previous-navigation-restores-original-anchor',
          message: '点击上一处后，docx 预览应回到最初修改对应的 anchor，对齐 WB-REVIEW-002-AC2。',
          data: result
        })
      }
    })
  })
})
