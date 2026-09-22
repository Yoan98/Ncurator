import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { QuestionResolver } from '../../../../harness/backend/test-types'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const PARTNER_ID = 'human-clarification-multi-run-live-partner'

describe('ai human clarification live backend', () => {
  it('human-clarification-multi-run-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-clarification-multi-run-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '同一伙伴连续三次运行，评估 AI 在歧义、自定义回答和明确任务下的提问质量。',
        fixtures: [],
        runMode: 'repeatable',
        execute: async (runtime) => {
          const filePath = path.join(runtime.workspaceRoot, 'brief.md')
          await fs.writeFile(filePath, '# Brief\n\n主题：待定\n', 'utf8')
          const interactionIds: string[] = []
          const interactionCountsByTask = new Map<string, number>()
          const questionResolver: QuestionResolver = async (request) => {
            interactionIds.push(request.interactionId)
            const count = (interactionCountsByTask.get(request.taskId) || 0) + 1
            interactionCountsByTask.set(request.taskId, count)
            if (count > 6) {
              throw new Error(`同一 run 的提问次数超过 6 次：${request.taskId}`)
            }
            const isCustomScenario = request.taskId.endsWith('-2')
            return {
              accepted: true as const,
              result: {
                answers: request.questions.map((question, index) => {
                  const custom = isCustomScenario && index === 0
                    ? '用深绿色和白色，整体保持克制'
                    : undefined
                  return {
                    id: question.id,
                    selected: custom ? [] : question.options[0] ? [question.options[0].id] : [],
                    custom
                  }
                })
              }
            }
          }

          const run = async (runNumber: number, userInput: string) => {
            const runner = createHumanTestRunner(runtime, {
              partnerId: PARTNER_ID,
              questionResolver
            })
            return await runner.run({ taskId: `${runtime.taskId}-${runNumber}`, userInput })
          }

          const first = await run(1,
            `请根据 brief.md 完善主题并产出一个可继续编辑的方向。当前没有说明视觉风格，请先确认会影响结果的关键选择。`
          )
          const second = await run(2,
            `继续完善 brief.md。若需要确认，请允许我用“其他，请填写”补充具体要求；我的补充是：用深绿色和白色，整体保持克制。`
          )
          const beforeThird = interactionIds.length
          const thirdTaskId = `${runtime.taskId}-3`
          const third = await run(3,
            `请直接把 brief.md 的“主题：待定”替换为“主题：季度客户回访”，只做这一处明确的文本修改，保留其他内容，不需要再向我确认。`
          )
          const events = runtime.eventCollector.snapshot()
          const questions = filterAiRunEventsByType(events, 'human_interaction_required')
          const resolved = filterAiRunEventsByType(events, 'human_interaction_resolved')
          const thirdQuestions = questions.filter((event) => event.taskId === thirdTaskId)
          const resolvedAnswerCounts = resolved.map((event) => {
            const answers = event.result.answers
            return Array.isArray(answers) ? answers.length : 0
          })
          const resolvedByInteractionId = new Map(
            resolved.map((event) => [event.interactionId, event])
          )
          const answerIdsMatchQuestions = questions.every((event) => {
            const interaction = event.interaction
            if (interaction.kind !== 'question') return false
            const resolution = resolvedByInteractionId.get(event.interactionId)
            const answers = resolution?.result.answers
            if (!Array.isArray(answers) || answers.length !== interaction.questions.length) return false
            const answerIds = new Set(
              answers
                .filter((answer): answer is { id: string } => Boolean(answer && typeof answer === 'object' && typeof answer.id === 'string'))
                .map((answer) => answer.id)
            )
            return answerIds.size === interaction.questions.length &&
              interaction.questions.every((question) => answerIds.has(question.id))
          })
          return {
            first,
            second,
            third,
            beforeThird,
            interactionIds,
            questions,
            resolved,
            resolvedAnswerCounts,
            answerIdsMatchQuestions,
            thirdQuestions,
            content: await fs.readFile(filePath, 'utf8')
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.first.status === 'completed' &&
              result.second.status === 'completed' &&
              result.third.status === 'completed' &&
              result.questions.length >= 1 &&
              result.resolved.length === result.questions.length &&
              result.interactionIds.length === result.questions.length &&
              result.resolvedAnswerCounts.every((count) => count > 0) &&
              result.answerIdsMatchQuestions &&
              result.thirdQuestions.length === 0 &&
              result.content.includes('季度客户回访'),
            {
              name: 'live-clarification-quality-and-multi-run-continuation',
              message: '模糊任务应先确认，自定义答案应进入后续执行，明确任务不应重复提问。',
              data: {
                questionCount: result.questions.length,
                resolvedCount: result.resolved.length,
                interactionIds: result.interactionIds,
                content: result.content
              }
            }
          )
        }
      })
    })
  })
})
