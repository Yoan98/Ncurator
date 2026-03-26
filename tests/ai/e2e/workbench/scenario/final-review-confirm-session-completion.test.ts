import { test } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import {
  expandLatestAssistantTurn,
  openReviewTargetAt,
  submitWorkbenchAiMessage,
  waitForReviewTargets
} from '../utils/reviewUi'

test('final-review-confirm-session-completion', async () => {
  await runE2ECase({
    caseId: 'final-review-confirm-session-completion',
    caseType: 'scenario',
    domain: 'ai',
    layer: 'e2e',
    suite: 'workbench',
    groups: ['scenario'],
    description:
      'workbench should expose a confirm-copy session, commit it, and then keep only ended-state messaging plus explicit source-file entry.',
    fixtures: ['tests/fixtures/ai/docx/sample-edit.docx'],
    runMode: 'repeatable',
    execute: async (runtime) => {
      await runtime.step({
        name: 'open-workbench-and-start-review-run',
        message: '打开 workbench 并触发确认文档 E2E fixture',
        run: async () => {
          await submitWorkbenchAiMessage(runtime.page, '[e2e:chat-edit-review] 生成确认文档')
        }
      })

      await runtime.step({
        name: 'open-review-session',
        message: '展开 assistant turn 并进入确认文档面板',
        run: async () => {
          await expandLatestAssistantTurn(runtime.page)
          await waitForReviewTargets(runtime.page, 1)
          await openReviewTargetAt(runtime.page, 0)
        }
      })

      await runtime.step({
        name: 'wait-active-confirm-state',
        message: '等待待确认态按钮和校验面板出现',
        run: async () => {
          await runtime.page.getByTestId(workbenchSelectors.reviewValidation).waitFor()
          await runtime.page.getByTestId(workbenchSelectors.reviewCommitButton).waitFor()
        }
      })

      const activeTexts = {
        hasOpenPath: await runtime.page.getByText('系统默认打开').isVisible(),
        hasOpenWith: await runtime.page.getByText('选择其他应用打开...').isVisible(),
        hasOpenInWorkbench: await runtime.page.getByText('在工作台中打开').isVisible()
      }

      await runtime.step({
        name: 'commit-review',
        message: '确认替换源文件并等待结束态状态卡',
        run: async () => {
          await runtime.page.getByTestId(workbenchSelectors.reviewCommitButton).click()
          await runtime.page.getByText('确认文档状态').waitFor()
          await runtime.page
            .getByText('确认副本已清理，修改已写回源文件。')
            .first()
            .waitFor()
        }
      })

      const endedState = {
        statusCardVisible: await runtime.page.getByText('确认文档状态').isVisible(),
        hasOpenPath: await runtime.page.getByText('系统默认打开').count(),
        hasOpenWith: await runtime.page.getByText('选择其他应用打开...').count(),
        hasOpenInWorkbench: await runtime.page.getByText('在工作台中打开').count()
      }

      await runtime.step({
        name: 'open-source-file',
        message: '在结束态通过明确源文件入口打开结果文档',
        run: async () => {
          await runtime.page.getByText('打开源文件').click()
          await runtime.page.getByTestId(workbenchSelectors.documentView).waitFor()
        }
      })

      const documentHeader = await runtime.page.getByTestId(workbenchSelectors.contentPanelTitle).innerText()
      const sourceBadgeVisible = await runtime.page.getByText('源文件').isVisible()

      await runtime.captureScreenshot({
        name: 'final-review-confirm-session-completion',
        message: '确认文档提交后的结束态与源文件视图截图'
      })

      return {
        activeTexts,
        endedState,
        documentHeader,
        sourceBadgeVisible
      }
    },
    assert: async (result, runtime) => {
      await runtime.assertThat(
        result.activeTexts.hasOpenPath &&
          result.activeTexts.hasOpenWith &&
          result.activeTexts.hasOpenInWorkbench,
        {
          name: 'final-review-confirm-active-actions-visible',
          message: 'pending confirm state should expose confirm-copy actions before commit',
          data: result
        }
      )

      await runtime.assertThat(
        result.endedState.statusCardVisible &&
          result.endedState.hasOpenPath === 0 &&
          result.endedState.hasOpenWith === 0 &&
          result.endedState.hasOpenInWorkbench === 0,
        {
          name: 'final-review-confirm-ended-state-hides-confirm-copy-actions',
          message:
            'after commit the ended state should keep only status messaging and remove confirm-copy actions',
          data: result
        }
      )

      await runtime.assertThat(result.sourceBadgeVisible && result.documentHeader.includes('.docx'), {
        name: 'final-review-confirm-ended-state-opens-source-file-explicitly',
        message:
          'after commit the user should reopen the result only through the explicit source-file entry and source badge',
        data: result
      })
    }
  })
})
