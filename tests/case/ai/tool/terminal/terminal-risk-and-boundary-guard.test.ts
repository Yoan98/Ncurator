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

describe('ai tool terminal backend', () => {
  it('terminal-risk-and-boundary-guard', async () => {
    await runBackendCase({
      caseId: 'terminal-risk-and-boundary-guard',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description:
        'Dangerous terminal commands require hand approval while ordinary writes use the same risk rules.',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const guardedDir = path.join(runtime.workspaceRoot, 'guarded')
        const blockedDir = path.join(runtime.workspaceRoot, 'blocked-dir')
        await fs.mkdir(guardedDir, { recursive: true })
        await fs.writeFile(path.join(guardedDir, 'keep.txt'), 'keep\n')

        const unsafeCommand = isWindows ? 'Remove-Item -Recurse -Force guarded' : 'rm -rf guarded'
        const writeCommand = isWindows
          ? 'New-Item -ItemType Directory -Path blocked-dir'
          : 'mkdir blocked-dir'

        const runner = createHumanTestRunner(runtime, {
          approvalPolicy: 'deny-all',
          structuredOutputScript: {
            'human.terminal_review': [
              ({ user }) => ({
                decisions: collectTerminalReviewCommandIds(user).map((commandId) => ({
                  commandId,
                  decision: 'needs_human_review'
                }))
              }),
              ({ user }) => ({
                decisions: collectTerminalReviewCommandIds(user).map((commandId) => ({
                  commandId,
                  decision: 'needs_human_review'
                }))
              })
            ],
            'human.brain': [
              {
                output: {
                  thought: {
                    next: '先执行危险删除命令'
                  },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'terminal_run',
                        args: {
                          command: unsafeCommand,
                          commandExplanation: '删除受保护目录，用于验证危险命令审批拒绝。'
                        }
                      }
                    ]
                  }
                }
              },
              {
                output: {
                  thought: {
                    next: '再执行普通写入命令'
                  },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'terminal_run',
                        args: {
                          command: writeCommand,
                          commandExplanation: '创建目录，用于验证普通写入也走同一审批策略。'
                        }
                      }
                    ]
                  }
                }
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '审批拒绝后命令未执行。',
                  deliveryMarkdown: '# Approval Denied\n\n危险删除与普通写入均因审批拒绝而未执行。'
                })
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请分别执行危险删除命令和普通写入命令。'
        })

        return {
          output,
          guardedStillExists: await fs
            .access(path.join(guardedDir, 'keep.txt'))
            .then(() => true)
            .catch(() => false),
          blockedDirExists: await fs
            .access(blockedDir)
            .then(() => true)
            .catch(() => false),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterAiRunEventsByType(result.events, 'approval_batch_required')
        const approvalDecisions = filterAiRunEventsByType(result.events, 'approval_batch_decision')
        const stepErrors = filterAiRunEventsByType(result.events, 'terminal_step_error')
        const terminalStepStarted = filterAiRunEventsByType(result.events, 'terminal_step_started')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const terminalToolResults = toolResults.filter((event) => event.toolName === 'terminal_run')

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.guardedStillExists &&
            !result.blockedDirExists &&
            approvalEvents.length === 2 &&
            approvalDecisions.length === 2 &&
            approvalDecisions.every((event) =>
              event.decisions.every((decision) => decision.action === 'reject')
            ) &&
            approvalEvents.every((event) => !event.internal) &&
            terminalStepStarted.length === 0 &&
            terminalToolResults.length === 0 &&
            stepErrors.length === 0,
          {
            name: 'dangerous-commands-stop-at-hand-approval',
            message: '危险命令与普通写入都应在 hand 审批被拒绝后停止，且不进入真实 terminal 执行。',
            data: {
              result,
              approvals: approvalEvents,
              approvalDecisions,
              terminalStepStarted,
              terminalToolResults
            }
          }
        )
      }
    })
  })
})
