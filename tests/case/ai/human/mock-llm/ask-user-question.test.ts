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
      options: [
        { id: 'blue', label: '蓝色', recommended: true },
        { id: 'green', label: '绿色', description: '更偏自然和稳定' }
      ],
      multiSelect: false
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
              result: { answers: Array<{ id: string; selected: string[]; custom?: string }> }
            }) => void)
          | undefined
        const questionPending = new Promise<{
          accepted: true
          result: { answers: Array<{ id: string; selected: string[]; custom?: string }> }
        }>((resolve) => {
          resolveQuestion = resolve
        })
        const runner = createHumanTestRunner(runtime, {
          questionResolver: async () => await questionPending,
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: { next: '主色会影响最终产物，但用户没有说明，先确认。' },
                  toolCalls: [{ name: 'ask_user_question', args: questionArgs }]
                }
              },
              ({ user }) => {
                if (!user.includes('custom=\"蓝绿色\"')) {
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
        await waitFor(() => filterAiRunEventsByType(runtime.eventCollector.snapshot(), 'human_interaction_required').length === 1)
        const beforeAnswer = await fs.readFile(filePath, 'utf8')
        runtime.assertThat(beforeAnswer === '主色：待定\n', {
          name: 'question-waits-before-side-effect',
          message: '用户回答前不能执行文件写入。'
        })

        resolveQuestion?.({
          accepted: true,
          result: { answers: [{ id: 'accent', selected: [], custom: '蓝绿色' }] }
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
            result.content === '主色：蓝绿色\n' &&
            toolResults.some((event) => event.toolName === 'text_file_edit') &&
            questionEntry?.entry.kind === 'tool' &&
            questionEntry.entry.ok === true &&
            questionEntry.entry.content.includes('custom="蓝绿色"'),
          {
            name: 'question-answer-resumes-production-graph',
            message: '回答应写入结构化 tool result，恢复 graph，并影响真实文件产物。',
            data: { required, resolved, toolResults, content: result.content }
          }
        )
      }
    })
  })

  it('human-ask-user-question-rejects-mixed-tools', async () => {
    await runBackendCase({
      caseId: 'human-ask-user-question-rejects-mixed-tools',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证提问不能和副作用工具出现在同一轮。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const filePath = path.join(runtime.workspaceRoot, 'brief.md')
        await fs.writeFile(filePath, '主色：待定\n', 'utf8')
        const runner = createHumanTestRunner(runtime, {
          questionResolver: async () => ({
            accepted: true as const,
            result: { answers: [{ id: 'accent', selected: ['blue'] }] }
          }),
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: { next: '不应混合调用。' },
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
              }
            ]
          }
        })
        let error = ''
        try {
          await runner.run({ taskId: runtime.taskId, userInput: '确认后修改 brief。' })
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause)
        }
        return { error, content: await fs.readFile(filePath, 'utf8'), events: runtime.eventCollector.snapshot() }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.error === '运行失败，请重试' && result.content === '主色：待定\n' &&
            filterAiRunEventsByType(result.events, 'human_interaction_required').length === 0,
          {
            name: 'question-cannot-mix-with-side-effects',
            message: '提问与写工具混合时应拒绝整轮，且不能产生写入。',
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
