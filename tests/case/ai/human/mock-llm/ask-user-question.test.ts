import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildToolDecision, filterAiRunEventsByType } from '../testUtils'

const questionArgs = {
  questions: [
    {
      id: 'accent',
      question: '封面强调哪种主色？',
      options: [{ id: 'blue', label: '蓝色', recommended: true }],
      multiSelect: false
    }
  ]
}

const multiQuestionArgs = {
  questions: [
    {
      id: 'accent',
      question: '封面强调哪种主色？',
      options: [
        { id: 'blue', label: '蓝色', recommended: true },
        { id: 'green', label: '绿色' }
      ]
    },
    {
      id: 'scope',
      question: '内容覆盖哪些来源？',
      options: [
        { id: 'local', label: '本地资料' },
        { id: 'web', label: '网页资料' }
      ],
      multiSelect: true
    },
    {
      id: 'format',
      question: '请说明最终交付形式'
    }
  ]
}

const followUpQuestionArgs = {
  questions: [
    {
      id: 'density',
      question: '内容密度如何安排？',
      options: [
        { id: 'compact', label: '精简' },
        { id: 'detailed', label: '详细' }
      ]
    }
  ]
}

const waitFor = async (predicate: () => boolean, timeoutMs = 10_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('等待测试条件超时')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('ai human question backend', () => {
  it('human-ask-user-question', async () => {
    await runBackendCase({
      caseId: 'human-ask-user-question',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 AI 遇到歧义时暂停询问，回答后才继续真实文件操作。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const filePath = path.join(runtime.workspaceRoot, 'brief.md')
        await fs.writeFile(filePath, '主色：待定\n', 'utf8')

        let resolveQuestion:
          | ((value: {
              accepted: true
              result: {
                answers: Array<{
                  questionId: string
                  selectedOptionIds: string[]
                  userText?: string
                }>
              }
            }) => void)
          | undefined
        const questionPending = new Promise<{
          accepted: true
          result: {
            answers: Array<{ questionId: string; selectedOptionIds: string[]; userText?: string }>
          }
        }>((resolve) => {
          resolveQuestion = resolve
        })
        const runner = createHumanTestRunner(runtime, {
          questionResolver: async () => {
            await questionPending
            return {
              accepted: true as const,
              result: {
                answers: [
                  { questionId: 'accent', selectedOptionIds: [], userText: '蓝绿色' },
                  {
                    questionId: 'scope',
                    selectedOptionIds: ['local'],
                    userText: '不要引用外部网页'
                  },
                  { questionId: 'format', selectedOptionIds: [], userText: '简要说明' }
                ]
              }
            }
          },
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: { next: '主色会影响最终产物，但用户没有说明，先确认。' },
                  toolCalls: [{ name: 'ask_user_question', args: multiQuestionArgs }]
                }
              },
              ({ user }) => {
                if (
                  !user.includes('userText="蓝绿色"') ||
                  !user.includes('selectedOptionIds=["local"]') ||
                  !user.includes('userText="简要说明"')
                ) {
                  throw new Error('提问结果没有回到下一轮模型上下文')
                }
                return buildToolDecision({
                  toolName: 'text_file_edit',
                  args: {
                    sourcePath: filePath,
                    action: 'edit',
                    edits: [{ oldText: '主色：待定', newText: '主色：蓝绿色' }]
                  },
                  summary: '按用户确认的颜色更新产物'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '已完成。',
                  deliveryMarkdown: '已按确认的主色更新。'
                })
              }
            ]
          }
        })

        const runPromise = runner.run({
          taskId: runtime.taskId,
          userInput: '完善 brief.md 的封面信息。'
        })
        await waitFor(
          () =>
            filterAiRunEventsByType(runtime.eventCollector.snapshot(), 'human_interaction_required')
              .length === 1
        )
        const beforeAnswer = await fs.readFile(filePath, 'utf8')
        runtime.assertThat(beforeAnswer === '主色：待定\n', {
          name: 'question-waits-before-side-effect',
          message: '用户回答前不能执行文件写入。'
        })

        resolveQuestion?.({
          accepted: true,
          result: {
            answers: [
              { questionId: 'accent', selectedOptionIds: [], userText: '蓝绿色' },
              { questionId: 'scope', selectedOptionIds: ['local'], userText: '不要引用外部网页' },
              { questionId: 'format', selectedOptionIds: [], userText: '简要说明' }
            ]
          }
        })
        const output = await runPromise
        return {
          output,
          content: await fs.readFile(filePath, 'utf8'),
          events: runtime.eventCollector.snapshot(),
          messageLog: await runner.ctx.loadMessageLog()
        }
      },
      assert: async (result, runtime) => {
        const required = filterAiRunEventsByType(result.events, 'human_interaction_required')
        const resolved = filterAiRunEventsByType(result.events, 'human_interaction_resolved')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const questionEntry = result.messageLog.find(
          (record) => record.entry.kind === 'tool' && record.entry.toolName === 'ask_user_question'
        )
        runtime.assertThat(
          result.output.status === 'completed' &&
            required.length === 1 &&
            resolved.length === 1 &&
            Array.isArray(resolved[0]?.result.answers) &&
            resolved[0].result.answers.length === 3 &&
            result.content === '主色：蓝绿色\n' &&
            toolResults.some((event) => event.toolName === 'text_file_edit') &&
            questionEntry?.entry.kind === 'tool' &&
            questionEntry.entry.ok === true &&
            questionEntry.entry.content.includes('userText="蓝绿色"') &&
            questionEntry.entry.content.includes('selectedOptionIds=["local"]') &&
            !questionEntry.entry.content.includes('本地资料'),
          {
            name: 'question-answer-resumes-production-graph',
            message: '回答应写入结构化 tool result，恢复 graph，并影响真实文件产物。',
            data: { required, resolved, toolResults, content: result.content }
          }
        )
      }
    })
  })

  it('human-ask-user-question-runs-mixed-tools-in-order', async () => {
    await runBackendCase({
      caseId: 'human-ask-user-question-runs-mixed-tools-in-order',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证提问与副作用工具按模型返回顺序执行。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const filePath = path.join(runtime.workspaceRoot, 'brief.md')
        await fs.writeFile(filePath, '主色：待定\n', 'utf8')
        let answerQuestion: (() => void) | undefined
        const questionPending = new Promise<void>((resolve) => {
          answerQuestion = resolve
        })
        const runner = createHumanTestRunner(runtime, {
          questionResolver: async () => {
            await questionPending
            return {
              accepted: true as const,
              result: { answers: [{ questionId: 'accent', selectedOptionIds: ['blue'] }] }
            }
          },
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: { next: '先确认，再按当前参数执行。' },
                  toolCalls: [
                    { name: 'ask_user_question', args: questionArgs },
                    {
                      name: 'text_file_edit',
                      args: {
                        sourcePath: filePath,
                        action: 'edit',
                        edits: [{ oldText: '主色：待定', newText: '主色：蓝色' }]
                      }
                    }
                  ]
                }
              },
              ({ user }) => {
                if (!user.includes('questionId=accent')) {
                  throw new Error('提问结果没有回到模型上下文')
                }
                return buildCompleteTaskDecision({
                  summary: '已完成。',
                  deliveryMarkdown: '已按确认内容修改。'
                })
              }
            ]
          }
        })
        const runPromise = runner.run({
          taskId: runtime.taskId,
          userInput: '确认后修改 brief。'
        })
        await waitFor(
          () =>
            filterAiRunEventsByType(runtime.eventCollector.snapshot(), 'human_interaction_required')
              .length === 1
        )
        runtime.assertThat((await fs.readFile(filePath, 'utf8')) === '主色：待定\n', {
          name: 'mixed-tools-wait-for-question-before-write',
          message: '同一轮中排在提问后的写工具不能在用户回答前执行。'
        })
        answerQuestion?.()
        const output = await runPromise
        return {
          output,
          content: await fs.readFile(filePath, 'utf8'),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.content === '主色：蓝色\n' &&
            filterAiRunEventsByType(result.events, 'human_interaction_required').length === 1 &&
            filterAiRunEventsByType(result.events, 'tool_call_result').some(
              (event) => event.toolName === 'text_file_edit'
            ),
          {
            name: 'question-and-side-effect-run-in-order',
            message: '提问回答后应继续执行同一轮剩余写工具，并正常完成。',
            data: result
          }
        )
      }
    })
  })

  it('human-ask-user-question-runs-multiple-calls-sequentially', async () => {
    await runBackendCase({
      caseId: 'human-ask-user-question-runs-multiple-calls-sequentially',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证同一模型回复中的多个提问逐张展示，全部回答后才继续模型。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const requestedQuestionIds: string[] = []
        const runner = createHumanTestRunner(runtime, {
          questionResolver: async (request) => {
            const question = request.questions[0]
            if (!question) return { accepted: false as const, error: '问题为空' }
            requestedQuestionIds.push(question.id)
            return {
              accepted: true as const,
              result: {
                answers: [
                  { questionId: question.id, selectedOptionIds: [question.options![0]!.id] }
                ]
              }
            }
          },
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: { next: '依次确认颜色和内容密度。' },
                  toolCalls: [
                    { name: 'ask_user_question', args: questionArgs },
                    { name: 'ask_user_question', args: followUpQuestionArgs }
                  ]
                }
              },
              ({ user }) => {
                if (!user.includes('questionId=accent') || !user.includes('questionId=density')) {
                  throw new Error('两个提问结果必须齐全后才能继续模型')
                }
                return buildCompleteTaskDecision({
                  summary: '已完成确认。',
                  deliveryMarkdown: '已记录两项选择。'
                })
              }
            ]
          }
        })

        const output = await runner.run({ taskId: runtime.taskId, userInput: '请确认两个设置。' })
        return {
          output,
          requestedQuestionIds,
          events: runtime.eventCollector.snapshot(),
          messageLog: await runner.ctx.loadMessageLog()
        }
      },
      assert: async (result, runtime) => {
        const required = filterAiRunEventsByType(result.events, 'human_interaction_required')
        const questionResults = result.messageLog.filter(
          (record) => record.entry.kind === 'tool' && record.entry.toolName === 'ask_user_question'
        )
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.requestedQuestionIds.join(',') === 'accent,density' &&
            required.length === 2 &&
            required[0]?.interactionId !== required[1]?.interactionId &&
            questionResults.length === 2,
          {
            name: 'multiple-question-calls-run-sequentially',
            message: '两个提问应按原顺序逐张处理，并各自写入 tool result。',
            data: result
          }
        )
      }
    })
  })

  it('human-ask-user-question-does-not-auto-answer', async () => {
    await runBackendCase({
      caseId: 'human-ask-user-question-does-not-auto-answer',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证没有 questionResolver 时提问不会被默认权限自动回答。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const runner = createHumanTestRunner(runtime, {
          approvalPolicy: 'auto-approve',
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: { next: '需要确认。' },
                  toolCalls: [{ name: 'ask_user_question', args: questionArgs }]
                }
              }
            ]
          }
        })
        let error = ''
        try {
          await runner.run({ taskId: runtime.taskId, userInput: '请处理。' })
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause)
        }
        return { error, events: runtime.eventCollector.snapshot() }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.error === '运行失败，请重试' &&
            filterAiRunEventsByType(result.events, 'human_interaction_required').length === 1 &&
            filterAiRunEventsByType(result.events, 'human_interaction_resolved').length === 0,
          {
            name: 'full-access-does-not-answer-question',
            message: '提问必须等待真实用户回答，不能沿用审批自动通过。',
            data: result
          }
        )
      }
    })
  })
})
