import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  collectTerminalReviewCommandIds,
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
            'human.terminal_review': [
              ({ user }) => ({
                decisions: collectTerminalReviewCommandIds(user).map((commandId) => ({
                  commandId,
                  decision: 'needs_human_review',
                  reason: '该写入操作需要人工审批。'
                }))
              })
            ],
            'human.brain': [
              {
                output: {
                  thought: { next: '执行会被拒绝的命令，并验证同批其他调用也得到结果。' },
                  toolCalls: [
                    {
                      name: 'terminal_run',
                      args: {
                        command: 'mkdir blocked-dir',
                        commandExplanation: '创建审批测试目录'
                      }
                    },
                    { name: 'kb_list_documents', args: {} }
                  ]
                }
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '审批拒绝已被正确处理。',
                  deliveryMarkdown: '# Approval Denied\n\n已说明命令因审批被拒绝而未执行。'
                })
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请尝试执行一个需要审批的命令，并在被拒绝后说明限制。'
        })
        const messageLog = await runner.ctx.loadMessageLog()

        let blockedDirExists = true
        try {
          await fs.stat(blockedPath)
        } catch {
          blockedDirExists = false
        }

        return {
          output,
          blockedDirExists,
          toolMessageNames: messageLog
            .map((record) => record.entry)
            .filter((entry) => entry.kind === 'tool')
            .map((entry) => entry.toolName),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const approvalEvents = filterAiRunEventsByType(result.events, 'approval_batch_decision')
        const terminalResultCount = toolResults.filter(
          (event) => event.toolName === 'terminal_run'
        ).length

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.blockedDirExists === false &&
            terminalResultCount === 0 &&
            result.toolMessageNames.includes('terminal_run') &&
            result.toolMessageNames.includes('kb_list_documents') &&
            approvalEvents.some((event) =>
              event.decisions.some((decision) => decision.action === 'reject')
            ),
          {
            name: 'approval-denial-stops-real-command-execution',
            message: '审批拒绝后，真实 terminal 命令不应落地执行。',
            data: {
              terminalResultCount,
              toolMessageNames: result.toolMessageNames,
              approvalEvents
            }
          }
        )
      }
    })
  })
})
