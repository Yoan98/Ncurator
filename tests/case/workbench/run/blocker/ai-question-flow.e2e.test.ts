import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  collectWorkbenchAiRunEvents,
  getWorkbenchPrefixLocator,
  selectWorkbenchExecutionPermission,
  setupWorkbenchWithTempWorkspace,
  sendWorkbenchMessage,
  waitForLatestAssistantProcess,
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
          for (const entry of await fs.readdir(setup.workspace.rootPath)) {
            if (entry === 'brief.md') continue
            await fs.rm(path.join(setup.workspace.rootPath, entry), {
              recursive: true,
              force: true
            })
          }
          // This case isolates AI clarification. Full access auto-approves
          // ordinary tools, while ask_user_question still waits for the user.
          await selectWorkbenchExecutionPermission(page, '完全访问')
          await sendWorkbenchMessage(
            page,
            '请帮我完善当前工作区里的 brief。里面没有说明最终要突出哪种风格，请先问我一个会影响结果的关键问题，再继续修改。'
          )

          const required = await waitForWorkbenchAiEvent(runtime, {
            name: 'ai_question_required',
            timeoutMs: WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            matches: isQuestionRequired
          })
          if (!isQuestionRequired(required)) throw new Error('AI question was not requested')

          const card = page.getByTestId(workbenchSelectors.humanQuestionCard)
          await card.waitFor({ state: 'visible', timeout: 30_000 })
          const assistanceBadge = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.partnerNeedsAssistancePrefix
          ).first()
          await assistanceBadge.waitFor({ state: 'visible', timeout: 30_000 })
          const questions = required.interaction.questions
          if (questions.length < 1 || questions.length > 3) {
            throw new Error(`expected one to three questions, received ${questions.length}`)
          }
          if (
            questions.some((question) => question.options.length < 2 || question.options.length > 4)
          ) {
            throw new Error('expected every question to contain two to four options')
          }
          const initialCardText = ((await card.textContent()) || '').trim()
          const titleText = (
            (await card
              .getByTestId(`${workbenchSelectors.humanQuestionCard}-title`)
              .textContent()) || ''
          ).trim()
          const selectionTypeTagCount = await card.getByText(/^(单选|可多选)$/).count()
          const position = card.getByTestId(`${workbenchSelectors.humanQuestionCard}-position`)
          const positionText = ((await position.textContent()) || '').trim()
          const positionBox = await position.boundingBox()
          const previousBox = await card
            .getByTestId(workbenchSelectors.humanQuestionPrev)
            .boundingBox()
          const guidePlaceholder =
            (await card
              .getByTestId(`workbench-human-question-user-text-${questions[0].id}`)
              .getAttribute('placeholder')) || ''
          const stopLabel =
            (await card
              .getByTestId(workbenchSelectors.humanQuestionCancel)
              .getAttribute('aria-label')) || ''
          const answerQuestionCard = async (currentQuestions: typeof questions): Promise<void> => {
            await card.waitFor({ state: 'visible', timeout: 30_000 })
            for (const [index, question] of currentQuestions.entries()) {
              if (index === 0) {
                await card
                  .getByTestId(`workbench-human-question-option-${question.id}-other`)
                  .click()
                await card
                  .getByTestId(`workbench-human-question-user-text-${question.id}`)
                  .fill('使用深绿色和白色，整体保持克制')
              } else {
                const firstOption = question.options[0]
                if (!firstOption) throw new Error(`question ${question.id} options are empty`)
                await card
                  .getByTestId(`workbench-human-question-option-${question.id}-${firstOption.id}`)
                  .click()
              }
              if (index < currentQuestions.length - 1 && (index === 0 || question.multiSelect)) {
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
            'docx_content_edit',
            'docx_format',
            'docx_table_edit',
            'ppt_edit',
            'excel_edit'
          ])
          if (
            beforeAnswerEvents.some(
              (event) => event.type === 'tool_call_started' && mutatingTools.has(event.toolName)
            )
          ) {
            throw new Error('a mutating tool ran before the first question was answered')
          }

          await page.reload()
          await assistanceBadge.waitFor({ state: 'visible', timeout: 30_000 })
          const assistanceRestoredAfterReload = await assistanceBadge.isVisible()
          await answerQuestionCard(questions)

          const seenInteractionIds = new Set([required.interactionId])
          const completionDeadline = Date.now() + WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
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
            const failure = events.find(
              (event) => event.type === 'run_failed' || event.type === 'run_cancelled'
            )
            if (failure) throw new Error(`question flow ended with ${failure.type}`)
            if (Date.now() >= completionDeadline)
              throw new Error('question flow did not reach completion')
            await new Promise((resolve) => setTimeout(resolve, 500))
          }

          await assistanceBadge.waitFor({ state: 'hidden', timeout: 30_000 })
          const assistanceClearedAfterCompletion = !(await assistanceBadge.isVisible())

          const process = await waitForLatestAssistantProcess(page)
          const processToggle = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantProcessTogglePrefix
          ).last()
          if ((await processToggle.getAttribute('aria-expanded')) === 'false') {
            await processToggle.click()
          }
          await process.locator('summary').click()
          const processLocators = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantProcessPrefix
          )
          for (const activity of await processLocators.all()) {
            await activity
              .locator('summary')
              .click()
              .catch(() => undefined)
          }
          const processText = (await processLocators.allTextContents()).join('\n')
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
            firstQuestionText: questions[0]?.question || '',
            initialCardText,
            titleText,
            selectionTypeTagCount,
            positionText,
            positionBox,
            previousBox,
            guidePlaceholder,
            stopLabel,
            assistanceRestoredAfterReload,
            assistanceClearedAfterCompletion,
            processText,
            events,
            questionIds: questions.map((question) => question.id)
          }
        },
        assert: async (result) => {
          if (result.questionCount < 1 || result.questionCount > 3) {
            throw new Error(`expected one to three questions, received ${result.questionCount}`)
          }
          if (
            !result.assistanceRestoredAfterReload ||
            !result.assistanceClearedAfterCompletion ||
            !result.initialCardText.includes(`问题 1 / ${result.questionCount}`) ||
            result.titleText !== result.firstQuestionText ||
            result.selectionTypeTagCount !== 0 ||
            result.positionText !== `问题 1 / ${result.questionCount}` ||
            !result.positionBox ||
            !result.previousBox ||
            result.positionBox.x + result.positionBox.width > result.previousBox.x ||
            !result.guidePlaceholder.startsWith('告诉') ||
            !result.guidePlaceholder.endsWith('该怎么做') ||
            !result.stopLabel.includes('停止本次运行')
          ) {
            throw new Error('question card did not align with the approval card controls')
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
          const answerIds = new Set(answers.map((answer) => answer.questionId))
          if (
            questionIds.size !== answerIds.size ||
            [...questionIds].some((id) => !answerIds.has(id))
          ) {
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
