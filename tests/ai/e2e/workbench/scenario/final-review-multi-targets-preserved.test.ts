import type { Locator } from 'playwright'
import { test } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import {
  expandLatestAssistantTurn,
  openReviewTargetAt,
  submitWorkbenchAiMessage,
  waitForReviewTargets
} from '../utils/reviewUi'

const readCurrentReviewSourceName = async (reviewPanel: Locator): Promise<string> => {
  const text = await reviewPanel.innerText()
  if (text.includes('e2e-review-source-a.docx')) return 'e2e-review-source-a.docx'
  if (text.includes('e2e-review-source-b.docx')) return 'e2e-review-source-b.docx'
  throw new Error('current review panel does not contain expected e2e source name')
}

test('final-review-multi-targets-preserved', async () => {
  await runE2ECase({
    caseId: 'final-review-multi-targets-preserved',
    caseType: 'scenario',
    domain: 'ai',
    layer: 'e2e',
    suite: 'workbench',
    groups: ['scenario'],
    description:
      'when one run creates multiple confirm sessions, workbench should keep all review targets and allow opening each one.',
    fixtures: ['tests/fixtures/ai/docx/sample-edit.docx'],
    runMode: 'repeatable',
    execute: async (runtime) => {
      await runtime.step({
        name: 'start-multi-review-run',
        message: '触发同一轮多确认文档 E2E fixture',
        run: async () => {
          await submitWorkbenchAiMessage(runtime.page, '[e2e:chat-multi-review] 生成多个确认文档')
        }
      })

      await runtime.step({
        name: 'expand-latest-turn',
        message: '展开最新 assistant turn 的执行详情',
        run: async () => {
          await expandLatestAssistantTurn(runtime.page)
          await waitForReviewTargets(runtime.page, 2)
        }
      })

      const reviewButtons = runtime.page.locator('[data-testid^="workbench-assistant-turn-review-"]')
      const reviewTargetCount = await reviewButtons.count()
      const reviewPanel = runtime.page.getByTestId(workbenchSelectors.reviewPanel)

      await runtime.step({
        name: 'open-first-review-target',
        message: '打开第一个确认文档',
        run: async () => {
          await openReviewTargetAt(runtime.page, 0)
          await runtime.page.waitForFunction(
            () => {
              const panel = document.querySelector('[data-testid="workbench-review-panel"]')
              return Boolean(
                panel?.textContent?.includes('e2e-review-source-a.docx') ||
                  panel?.textContent?.includes('e2e-review-source-b.docx')
              )
            }
          )
        }
      })
      const firstDocumentLabel = await readCurrentReviewSourceName(reviewPanel)

      await runtime.step({
        name: 'reopen-second-review-target',
        message: '切回 assistant turn 后打开第二个确认文档',
        run: async () => {
          await expandLatestAssistantTurn(runtime.page)
          await openReviewTargetAt(runtime.page, 1)
          await runtime.page.waitForFunction(
            (previousName) => {
              const panel = document.querySelector('[data-testid="workbench-review-panel"]')
              const text = panel?.textContent || ''
              if (!text) return false
              const nextName = text.includes('e2e-review-source-a.docx')
                ? 'e2e-review-source-a.docx'
                : text.includes('e2e-review-source-b.docx')
                  ? 'e2e-review-source-b.docx'
                  : ''
              return Boolean(nextName && nextName !== previousName)
            },
            firstDocumentLabel
          )
        }
      })
      const secondDocumentLabel = await readCurrentReviewSourceName(reviewPanel)

      await runtime.captureScreenshot({
        name: 'final-review-multi-targets-preserved',
        message: '同一轮多个确认文档入口保留截图'
      })

      return {
        reviewTargetCount,
        firstDocumentLabel,
        secondDocumentLabel
      }
    },
    assert: async (result, runtime) => {
      await runtime.assertThat(result.reviewTargetCount >= 2, {
        name: 'final-review-multi-targets-visible',
        message: 'the assistant turn should retain at least two confirm-session targets for the same run',
        data: result
      })

      await runtime.assertThat(
        result.firstDocumentLabel !== result.secondDocumentLabel &&
          [result.firstDocumentLabel, result.secondDocumentLabel]
            .sort()
            .join('|') === 'e2e-review-source-a.docx|e2e-review-source-b.docx',
        {
          name: 'final-review-multi-targets-open-distinct-sessions',
          message: 'opening different confirm targets should load distinct review sessions instead of reusing the last one',
          data: result
        }
      )
    }
  })
})
