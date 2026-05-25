import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
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
            decisions: request.items.map((item, index) =>
              index === 0
                ? { itemId: item.itemId, action: 'approve' as const }
                : {
                    itemId: item.itemId,
                    action: 'guide' as const,
                    message: '先不要创建目录，先解释风险并给我备选方案'
                  }
            )
          }),
          structuredOutputScript: {
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
                          command: 'cp allowed.txt allowed-copy.txt'
                        }
                      },
                      {
                        toolName: 'terminal_run',
                        args: {
                          command: 'mkdir blocked-dir'
                        }
                      }
                    ]
                  }
                }
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '审批批次已阻断执行。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '审批批次已阻断执行。',
                  deliveryMarkdown: '# Approval Batch Blocked\n\n本轮审批未全部同意，相关命令未执行。'
                }
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
        const approvalRequiredEvents = filterAiRunEventsByType(result.events, 'approval_batch_required')
        const approvalDecisionEvents = filterAiRunEventsByType(result.events, 'approval_batch_decision')
        const toolStartedEvents = filterAiRunEventsByType(result.events, 'tool_call_started')
        const decisionHints = filterAiRunEventsByType(result.events, 'decision_hint')
        const blockedHint = decisionHints.find((event) => event.code === 'hand_approval_blocked')

        runtime.assertThat(
          result.output.status === 'completed' &&
            approvalRequiredEvents.length === 1 &&
            approvalRequiredEvents[0].items.length === 2 &&
            approvalDecisionEvents.length === 1 &&
            toolStartedEvents.length === 0 &&
            result.blockedDirExists === false &&
            result.copiedFileExists === false &&
            blockedHint?.detail?.reason === 'user_guided',
          {
            name: 'serial-terminal-approval-batch-blocks-before-execution',
            message: 'calls 中需审批 terminal 应先整批审核；只要未全部同意，本批 0 执行并回流 hand_approval_blocked。',
            data: {
              approvalRequiredEvents,
              approvalDecisionEvents,
              toolStartedEvents,
              blockedHint
            }
          }
        )
      }
    })
  })
})
