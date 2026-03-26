import { test } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import {
  expandLatestAssistantTurn,
  openReviewTargetAt,
  submitWorkbenchAiMessage,
  waitForReviewTargets
} from '../utils/reviewUi'

test('final-review-conflict-blocks-commit', async () => {
  await runE2ECase({
    caseId: 'final-review-conflict-blocks-commit',
    caseType: 'boundary',
    domain: 'ai',
    layer: 'e2e',
    suite: 'workbench',
    groups: ['boundary'],
    description:
      'workbench should surface source-file conflicts on confirm sessions and block commit before the source file is overwritten.',
    fixtures: ['tests/fixtures/ai/docx/sample-edit.docx'],
    runMode: 'repeatable',
    execute: async (runtime) => {
      await runtime.step({
        name: 'start-conflict-review-run',
        message: '触发会制造源文件冲突的确认文档 E2E fixture',
        run: async () => {
          await submitWorkbenchAiMessage(runtime.page, '[e2e:chat-review-conflict] 生成冲突确认文档')
        }
      })

      await runtime.step({
        name: 'open-conflict-review',
        message: '展开 assistant turn 并打开冲突确认文档',
        run: async () => {
          await expandLatestAssistantTurn(runtime.page)
          await waitForReviewTargets(runtime.page, 1)
          await openReviewTargetAt(runtime.page, 0)
        }
      })

      await runtime.page.getByTestId(workbenchSelectors.reviewValidation).waitFor()

      const issueTexts = await runtime.page.locator('[data-testid="workbench-review-validation"]').innerText()
      const commitDisabled = await runtime.page.getByTestId(workbenchSelectors.reviewCommitButton).isDisabled()

      await runtime.captureScreenshot({
        name: 'final-review-conflict-blocks-commit',
        message: '确认文档冲突阻断截图'
      })

      return {
        issueTexts,
        commitDisabled
      }
    },
    assert: async (result, runtime) => {
      await runtime.assertThat(
        result.issueTexts.includes('源文件已发生变化') && result.commitDisabled,
        {
          name: 'final-review-conflict-blocks-commit',
          message:
            'source file conflicts should be shown in validation and the confirm button should stay disabled',
          data: result
        }
      )
    }
  })
})
