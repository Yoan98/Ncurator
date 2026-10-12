import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiRunEvent, PendingHumanInteraction } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  collectWorkbenchAiRunEvents,
  createPartnerThroughWorkbenchUi,
  getWorkbenchPrefixLocator,
  getWorkbenchLocator,
  selectWorkbenchExecutionPermission,
  setupWorkbenchWithTempWorkspace,
  sendWorkbenchMessage,
  waitForLatestAssistantProcess,
  waitForWorkbenchAiEvent,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'human-interaction-question-card'

type QuestionRequiredEvent = Extract<AiRunEvent, { type: 'human_interaction_required' }> & {
  interaction: Extract<PendingHumanInteraction, { kind: 'question' }>
}

const isQuestionRequired = (event: AiRunEvent): event is QuestionRequiredEvent =>
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
        description: '真实 Workbench 提问卡片、伙伴切换与刷新恢复、提交后 Activity 问答投影。',
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
            '请帮我完善当前工作区里的 brief。请先用一次 ask_user_question 提出三题：单选主色（2至4项）、多选视觉风格（2至4项）、纯文字询问需要写入的主题（不提供选项）。等我回答完三题后再继续修改。'
          )

          const required = await waitForWorkbenchAiEvent(runtime, {
            name: 'ai_question_required',
            timeoutMs: WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            matches: isQuestionRequired
          })
          if (!isQuestionRequired(required)) throw new Error('AI question was not requested')

          const card = page.getByTestId(workbenchSelectors.humanQuestionCard)
          await card.waitFor({ state: 'visible', timeout: 30_000 })
          const inputCountDuringQuestion = await getWorkbenchLocator(
            page,
            workbenchSelectors.input
          ).count()
          const composerSendControlCountDuringQuestion = await getWorkbenchLocator(
            page,
            workbenchSelectors.sendButton
          ).count()
          const assistanceBadge = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.partnerNeedsAssistancePrefix
          ).first()
          await assistanceBadge.waitFor({ state: 'visible', timeout: 30_000 })
          const assistanceBadgeTestId = await assistanceBadge.getAttribute('data-testid')
          const assistancePartnerId = assistanceBadgeTestId?.slice(
            `${workbenchSelectors.partnerNeedsAssistancePrefix}-`.length
          )
          if (!assistancePartnerId) throw new Error('question partner assistance badge is missing')
          const questions = required.interaction.questions
          if (questions.length < 1 || questions.length > 3) {
            throw new Error(`expected one to three questions, received ${questions.length}`)
          }
          if (
            questions.some(
              (question) =>
                (question.options?.length ?? 0) === 1 || (question.options?.length ?? 0) > 4
            )
          ) {
            throw new Error('expected absent options or two to four options')
          }
          if (
            !questions.some((question) => !question.options?.length) ||
            !questions.some((question) => question.multiSelect && question.options?.length) ||
            !questions.some((question) => !question.multiSelect && question.options?.length)
          )
            throw new Error(
              'requested single, multiple and text question coverage was not produced'
            )
          if (await card.getByText('其他，请填写').count())
            throw new Error('legacy other option is still present')
          const initialCardText = ((await card.textContent()) || '').trim()
          const titleText = (
            (await card
              .getByTestId(`${workbenchSelectors.humanQuestionCard}-title`)
              .textContent()) || ''
          ).trim()
          const selectionTypeTagCount = await card.getByText(/^(单选|可多选)$/).count()
          const position = card.getByTestId(`${workbenchSelectors.humanQuestionCard}-position`)
          const positionText = (await position.count())
            ? ((await position.textContent()) || '').trim()
            : ''
          const positionBox = (await position.count()) ? await position.boundingBox() : null
          const previousBox =
            questions.length > 1
              ? await card.getByTestId(workbenchSelectors.humanQuestionPrev).boundingBox()
              : null
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
              const input = card.getByTestId(`workbench-human-question-user-text-${question.id}`)
              const options = question.options ?? []
              if (
                !(await input.evaluate((element) => {
                  const style = getComputedStyle(element)
                  return (
                    element.classList.contains('ant-input') &&
                    parseFloat(style.paddingLeft) >= 10 &&
                    parseFloat(style.paddingLeft) <= 12 &&
                    parseFloat(style.paddingTop) > 0 &&
                    parseFloat(style.paddingTop) <= 6
                  )
                }))
              )
                throw new Error('question input does not use standard Ant Design spacing')
              if (options.length && (await input.boundingBox())!.height > 38)
                throw new Error('single line question input is taller than a standard Input')
              if (options.length) {
                const readInputFrame = () =>
                  input.evaluate((element) => {
                    const style = getComputedStyle(element)
                    return { border: style.borderTopColor, shadow: style.boxShadow }
                  })
                const hiddenFrame = { border: 'rgba(0, 0, 0, 0)', shadow: 'none' }
                await card.getByTestId(`${workbenchSelectors.humanQuestionCard}-title`).click()
                await expect.poll(readInputFrame).toEqual(hiddenFrame)
                await input.hover()
                await expect.poll(readInputFrame).toEqual(hiddenFrame)
                await input.click()
                await expect
                  .poll(async () => (await readInputFrame()).border)
                  .not.toBe(hiddenFrame.border)
                await expect
                  .poll(async () => (await readInputFrame()).shadow)
                  .not.toBe(hiddenFrame.shadow)
                await card.getByTestId(`${workbenchSelectors.humanQuestionCard}-title`).click()
                await expect.poll(readInputFrame).toEqual(hiddenFrame)
                const option = card.getByTestId(
                  `workbench-human-question-option-${question.id}-${options[0].id}`
                )
                await option.click()
                if (!question.multiSelect && (await option.locator('svg').count()))
                  throw new Error('single choice still contains a redundant trailing icon')
                if ((await option.getAttribute('aria-pressed')) !== 'true')
                  throw new Error('selection did not remain on current question')
                await option.click()
                if ((await option.getAttribute('aria-pressed')) !== 'false')
                  throw new Error('selection cannot be cleared')
                await option.click()
                if (question.multiSelect && options[1]) {
                  await card
                    .getByTestId(`workbench-human-question-option-${question.id}-${options[1].id}`)
                    .click()
                  if ((await card.locator('[aria-pressed="true"]').count()) !== 2)
                    throw new Error('multi selection was not retained')
                }
              }
              await input.fill(
                index === 0
                  ? '使用深绿色和白色，整体保持克制'
                  : options.length
                    ? '突出简洁清晰'
                    : '春日阅读活动'
              )
              if (!options.length) {
                const textBeforeEnter = await input.inputValue()
                await input.press('End')
                await input.press('Shift+Enter')
                if ((await input.inputValue()) !== `${textBeforeEnter}\n`)
                  throw new Error('Shift+Enter did not insert a newline')
              }
              if (index === 0 && options.length) {
                const option = card.getByTestId(
                  `workbench-human-question-option-${question.id}-${options[0].id}`
                )
                await option.press('Tab')
                await page.keyboard.press('Shift+Tab')
                if (
                  (await option.evaluate((element) => getComputedStyle(element).outlineStyle)) !==
                  'none'
                )
                  throw new Error('question choice shows an outline during keyboard confirmation')
              }
              await runtime.captureScreenshot({
                name: `question-${index + 1}`,
                message: '提问卡片与逐题回答草稿'
              })
              if (index < currentQuestions.length - 1) {
                if (index === 0 && options.length) {
                  await card
                    .getByTestId(`workbench-human-question-option-${question.id}-${options[0].id}`)
                    .press('Enter')
                } else {
                  await input.press('Enter')
                }
                await card
                  .getByTestId(
                    `workbench-human-question-user-text-${currentQuestions[index + 1].id}`
                  )
                  .waitFor({ state: 'visible', timeout: 5_000 })
                await card.getByTestId(workbenchSelectors.humanQuestionPrev).click()
                if (!(await input.inputValue()).trim())
                  throw new Error('navigation lost answer draft')
                if (
                  options.length &&
                  (await card
                    .getByTestId(`workbench-human-question-option-${question.id}-${options[0].id}`)
                    .getAttribute('aria-pressed')) !== 'true'
                )
                  throw new Error('Enter toggled the selected option instead of advancing')
                await card.getByTestId(workbenchSelectors.humanQuestionSubmit).click()
              }
            }
            await card
              .getByTestId(`workbench-human-question-user-text-${currentQuestions.at(-1)!.id}`)
              .press('Enter')
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

          const firstInput = card.getByTestId(
            `workbench-human-question-user-text-${questions[0].id}`
          )
          await firstInput.fill('切换后不应恢复的草稿')
          await createPartnerThroughWorkbenchUi(page, '切换验证伙伴')
          await card.waitFor({ state: 'hidden', timeout: 30_000 })
          const partnerAssistanceBadge = getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerNeedsAssistancePrefix}-${assistancePartnerId}`
          )
          await partnerAssistanceBadge.waitFor({ state: 'visible', timeout: 30_000 })
          const assistancePersistedAfterPartnerSwitch = await partnerAssistanceBadge.isVisible()
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${assistancePartnerId}`
          ).click()
          await card.waitFor({ state: 'visible', timeout: 30_000 })
          await partnerAssistanceBadge.waitFor({ state: 'visible', timeout: 30_000 })
          const questionRestoredAfterPartnerSwitch = await card.isVisible()
          if (await firstInput.inputValue())
            throw new Error('partner switch restored an unsent draft')
          await firstInput.fill('刷新后不应恢复的草稿')

          await page.reload()
          await card.waitFor({ state: 'visible', timeout: 30_000 })
          await partnerAssistanceBadge.waitFor({ state: 'visible', timeout: 30_000 })
          const assistanceRestoredAfterReload = await partnerAssistanceBadge.isVisible()
          if (await firstInput.inputValue()) throw new Error('reload restored an unsent draft')
          if (!(await card.getByTestId(workbenchSelectors.humanQuestionSubmit).isDisabled()))
            throw new Error('empty answer permits advancement')
          await firstInput.press('Enter')
          if (!(await firstInput.isVisible()) || (await firstInput.inputValue()))
            throw new Error('Enter advanced an empty question or inserted a newline')
          await answerQuestionCard(questions)

          const seenInteractionIds = new Set([required.interactionId])
          const completionDeadline = Date.now() + WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
          for (;;) {
            const events = (await collectWorkbenchAiRunEvents(runtime)).filter(
              (event) => event.runId === required.runId
            )
            const nextRequired = events.find(
              (event): event is QuestionRequiredEvent =>
                isQuestionRequired(event) && !seenInteractionIds.has(event.interactionId)
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

          await waitForLatestAssistantProcess(page)
          const processToggle = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantProcessTogglePrefix
          ).last()
          if ((await processToggle.getAttribute('aria-expanded')) === 'false') {
            await processToggle.click()
          }
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
            inputCountDuringQuestion,
            composerSendControlCountDuringQuestion,
            assistancePersistedAfterPartnerSwitch,
            questionRestoredAfterPartnerSwitch,
            assistanceRestoredAfterReload,
            assistanceClearedAfterCompletion,
            processText,
            events,
            questionIds: questions.map((question) => question.id)
          }
        },
        assert: async (result, runtime) => {
          if (result.questionCount < 1 || result.questionCount > 3) {
            throw new Error(`expected one to three questions, received ${result.questionCount}`)
          }
          await runtime.assertThat(
            result.assistanceRestoredAfterReload &&
              result.assistancePersistedAfterPartnerSwitch &&
              result.questionRestoredAfterPartnerSwitch &&
              result.assistanceClearedAfterCompletion &&
              result.initialCardText.includes('问题') &&
              result.titleText === result.firstQuestionText &&
              (result.questionCount === 1
                ? result.positionText === '' && result.positionBox === null
                : result.positionText === `1 / ${result.questionCount}` &&
                  result.positionBox !== null &&
                  result.previousBox !== null &&
                  result.positionBox.x + result.positionBox.width <= result.previousBox.x) &&
              ['或直接输入回复…', '回复…'].includes(result.guidePlaceholder) &&
              result.stopLabel.includes('停止本次运行') &&
              result.inputCountDuringQuestion === 0 &&
              result.composerSendControlCountDuringQuestion === 0,
            {
              name: 'human-question-card-layout-and-composer-controls',
              message:
                '提问时不显示普通输入框或 Composer 发送按钮，交互卡保留其停止按钮；卡片标题、导航和回答区域正确。',
              data: {
                assistanceRestoredAfterReload: result.assistanceRestoredAfterReload,
                assistancePersistedAfterPartnerSwitch: result.assistancePersistedAfterPartnerSwitch,
                questionRestoredAfterPartnerSwitch: result.questionRestoredAfterPartnerSwitch,
                assistanceClearedAfterCompletion: result.assistanceClearedAfterCompletion,
                initialCardText: result.initialCardText,
                titleText: result.titleText,
                firstQuestionText: result.firstQuestionText,
                selectionTypeTagCount: result.selectionTypeTagCount,
                positionText: result.positionText,
                positionBox: result.positionBox,
                previousBox: result.previousBox,
                guidePlaceholder: result.guidePlaceholder,
                stopLabel: result.stopLabel,
                inputCountDuringQuestion: result.inputCountDuringQuestion,
                composerSendControlCountDuringQuestion:
                  result.composerSendControlCountDuringQuestion
              }
            }
          )
          const resolvedEvent = result.resolved
          if (resolvedEvent.type !== 'human_interaction_resolved') {
            throw new Error('question resolved event was not recorded')
          }
          const answers = resolvedEvent.result.answers
          if (!Array.isArray(answers) || answers.length !== result.questionCount) {
            throw new Error('the submitted result did not contain one answer for every question')
          }
          const questionIds = new Set(result.questionIds)
          const answerIds = new Set(
            answers.map((answer) => {
              if (
                !answer ||
                typeof answer !== 'object' ||
                Array.isArray(answer) ||
                typeof answer.questionId !== 'string'
              )
                throw new Error('submitted answer has no question id')
              return answer.questionId
            })
          )
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
