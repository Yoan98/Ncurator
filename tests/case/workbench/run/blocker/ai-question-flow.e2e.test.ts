import fs from 'node:fs/promises'
import path from 'node:path'
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
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          // Keep this live case focused on clarification. The generic E2E workspace
          // contains many unrelated documents, which can make the model spend its
          // entire turn exploring instead of resolving the stated ambiguity.
          await fs.writeFile(
            path.join(setup.workspace.rootPath, 'brief.md'),
            '# Brief\n\n主题：待定\n\n视觉风格：未说明\n',
            'utf8'
          )
          // This case isolates AI clarification. Full access auto-approves
          // ordinary tools, while ask_user_question still waits for the user.
          await selectWorkbenchExecutionPermission(page, '完全访问')
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
          const questions = required.interaction.questions
          if (questions.length < 1 || questions.length > 3) {
            throw new Error(`expected one to three questions, received ${questions.length}`)
          }
          const answerQuestionCard = async (
            currentQuestions: typeof questions
          ): Promise<void> => {
            await card.waitFor({ state: 'visible', timeout: 30_000 })
            for (const [index, question] of currentQuestions.entries()) {
              if (index === 0) {
                await card.getByTestId(
                  `workbench-human-question-option-${question.id}-custom`
                ).click()
                await card
                  .getByTestId(`workbench-human-question-custom-input-${question.id}`)
                  .fill('使用深绿色和白色，整体保持克制')
              } else {
                const firstOption = question.options[0]
                if (!firstOption) throw new Error(`question ${question.id} options are empty`)
                await card.getByTestId(
                  `workbench-human-question-option-${question.id}-${firstOption.id}`
                ).click()
              }
              if (index < currentQuestions.length - 1) {
                await card.getByTestId(workbenchSelectors.humanQuestionNext).click()
              }
            }
            await card.getByTestId(workbenchSelectors.humanQuestionSubmit).click()
          }

          const beforeAnswerEvents = (await collectWorkbenchAiRunEvents(runtime)).filter(
            (event) => event.runId === required.runId
          )
          const mutatingTools = new Set([
            'text_file_edit',
            'terminal_run',
            'docx_content_edit',
            'docx_format',
            'docx_table_edit',
            'ppt_edit',
            'excel_edit'
          ])
          if (beforeAnswerEvents.some((event) => event.type === 'tool_call_started' && mutatingTools.has(event.toolName))) {
            throw new Error('a mutating tool ran before the first question was answered')
          }

          await page.reload()
          await answerQuestionCard(questions)

          const seenInteractionIds = new Set([required.interactionId])
          const completionDeadline = Date.now() + 180_000
          for (;;) {
            const events = (await collectWorkbenchAiRunEvents(runtime)).filter(
              (event) => event.runId === required.runId
            )
            const nextRequired = events.find(
              (event) => isQuestionRequired(event) && !seenInteractionIds.has(event.interactionId)
            )
            if (nextRequired) {
              seenInteractionIds.add(nextRequired.interactionId)
              await answerQuestionCard(nextRequired.interaction.questions)
              continue
            }
            if (events.some((event) => event.type === 'run_completed')) break
            const failure = events.find((event) => event.type === 'run_failed' || event.type === 'run_cancelled')
            if (failure) throw new Error(`question flow ended with ${failure.type}`)
            if (Date.now() >= completionDeadline) throw new Error('question flow did not reach completion')
            await new Promise((resolve) => setTimeout(resolve, 500))
          }

          const process = page.getByTestId(workbenchSelectors.assistantProcessPrefix).last()
          await process.click()
          const processText = (await process.textContent()) || ''
          const events = (await collectWorkbenchAiRunEvents(runtime)).filter(
            (event) => event.runId === required.runId
          )
          const resolved = events.find(
            (event) =>
              event.type === 'human_interaction_resolved' &&
              event.interactionId === required.interactionId
          )
          if (!resolved) throw new Error('question resolved event was not recorded')
          return {
            resolved,
            questionCount: questions.length,
            processText,
            events,
            questionIds: questions.map((question) => question.id)
          }
        },
        assert: async (result) => {
          if (result.questionCount < 1 || result.questionCount > 3) {
            throw new Error(`expected one to three questions, received ${result.questionCount}`)
          }
          const resolvedEvent = result.resolved
          if (resolvedEvent.type !== 'human_interaction_resolved') {
            throw new Error('question resolved event was not recorded')
          }
          const answers = resolvedEvent.result.answers
          if (!Array.isArray(answers) || answers.length !== result.questionCount) {
            throw new Error('the submitted result did not contain one answer for every question')
          }
          const questionIds = new Set(result.questionIds)
          const answerIds = new Set(answers.map((answer) => answer.id))
          if (questionIds.size !== answerIds.size || [...questionIds].some((id) => !answerIds.has(id))) {
            throw new Error('the submitted result did not preserve every question id')
          }
          if (!result.processText.includes('使用深绿色和白色，整体保持克制')) {
            throw new Error('Activity did not show the submitted custom answer')
          }
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
