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

describe('ai tool hand backend', () => {
  it('hand-terminal-approval-batch', async () => {
    await runBackendCase({
      caseId: 'hand-terminal-approval-batch',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证 hand 会对 calls 中需审批 terminal 做批量预检，并在整批未全同意时 0 执行。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const blockedDir = path.join(runtime.workspaceRoot, 'blocked-dir')
        const allowedNote = path.join(runtime.workspaceRoot, 'allowed.txt')
        await fs.writeFile(allowedNote, 'seed\n')

        const runner = createHumanTestRunner(runtime, {
          approvalPolicy: (request) => ({
            accepted: true,
            decisions: request.items.map((item) => ({
              itemId: item.itemId,
              action: 'guide' as const,
              message: '先不要创建目录，先解释风险并给我备选方案'
            }))
          }),
          structuredOutputScript: {
            'human.terminal_review': [
              ({ user }) => ({
                decisions: collectTerminalReviewCommandIds(user).map((commandId, index) => ({
                  commandId,
                  decision: index === 0 ? 'auto_approve' : 'needs_human_review',
                  reason:
                    index === 0
                      ? '该操作范围明确且符合用户诉求。'
                      : '该操作影响范围需要人工确认。'
                }))
              })
            ],
            'human.brain': [
              {
                output: {
                  thought: {
                    next: '先批量执行两个需要审批的 terminal 命令'
                  },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'terminal_run',
                        args: {
                          command: 'cp allowed.txt allowed-copy.txt',
                          commandExplanation: '复制测试文件，用于验证多命令审批批次的原子阻断。'
                        }
                      },
                      {
                        toolName: 'terminal_run',
                        args: {
                          command: 'mkdir blocked-dir',
                          commandExplanation: '创建测试目录，用于验证审批未全部通过时整批不执行。'
                        }
                      }
                    ]
                  }
                }
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '审批批次已阻断执行。',
                  deliveryMarkdown:
                    '# Approval Batch Blocked\n\n本轮审批未全部同意，相关命令未执行。'
                })
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请连续执行两个需要审批的终端命令。'
        })

        return {
          output,
          blockedDirExists: await fs
            .access(blockedDir)
            .then(() => true)
            .catch(() => false),
          copiedFileExists: await fs
            .access(path.join(runtime.workspaceRoot, 'allowed-copy.txt'))
            .then(() => true)
            .catch(() => false),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const approvalRequiredEvents = filterAiRunEventsByType(
          result.events,
          'approval_batch_required'
        )
        const approvalDecisionEvents = filterAiRunEventsByType(
          result.events,
          'approval_batch_decision'
        )
        const terminalStepStartedEvents = filterAiRunEventsByType(
          result.events,
          'terminal_step_started'
        )
        const terminalStepResultEvents = filterAiRunEventsByType(
          result.events,
          'terminal_step_result'
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            approvalRequiredEvents.length === 1 &&
            approvalRequiredEvents[0].items.length === 1 &&
            approvalDecisionEvents.length === 1 &&
            terminalStepStartedEvents.length === 0 &&
            terminalStepResultEvents.length === 0 &&
            result.blockedDirExists === false &&
            result.copiedFileExists === false,
          {
            name: 'terminal-approval-batch-blocks-before-execution',
            message:
              'calls 中需审批 terminal 应先整批审核；只要未全部同意，本批 0 执行并回到 brain 重新决策。',
            data: {
              approvalRequiredEvents,
              approvalDecisionEvents,
              terminalStepStartedEvents,
              terminalStepResultEvents
            }
          }
        )
      }
    })
  })
})
