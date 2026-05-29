import { describe, it } from 'vitest'
import { updateConversationMemoryAfterRun } from '../../../../src/main/services/ai/memory'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createScriptedStructuredOutputDriver } from '../../../harness/backend/scriptedStructuredOutputDriver'
import { buildCompleteTaskDecision } from '../testUtils'

const SESSION_ID = 'conversation-memory-multi-run-session'

describe('ai human mock-llm backend', () => {
  it('conversation-memory-multi-run-recall', async () => {
    await runBackendCase({
      caseId: 'conversation-memory-multi-run-recall',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证同一 session 下多次 run 后 conversation memory 会保留稳定主线、覆盖旧状态，并在下一次 brain prompt 中带入。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const startedAt = Date.now()
        await runtime.seedChatHistory({
          sessionId: SESSION_ID,
          messages: [
            {
              id: 'conversation-memory-seed-user',
              role: 'user',
              content: '我们先准备发布清单。',
              timestamp: startedAt
            },
            {
              id: 'conversation-memory-seed-assistant',
              role: 'assistant',
              content: '当前已确认主线是发布准备，但还缺少回滚负责人。',
              timestamp: startedAt + 1
            }
          ],
          memory: {
            summary: '发布准备主线已建立；当前缺少回滚负责人。'
          }
        })

        const conversationDriver = createScriptedStructuredOutputDriver({
          'conversation.memory': [
            {
              output: {
                summary:
                '发布准备主线持续推进；当前状态：回滚负责人候选为 Alice，审批尚未完成；未解决事项：上线窗口冲突待确认；现有产物：回滚负责人草稿与风险跟踪草稿。'
              }
            },
            {
              output: {
                summary:
                '发布准备主线持续推进；当前状态：回滚负责人候选已更新为 Bob，审批仍未完成；未解决事项：上线窗口冲突待确认；现有产物：回滚负责人草稿、风险跟踪草稿、延期确认记录。'
              }
            }
          ]
        })

        await updateConversationMemoryAfterRun({
          runId: runtime.runId,
          sessionId: SESSION_ID,
          userInput: '请继续跟进回滚负责人。',
          assistantOutput: '目前候选负责人是 Alice，但审批还没完成。',
          artifacts: [
            {
              kind: 'file',
              capability: 'docx',
              applyId: 'apply-rollback-owner',
              path: '/workspace/rollback-owner.docx',
              fileName: 'rollback-owner.docx',
              operation: 'created',
              summary: '回滚负责人草稿'
            }
          ],
          runtimeSettings: await runtime.storageService.aiRuntimeSettings.get(),
          chatStore: runtime.chatStore,
          llmStore: runtime.llmStore,
          modelName: 'scripted-llm',
          sendEvent: (event) => runtime.eventCollector.add(event),
          recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record),
          llmDriver: conversationDriver
        })

        await runtime.seedChatHistory({
          sessionId: SESSION_ID,
          messages: [
            {
              id: 'conversation-memory-run-2-user',
              role: 'user',
              content: '上线窗口和审批情况有更新吗？',
              timestamp: startedAt + 2
            },
            {
              id: 'conversation-memory-run-2-assistant',
              role: 'assistant',
              content: '负责人候选改成了 Bob，但审批仍未完成，还发现上线窗口冲突待确认。',
              timestamp: startedAt + 3,
              artifacts: [
                {
                  kind: 'file',
                  capability: 'docx',
                  applyId: 'apply-risk-tracking',
                  path: '/workspace/risk-tracking.docx',
                  fileName: 'risk-tracking.docx',
                  operation: 'created',
                  summary: '风险跟踪草稿'
                }
              ]
            }
          ]
        })

        await updateConversationMemoryAfterRun({
          runId: runtime.runId,
          sessionId: SESSION_ID,
          userInput: '请把负责人更新和窗口冲突一并记录。',
          assistantOutput: '已将负责人更新为 Bob，并记录上线窗口冲突待确认。',
          artifacts: [
            {
              kind: 'file',
              capability: 'docx',
              applyId: 'apply-delay-note',
              path: '/workspace/delay-note.docx',
              fileName: 'delay-note.docx',
              operation: 'created',
              summary: '延期确认记录'
            }
          ],
          runtimeSettings: await runtime.storageService.aiRuntimeSettings.get(),
          chatStore: runtime.chatStore,
          llmStore: runtime.llmStore,
          modelName: 'scripted-llm',
          sendEvent: (event) => runtime.eventCollector.add(event),
          recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record),
          llmDriver: conversationDriver
        })

        const savedMemory = await runtime.chatStore.getConversationMemory(SESSION_ID)
        let promptChecks = {
          summarySeen: false,
          recentTurnsSeen: false,
          oldStateCleared: false
        }
        const runner = createHumanTestRunner(runtime, {
          sessionId: SESSION_ID,
          structuredOutputScript: {
            'human.brain': [
              ({ user }) => {
                promptChecks = {
                  summarySeen:
                    user.includes('<conversation_history>') &&
                    user.includes('<summary>') &&
                    user.includes('回滚负责人候选已更新为 Bob') &&
                    user.includes('上线窗口冲突待确认') &&
                    user.includes('延期确认记录'),
                  recentTurnsSeen:
                    user.includes('<recent_turns>') &&
                    user.includes('上线窗口和审批情况有更新吗？') &&
                    user.includes('风险跟踪草稿'),
                  oldStateCleared: !String(savedMemory?.summary || '').includes('Alice，审批尚未完成')
                }
                return buildCompleteTaskDecision({
                  summary: '当前负责人候选是 Bob，审批未完成，且上线窗口冲突待确认。下一步先确认窗口，再推进审批。'
                })
              }
            ],
            'human.mouth': [
              {
                text: '当前负责人候选是 Bob，审批仍未完成，且上线窗口冲突待确认。下一步先确认窗口，再推进审批。'
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '基于前面的进展，告诉我当前状态和下一步。'
        })

        return {
          output,
          savedMemory,
          promptChecks
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            Boolean(result.savedMemory?.summary.includes('Bob')) &&
            Boolean(result.savedMemory?.summary.includes('上线窗口冲突待确认')) &&
            Boolean(result.savedMemory?.summary.includes('延期确认记录')) &&
            !String(result.savedMemory?.summary || '').includes('Alice，审批尚未完成') &&
            result.promptChecks.summarySeen &&
            result.promptChecks.recentTurnsSeen &&
            result.promptChecks.oldStateCleared &&
            result.output.deliveryMarkdown.includes('Bob') &&
            result.output.deliveryMarkdown.includes('上线窗口冲突待确认') &&
            result.output.deliveryMarkdown.includes('先确认窗口'),
          {
            name: 'conversation-memory-multi-run-summary-and-recall-stay-consistent',
            message:
              'conversation memory 应在多 run 后保留稳定主线、覆盖旧状态，并在下一次 brain prompt 与最终交付中正确带入。',
            data: result
          }
        )
      }
    })
  })
})
