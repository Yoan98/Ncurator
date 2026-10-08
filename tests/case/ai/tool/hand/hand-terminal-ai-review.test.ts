import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  collectTerminalReviewCommandIds,
  filterAiRunEventsByType
} from '../../human/testUtils'

const isWindows = process.platform === 'win32'

const createDirectoryCommand = (directory: string): string =>
  isWindows ? `New-Item -ItemType Directory -Path "${directory}"` : `mkdir "${directory}"`

const complete = buildCompleteTaskDecision({
  summary: '终端审核流程结束。',
  deliveryMarkdown: '终端审核流程结束。'
})

describe('ai tool hand terminal review', () => {
  it('hand-terminal-ai-review-query', async () => {
    await runBackendCase({
      caseId: 'hand-terminal-ai-review-query',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '审核模式下查询本地目录和搜索文本直接执行。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const query = isWindows
          ? 'Get-ChildItem -Name 2>$null | Select-Object -First 5'
          : 'ls -la 2>/dev/null | head -5'
        const runner = createHumanTestRunner(runtime, {
          approvalPolicy: 'deny-all',
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: { next: '查看文件' },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'terminal_run',
                        args: { command: query, commandExplanation: '查看文件' }
                      }
                    ]
                  }
                }
              },
              { output: complete }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '看看本地有什么文件。'
        })
        const records = await runner.ctx.loadMessageLog()
        return {
          output,
          reviewCount: records.filter(
            (record) =>
              record.entry.kind === 'annotation' &&
              (record.entry.eventType === 'terminal_review_started' ||
                record.entry.eventType === 'terminal_review_resolved')
          ).length,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.reviewCount === 0 &&
            filterAiRunEventsByType(result.events, 'terminal_review_started').length === 0 &&
            filterAiRunEventsByType(result.events, 'terminal_review_resolved').length === 0 &&
            filterAiRunEventsByType(result.events, 'approval_batch_required').length === 0 &&
            filterAiRunEventsByType(result.events, 'terminal_step_started').length === 1,
          {
            name: 'terminal-query-bypasses-review',
            message: '普通目录查询不应触发 AI 或人工审核。',
            data: result
          }
        )
      }
    })
  })

  it('hand-terminal-ai-review-auto-approve', async () => {
    await runBackendCase({
      caseId: 'hand-terminal-ai-review-auto-approve',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '用户明确授权的写入经 AI 审核后直接执行，不产生人工审批。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const target = path.join(runtime.workspaceRoot, 'ai-approved-dir')
        const command = createDirectoryCommand(target)
        const commandExplanation = '仅供人工审批展示的目录创建说明'
        const reviewRequests: string[] = []
        const runner = createHumanTestRunner(runtime, {
          approvalPolicy: 'deny-all',
          structuredOutputScript: {
            'human.terminal_review': [
              ({ user }) => {
                reviewRequests.push(user)
                return { invalid: true }
              },
              ({ user }) => {
                reviewRequests.push(user)
                return {
                  decisions: collectTerminalReviewCommandIds(user).map((commandId) => ({
                    commandId,
                    decision: 'auto_approve',
                    reason: '用户授权创建指定目录，操作范围清楚。'
                  }))
                }
              }
            ],
            'human.brain': [
              {
                output: {
                  thought: { next: '创建用户指定目录' },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'terminal_run',
                        args: { command, commandExplanation }
                      }
                    ]
                  }
                }
              },
              { output: complete }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请创建 ai-approved-dir 目录。'
        })
        const records = await runner.ctx.loadMessageLog()
        const reviewStarted = records.filter(
          (record) =>
            record.entry.kind === 'annotation' &&
            record.entry.eventType === 'terminal_review_started'
        )
        const reviewResolved = records.filter(
          (record) =>
            record.entry.kind === 'annotation' &&
            record.entry.eventType === 'terminal_review_resolved'
        )
        const reviewDecisions = records.flatMap((record) => {
          const { entry } = record
          return entry.kind === 'annotation' && entry.eventType === 'terminal_review_resolved'
            ? entry.payload.decisions
            : []
        })
        return {
          output,
          command,
          commandExplanation,
          explanationRecorded: records.some(
            ({ entry }) =>
              entry.kind === 'assistant' &&
              entry.toolCalls.some((call) => call.args.commandExplanation === commandExplanation)
          ),
          exists: await fs
            .stat(target)
            .then(() => true)
            .catch(() => false),
          reviewRequests,
          reviewDecisions,
          reviewStarted,
          reviewResolved,
          reviews: records
            .map((record) => record.entry)
            .filter(
              (entry) =>
                entry.kind === 'annotation' && entry.eventType === 'terminal_review_resolved'
            ),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const reviewStartedEvents = filterAiRunEventsByType(
          result.events,
          'terminal_review_started'
        )
        const reviewResolvedEvents = filterAiRunEventsByType(
          result.events,
          'terminal_review_resolved'
        )
        const toolStartedEvents = filterAiRunEventsByType(result.events, 'tool_call_started')
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.exists &&
            result.reviewRequests.length === 2 &&
            result.reviewRequests[0].includes('请创建 ai-approved-dir 目录') &&
            result.reviewRequests[0].includes('命令 ID：') &&
            result.reviewRequests.every(
              (request) => !request.includes(result.commandExplanation)
            ) &&
            result.explanationRecorded &&
            result.reviewRequests[0].includes(result.command) &&
            result.reviewRequests[0].includes(`用户默认工作区目录：\n- ${runtime.workspaceRoot}`) &&
            result.reviewRequests[0].includes('终端默认启动目录：') &&
            !result.reviewRequests[0].includes('执行目录：') &&
            (result.reviewRequests[0].includes('平台：Windows') ||
              result.reviewRequests[0].includes('平台：macOS')) &&
            !result.reviewRequests[0].startsWith('{') &&
            !result.reviewRequests[0].includes('<user_request>') &&
            !result.reviewRequests[0].includes('macOS / zsh') &&
            !result.reviewRequests[0].includes('Windows / PowerShell') &&
            !result.reviewRequests[0].includes('基础命中：') &&
            result.reviewRequests[1].includes('上一次响应未通过输出格式或字段校验') &&
            result.reviewDecisions.length === 1 &&
            result.reviewDecisions[0].decision === 'auto_approve' &&
            result.reviewDecisions[0].reason === '用户授权创建指定目录，操作范围清楚。' &&
            result.reviews.length === 1 &&
            result.reviewStarted.length === 1 &&
            result.reviewResolved.length === 1 &&
            result.reviewStarted[0].seq < result.reviewResolved[0].seq &&
            result.reviewStarted[0].entry.kind === 'annotation' &&
            result.reviewStarted[0].entry.eventType === 'terminal_review_started' &&
            result.reviewResolved[0].entry.kind === 'annotation' &&
            result.reviewResolved[0].entry.eventType === 'terminal_review_resolved' &&
            result.reviewStarted[0].entry.payload.commandIds.join(',') ===
              result.reviewResolved[0].entry.payload.decisions
                .map((item) => item.commandId)
                .join(',') &&
            reviewStartedEvents.length === 1 &&
            reviewResolvedEvents.length === 1 &&
            reviewStartedEvents[0].reviewId === reviewResolvedEvents[0].reviewId &&
            reviewStartedEvents[0].commands[0]?.commandId === toolStartedEvents[0]?.toolCallId &&
            filterAiRunEventsByType(result.events, 'approval_batch_required').length === 0 &&
            filterAiRunEventsByType(result.events, 'terminal_step_started').length === 1,
          {
            name: 'terminal-ai-review-auto-approves',
            message: 'AI 明确通过后应直接执行并记录结论。',
            data: result
          }
        )
      }
    })
  })

  it('hand-terminal-ai-review-failure', async () => {
    await runBackendCase({
      caseId: 'hand-terminal-ai-review-failure',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: 'AI 审核异常转人工，人工拒绝前命令零执行。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const target = path.join(runtime.workspaceRoot, 'review-failure-dir')
        const runner = createHumanTestRunner(runtime, {
          approvalPolicy: 'deny-all',
          structuredOutputScript: {
            'human.terminal_review': [{ error: 'review model unavailable' }],
            'human.brain': [
              {
                output: {
                  thought: { next: '尝试创建目录' },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'terminal_run',
                        args: {
                          command: createDirectoryCommand(target),
                          commandExplanation: '创建目录'
                        }
                      }
                    ]
                  }
                }
              },
              { output: complete }
            ]
          }
        })
        const output = await runner.run({ taskId: runtime.taskId, userInput: '请处理目录。' })
        const records = await runner.ctx.loadMessageLog()
        const reviewDecisions = records.flatMap((record) => {
          const { entry } = record
          return entry.kind === 'annotation' && entry.eventType === 'terminal_review_resolved'
            ? entry.payload.decisions
            : []
        })
        return {
          output,
          reviewDecisions,
          exists: await fs
            .stat(target)
            .then(() => true)
            .catch(() => false),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            !result.exists &&
            result.reviewDecisions.length === 1 &&
            result.reviewDecisions[0].reason.includes('审核未能提供有效判定') &&
            filterAiRunEventsByType(result.events, 'terminal_review_started').length === 1 &&
            filterAiRunEventsByType(result.events, 'terminal_review_resolved').length === 1 &&
            filterAiRunEventsByType(result.events, 'terminal_review_started')[0].commands[0]
              ?.commandId ===
              filterAiRunEventsByType(result.events, 'terminal_review_resolved')[0].decisions[0]
                ?.commandId &&
            filterAiRunEventsByType(result.events, 'approval_batch_required').length === 1 &&
            filterAiRunEventsByType(result.events, 'terminal_step_started').length === 0,
          {
            name: 'terminal-ai-review-failure-escalates',
            message: '审核异常必须人工确认，拒绝后零副作用。',
            data: result
          }
        )
      }
    })
  })

  it('hand-terminal-ai-review-incomplete', async () => {
    await runBackendCase({
      caseId: 'hand-terminal-ai-review-incomplete',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: 'AI 审核遗漏命令时转人工，人工拒绝前不执行。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const target = path.join(runtime.workspaceRoot, 'incomplete-review-dir')
        let reviewCallCount = 0
        const runner = createHumanTestRunner(runtime, {
          approvalPolicy: 'deny-all',
          structuredOutputScript: {
            'human.terminal_review': Array.from({ length: 4 }, () => () => {
              reviewCallCount += 1
              return { decisions: [] }
            }),
            'human.brain': [
              {
                output: {
                  thought: { next: '创建目录' },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'terminal_run',
                        args: {
                          command: createDirectoryCommand(target),
                          commandExplanation: '创建目录'
                        }
                      }
                    ]
                  }
                }
              },
              { output: complete }
            ]
          }
        })
        const output = await runner.run({ taskId: runtime.taskId, userInput: '请处理目录。' })
        const records = await runner.ctx.loadMessageLog()
        const reviewDecisions = records.flatMap((record) => {
          const { entry } = record
          return entry.kind === 'annotation' && entry.eventType === 'terminal_review_resolved'
            ? entry.payload.decisions
            : []
        })
        return {
          output,
          reviewCallCount,
          reviewDecisions,
          exists: await fs
            .stat(target)
            .then(() => true)
            .catch(() => false),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.reviewCallCount === 4 &&
            !result.exists &&
            result.reviewDecisions.length === 1 &&
            result.reviewDecisions[0].reason.includes('审核未能提供有效判定') &&
            filterAiRunEventsByType(result.events, 'terminal_review_started').length === 1 &&
            filterAiRunEventsByType(result.events, 'terminal_review_resolved').length === 1 &&
            filterAiRunEventsByType(result.events, 'terminal_review_started')[0].commands[0]
              ?.commandId ===
              filterAiRunEventsByType(result.events, 'terminal_review_resolved')[0].decisions[0]
                ?.commandId &&
            filterAiRunEventsByType(result.events, 'approval_batch_required').length === 1 &&
            filterAiRunEventsByType(result.events, 'terminal_step_started').length === 0,
          {
            name: 'terminal-ai-review-incomplete-escalates',
            message: 'AI 审核遗漏命令时必须人工确认，拒绝后零副作用。',
            data: result
          }
        )
      }
    })
  })

  it('hand-terminal-ai-review-bypass', async () => {
    await runBackendCase({
      caseId: 'hand-terminal-ai-review-bypass',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '查询直通，完全访问写入跳过 AI 与人工审核。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const target = path.join(runtime.workspaceRoot, 'full-access-dir')
        const query = isWindows ? 'Get-ChildItem -Name' : 'ls -la'
        const runner = createHumanTestRunner(runtime, {
          executionPermission: 'full_access',
          approvalPolicy: 'deny-all',
          structuredOutputScript: {
            'human.brain': [
              {
                output: {
                  thought: { next: '查询目录' },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'terminal_run',
                        args: { command: query, commandExplanation: '查看目录' }
                      }
                    ]
                  }
                }
              },
              {
                output: {
                  thought: { next: '创建目录' },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'terminal_run',
                        args: {
                          command: createDirectoryCommand(target),
                          commandExplanation: '创建目录'
                        }
                      }
                    ]
                  }
                }
              },
              { output: complete }
            ]
          }
        })
        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '查看目录并创建 full-access-dir。'
        })
        const records = await runner.ctx.loadMessageLog()
        return {
          output,
          exists: await fs
            .stat(target)
            .then(() => true)
            .catch(() => false),
          reviewCount: records.filter(
            (record) =>
              record.entry.kind === 'annotation' &&
              record.entry.eventType === 'terminal_review_resolved'
          ).length,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.exists &&
            result.reviewCount === 0 &&
            filterAiRunEventsByType(result.events, 'terminal_review_started').length === 0 &&
            filterAiRunEventsByType(result.events, 'terminal_review_resolved').length === 0 &&
            filterAiRunEventsByType(result.events, 'approval_batch_required').length === 0 &&
            filterAiRunEventsByType(result.events, 'terminal_step_started').length === 2,
          {
            name: 'terminal-full-access-skips-review',
            message: '完全访问不进入 AI 或人工审核。',
            data: result
          }
        )
      }
    })
  })
})
