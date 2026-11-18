import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { BaseMessage } from '@langchain/core/messages'
import type { AiRunDeps } from '../../../../../src/main/services/ai/types'
import { isWorkspaceInstructionsMessage } from '../../../../../src/main/services/ai/human/node/utils/messageTail'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildLoadToolsetsDecision } from '../testUtils'

describe('ai human mock-llm workspace instructions', () => {
  it('human-workspace-agents-injection', async () => {
    await runBackendCase({
      caseId: 'human-workspace-agents-injection',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证首次 brain 请求在 System 后携带工作区 AGENTS.md，且不写 transcript。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const agentsPath = path.join(runtime.workspaceRoot, 'AGENTS.md')
        await fs.writeFile(agentsPath, '# Workspace rules\n\nRead docs first.\n', 'utf8')

        const brainRequests: BaseMessage[][] = []
        const captureBrainRequests: NonNullable<AiRunDeps['chatToolsWrapper']> =
          (realChatTools) => async (request) => {
            if (request.caller === 'human.brain') {
              brainRequests.push([...request.messages])
            }
            return await realChatTools(request)
          }

        const runner = createHumanTestRunner(runtime, {
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLoadToolsetsDecision({
                  toolsetNames: ['text-file'],
                  summary: '加载文本工具'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '工作区规则已加载。',
                  deliveryMarkdown: '已按工作区规则处理。'
                })
              }
            ]
          },
          chatToolsWrapper: captureBrainRequests
        })
        const output = await runner.run({
          taskId: `${runtime.taskId}-workspace-agents`,
          userInput: '请处理当前任务。'
        })
        const log = await runner.ctx.loadMessageLog()

        return {
          output,
          brainRequests,
          log,
          agentsPath
        }
      },
      assert: async (result, runtime) => {
        const requests = result.brainRequests
        const perRequest = requests.map((messages) => {
          const instructionIndexes = messages.flatMap((message, index) =>
            isWorkspaceInstructionsMessage(message) ? [index] : []
          )
          const instructionText = String(messages[instructionIndexes[0]]?.content || '')
          const currentUserIndex = messages.findIndex(
            (message) =>
              message.getType() === 'human' &&
              typeof message.content === 'string' &&
              message.content.includes('请处理当前任务')
          )
          const systemText = String(messages[0]?.content || '')
          return {
            instructionIndexes,
            instructionText,
            currentUserIndex,
            systemText,
            messageTypes: messages.map((message) => message.getType())
          }
        })
        const logHasAgentsContent = result.log.some(
          (record) =>
            record.entry.kind === 'user' && record.entry.content.includes('Read docs first.')
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            requests.length >= 2 &&
            perRequest.every(
              (request) =>
                request.instructionIndexes.length === 1 &&
                request.instructionIndexes[0] === 1 &&
                request.currentUserIndex > 1 &&
                request.instructionText.includes(result.agentsPath) &&
                request.instructionText.includes('Read docs first.') &&
                !request.systemText.includes('Read docs first.')
            ) &&
            !logHasAgentsContent,
          {
            name: 'human-workspace-agents-injection',
            message:
              '每轮 brain 请求都应在 System 后恰好携带一条工作区指令，且指令不写 transcript。',
            data: {
              status: result.output.status,
              requestCount: requests.length,
              perRequest: perRequest.map((request) => ({
                instructionIndexes: request.instructionIndexes,
                currentUserIndex: request.currentUserIndex,
                messageTypes: request.messageTypes
              })),
              logHasAgentsContent
            }
          }
        )
      }
    })
  })
})
