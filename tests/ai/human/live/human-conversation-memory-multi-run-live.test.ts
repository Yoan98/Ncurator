import { describe, it } from 'vitest'
import { updateConversationMemoryAfterRun } from '../../../../src/main/services/ai/memory'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { runWithStructuredOutputRetry } from '../testUtils'

const SESSION_ID = 'live-conversation-memory-multi-run-session'

describe('ai human live backend', () => {
  it('human-conversation-memory-multi-run-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-conversation-memory-multi-run-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模式下 conversation memory 可在多次 run 后保留稳定主线、更新状态，并被后续真实 brain 取回。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return {
              skipped: true,
              output: null,
              savedMemory: null,
              brainPrompt: ''
            }
          }

          const liveConfig = loadLiveLlmConfigFromEnv()
          await runtime.seedLlmConfig(liveConfig)
          const startedAt = Date.now()
          await runtime.seedChatHistory({
            sessionId: SESSION_ID,
            messages: [
              {
                id: 'live-memory-start-user',
                role: 'user',
                content: '我们先推进发布准备。',
                timestamp: startedAt
              },
              {
                id: 'live-memory-start-assistant',
                role: 'assistant',
                content: '已建立发布准备主线，当前缺少回滚负责人。',
                timestamp: startedAt + 1
              }
            ],
            memory: {
              summary: '发布准备主线已建立；当前缺少回滚负责人。'
            }
          })

          await updateConversationMemoryAfterRun({
            runId: runtime.runId,
            sessionId: SESSION_ID,
            userInput: '请继续跟进回滚负责人。',
            assistantOutput: '目前负责人候选是 Alice，但审批还没完成。',
            artifacts: [
              {
                kind: 'file',
                capability: 'docx',
                artifactRole: 'draft',
                path: '/workspace/rollback-owner.docx',
                fileName: 'rollback-owner.docx',
                operation: 'created',
                summary: '回滚负责人草稿'
              }
            ],
            runtimeSettings: await runtime.storageService.aiRuntimeSettings.get(),
            chatStore: runtime.chatStore,
            llmStore: runtime.llmStore,
            modelName: liveConfig.model_name,
            sendEvent: (event) => runtime.eventCollector.add(event),
            recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record)
          })

          await runtime.seedChatHistory({
            sessionId: SESSION_ID,
            messages: [
              {
                id: 'live-memory-run-2-user',
                role: 'user',
                content: '负责人和上线窗口现在是什么状态？',
                timestamp: startedAt + 2
              },
              {
                id: 'live-memory-run-2-assistant',
                role: 'assistant',
                content: '负责人候选已经改成 Bob，但审批仍未完成，且上线窗口冲突待确认。',
                timestamp: startedAt + 3,
                artifacts: [
                  {
                    kind: 'file',
                    capability: 'docx',
                    artifactRole: 'draft',
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
            userInput: '把负责人更新和窗口冲突一并记录下来。',
            assistantOutput: '已更新负责人为 Bob，并记录上线窗口冲突待确认。',
            artifacts: [
              {
                kind: 'file',
                capability: 'docx',
                artifactRole: 'draft',
                path: '/workspace/delay-note.docx',
                fileName: 'delay-note.docx',
                operation: 'created',
                summary: '延期确认记录'
              }
            ],
            runtimeSettings: await runtime.storageService.aiRuntimeSettings.get(),
            chatStore: runtime.chatStore,
            llmStore: runtime.llmStore,
            modelName: liveConfig.model_name,
            sendEvent: (event) => runtime.eventCollector.add(event),
            recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record)
          })

          const savedMemory = await runtime.chatStore.getConversationMemory(SESSION_ID)
          const runner = createHumanTestRunner(runtime, {
            sessionId: SESSION_ID
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: '基于前面的连续进展，告诉我当前状态和下一步安排。'
          })
          const brainPrompt =
            runtime
              .eventCollector
              .snapshotLlmIo()
              .find((record) => record.caller === 'human.brain')?.user || ''

          return {
            skipped: false,
            output,
            savedMemory,
            brainPrompt
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human conversation memory multi-run live case。'
            })
            return
          }

          const summary = String(result.savedMemory?.summary || '')
          const delivery = String(result.output?.deliveryMarkdown || '')
          runtime.assertThat(
            result.output?.status === 'completed' &&
              summary.trim().length > 0 &&
              /发布准备|上线|回滚|审批/.test(summary) &&
              /Bob|负责人/.test(summary) &&
              /窗口|冲突|待确认/.test(summary) &&
              /草稿|记录/.test(summary) &&
              result.brainPrompt.includes('<conversation_summary>') &&
              result.brainPrompt.includes('<recent_turns>') &&
              /Bob|负责人/.test(result.brainPrompt) &&
              /窗口|冲突|待确认/.test(result.brainPrompt) &&
              /风险跟踪草稿|延期确认记录|回滚负责人草稿/.test(result.brainPrompt) &&
              /当前|状态/.test(delivery) &&
              /下一步|建议|先/.test(delivery) &&
              /Bob|负责人/.test(delivery) &&
              /窗口|冲突|待确认/.test(delivery),
            {
              name: 'human-live-conversation-memory-multi-run-recall-persists',
              message:
                'live conversation memory 应在多 run 后保留主线和状态，并在后续真实 brain / 最终交付中带回关键事实。',
              data: {
                savedMemory: result.savedMemory,
                brainPrompt: result.brainPrompt,
                delivery
              }
            }
          )
        }
      })
    })
  }, 120_000)
})
