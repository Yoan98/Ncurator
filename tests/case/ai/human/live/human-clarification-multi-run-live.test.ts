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
          const filePath = path.join(runtime.workspaceRoot, 'clarification-brief.md')
          await fs.writeFile(filePath, '# Brief\n\n主题：待定\n', 'utf8')
          const interactionIds: string[] = []
          const questionResolver: QuestionResolver = async (request) => {
            interactionIds.push(request.interactionId)
            const first = request.questions[0]
            const selected = first?.options[0]?.id
            return {
              accepted: true as const,
              result: {
                answers: [
                  {
                    id: first?.id || 'clarification',
                    selected: selected ? [selected] : [],
                    custom: interactionIds.length === 2 ? '用深绿色和白色，整体保持克制' : undefined
                  }
                ]
              }
            }
          }

          const run = async (userInput: string) => {
            const runner = createHumanTestRunner(runtime, {
              partnerId: PARTNER_ID,
              questionResolver
            })
            return await runner.run({ taskId: `${runtime.taskId}-${interactionIds.length + 1}`, userInput })
          }

          const first = await run(
            `请根据 brief.md 完善主题并产出一个可继续编辑的方向。当前没有说明视觉风格，请先确认会影响结果的关键选择。`
          )
          const second = await run(
            `继续完善 brief.md。若需要确认，请允许我用“其他，请填写”补充具体要求；我的补充是：用深绿色和白色，整体保持克制。`
          )
          const beforeThird = interactionIds.length
          const third = await run(
            `请把 brief.md 的主题明确改为“季度客户回访”，使用 Markdown，保留现有结构，不需要再向我确认。`
          )
          const events = runtime.eventCollector.snapshot()
          const questions = filterAiRunEventsByType(events, 'human_interaction_required')
          const resolved = filterAiRunEventsByType(events, 'human_interaction_resolved')
          return {
            first,
            second,
            third,
            beforeThird,
            interactionIds,
            questions,
            resolved,
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
              result.beforeThird === result.interactionIds.length &&
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
