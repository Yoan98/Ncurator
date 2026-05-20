import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm backend', () => {
  it('approval-denied-restricted-delivery', async () => {
    await runBackendCase({
      caseId: 'approval-denied-restricted-delivery',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证真实审批拒绝会阻止高风险 terminal 命令落地，并把限制带入最终交付。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const blockedPath = path.join(runtime.workspaceRoot, 'blocked-dir')
        const runner = createHumanTestRunner(runtime, {
          approvalPolicy: 'deny-medium-high',
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildToolDecision({
                  toolName: 'terminal_run',
                  args: {
                    command: 'mkdir blocked-dir'
                  },
                  summary: '执行会被拒绝的命令'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '审批拒绝已被正确处理。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: '审批拒绝已被正确处理。',
                  deliveryMarkdown: '# Approval Denied\n\n已说明命令因审批被拒绝而未执行。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请尝试执行一个需要审批的命令，并在被拒绝后说明限制。'
        })

        let blockedDirExists = true
        try {
          await fs.stat(blockedPath)
        } catch {
          blockedDirExists = false
        }

        return {
          output,
          blockedDirExists,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const approvalEvents = filterAiRunEventsByType(result.events, 'approval_batch_decision')
        const decisionHints = filterAiRunEventsByType(result.events, 'decision_hint')
        const terminalResultCount = toolResults.filter((event) => event.toolName === 'terminal_run').length
        const blockedHint = decisionHints.find((event) => event.code === 'hand_approval_blocked')

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.blockedDirExists === false &&
            terminalResultCount === 0 &&
            approvalEvents.some((event) => event.decisions.some((decision) => decision.action === 'reject')) &&
            blockedHint?.detail?.reason === 'user_rejected',
          {
            name: 'approval-denial-stops-real-command-execution',
            message: '审批拒绝后，真实 terminal 命令不应落地执行，并应把 hand_approval_blocked 回流给 human。',
            data: {
              terminalResultCount,
              approvalEvents,
              blockedHint
            }
          }
        )
      }
    })
  })
})
