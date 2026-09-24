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
  isWindows ? `New-Item -ItemType Directory -LiteralPath "${directory}"` : `mkdir "${directory}"`

const complete = buildCompleteTaskDecision({
  summary: '终端审核流程结束。',
  deliveryMarkdown: '终端审核流程结束。'
})

describe('ai tool hand terminal review', () => {
  it('runs a file query in review mode without AI or human approval', async () => {
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
              record.entry.eventType === 'terminal_review_resolved'
          ).length,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.reviewCount === 0 &&
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

  it('automatically executes an explicitly authorized file creation', async () => {
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
        const reviewRequests: string[] = []
        const reviewSystems: string[] = []
        const runner = createHumanTestRunner(runtime, {
          approvalPolicy: 'deny-all',
          structuredOutputScript: {
            'human.terminal_review': [
              ({ system, user }) => {
                reviewSystems.push(system)
                reviewRequests.push(user)
                return { invalid: true }
              },
              ({ system, user }) => {
                reviewSystems.push(system)
                reviewRequests.push(user)
                return {
                  decisions: collectTerminalReviewCommandIds(user).map((commandId) => ({
                    commandId,
                    decision: 'auto_approve'
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
                        args: { command, commandExplanation: '创建用户指定目录' }
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
        const reviewDecisions = records.flatMap((record) => {
          const { entry } = record
          return entry.kind === 'annotation' && entry.eventType === 'terminal_review_resolved'
            ? entry.payload.decisions
            : []
        })
        return {
          output,
          command,
          exists: await fs
            .stat(target)
            .then(() => true)
            .catch(() => false),
          reviewRequests,
          reviewSystems,
          reviewDecisions,
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
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.exists &&
            result.reviewRequests.length === 2 &&
            result.reviewRequests[0].includes('请创建 ai-approved-dir 目录') &&
            result.reviewRequests[0].includes('命令 ID：') &&
            result.reviewRequests[0].includes('用途说明：') &&
            result.reviewRequests[0].includes(result.command) &&
            result.reviewRequests[0].includes('执行目录：') &&
            (result.reviewRequests[0].includes('平台：Windows') ||
              result.reviewRequests[0].includes('平台：macOS')) &&
            !result.reviewRequests[0].startsWith('{') &&
            !result.reviewRequests[0].includes('<user_request>') &&
            !result.reviewRequests[0].includes('macOS / zsh') &&
            !result.reviewRequests[0].includes('Windows / PowerShell') &&
            !result.reviewRequests[0].includes('基础命中：') &&
            result.reviewRequests[1].includes('上一次响应未通过 JSON') &&
            result.reviewSystems.length === 2 &&
            result.reviewSystems[0].includes('只返回合法 JSON') &&
            result.reviewSystems[0].includes('"decisions"') &&
            result.reviewSystems[0].includes('"commandId"') &&
            result.reviewDecisions.length === 1 &&
            result.reviewDecisions[0].decision === 'auto_approve' &&
            result.reviews.length === 1 &&
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

  it('escalates a failed AI review to human approval before execution', async () => {
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
        return {
          output,
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

  it('escalates an incomplete AI review to human approval', async () => {
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
        const fallbackCodes = records.flatMap((record) => {
          const { entry } = record
          return entry.kind === 'annotation' && entry.eventType === 'terminal_review_resolved'
            ? [entry.payload.fallbackCode]
            : []
        })
        return {
          output,
          reviewCallCount,
          fallbackCodes,
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
            result.fallbackCodes.length === 1 &&
            result.fallbackCodes[0] === 'invalid_output' &&
            !result.exists &&
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

  it('does not review a query or a full-access write', async () => {
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
