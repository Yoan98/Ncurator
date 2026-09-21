import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  collectWorkbenchAiRunEvents,
  selectWorkbenchExecutionPermission,
  setupWorkbenchWithTempWorkspace,
  sendWorkbenchMessage,
  waitForWorkbenchAiEvent,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'human-interaction-question-card'

const isQuestionRequired = (
  event: AiRunEvent
): event is Extract<AiRunEvent, { type: 'human_interaction_required' }> =>
  event.type === 'human_interaction_required' && event.interaction.kind === 'question'

describe('workbench AI question e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['blocker'],
        description: '真实 Workbench 提问卡片、刷新恢复、提交后 Activity 问答投影。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          await selectWorkbenchExecutionPermission(page, '审核')
          await sendWorkbenchMessage(
            page,
            '请帮我完善当前工作区里的 brief。里面没有说明最终要突出哪种风格，请先问我一个会影响结果的关键问题，再继续修改。'
          )

          const required = await waitForWorkbenchAiEvent(runtime, {
            name: 'ai_question_required',
            timeoutMs: 180_000,
            matches: isQuestionRequired
          })
          if (!isQuestionRequired(required)) throw new Error('AI question was not requested')

          const card = page.getByTestId(workbenchSelectors.humanQuestionCard)
          await card.waitFor({ state: 'visible', timeout: 30_000 })
          const question = required.interaction.questions[0]
          if (!question) throw new Error('question payload is empty')
          const firstOption = question.options[0]
          if (!firstOption) throw new Error('question options are empty')
          await page.reload()
          await card.waitFor({ state: 'visible', timeout: 30_000 })
          const customOption = card.getByTestId(
            `workbench-human-question-option-${question.id}-custom`
          )
          await customOption.click()
          await card
            .getByTestId(`workbench-human-question-custom-input-${question.id}`)
            .fill('使用深绿色和白色，整体保持克制')
          await card.getByTestId(workbenchSelectors.humanQuestionSubmit).click()

          const resolved = await waitForWorkbenchAiEvent(runtime, {
            name: 'ai_question_resolved',
            timeoutMs: 60_000,
            matches: (event) =>
              event.type === 'human_interaction_resolved' &&
              event.interactionId === required.interactionId
          })
          const completion = await waitForWorkbenchAiRunCompletion(runtime, Date.now(), undefined, undefined, {
            page,
            blockerPolicy: 'fail'
          })
          const process = page.getByTestId(workbenchSelectors.assistantProcessPrefix).last()
          await process.click()
          const processText = (await process.textContent()) || ''
          const events = (await collectWorkbenchAiRunEvents(runtime)).filter(
            (event) => event.runId === required.runId
          )
          return {
            firstOption: firstOption.label,
            resolved,
            processText,
            completion,
            events
          }
        },
        assert: async (result) => {
          if (!result.processText.includes('使用深绿色和白色，整体保持克制')) {
            throw new Error('Activity did not show the submitted custom answer')
          }
          if (!result.events.some((event) => event.type === 'human_interaction_resolved')) {
            throw new Error('question resolved event was not recorded')
          }
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
