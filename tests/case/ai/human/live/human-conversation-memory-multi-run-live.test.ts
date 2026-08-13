import { describe, it } from 'vitest'
import {
  buildConversationMemorySummary,
  CONVERSATION_MEMORY_RECENT_TURNS,
  CONVERSATION_MEMORY_SUMMARY_TRIGGER_TURNS
} from '../../../../../src/main/services/ai/memory'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  CONVERSATION_MEMORY_FIRST_RUN_USER_INPUT,
  CONVERSATION_MEMORY_SECOND_RUN_USER_INPUT,
  CONVERSATION_MEMORY_SHARED_WORKSPACE_FIXTURE_PATH,
  loadConversationMemoryWorkspaceSeed
} from '../../../../harness/backend/liveScenarios/conversationMemoryScenario'
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
          '验证 live 模式下基于真实 workspace 的 conversation memory 会在双 run 间延续关键业务状态，并被后续真实 brain 正确带回。',
        fixtures: [CONVERSATION_MEMORY_SHARED_WORKSPACE_FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          const liveConfig = loadLiveLlmConfigFromEnv()
          const workspaceSeed = await loadConversationMemoryWorkspaceSeed(runtime)
          const initialMemorySummary = '用户正在围绕本周发布准备和风险周报连续推进。'
          await runtime.seedLlmConfig(liveConfig)
          await runtime.seedChatHistory({
            sessionId: SESSION_ID,
            messages: [
              {
                id: 'live-conversation-memory-user-0',
                role: 'user',
                content: '我们这周继续推进发布准备和风险周报。',
                timestamp: Date.now()
              }
            ],
            memory: {
              summary: initialMemorySummary,
              coveredMessageId: 'live-conversation-memory-user-0',
              coveredTimestamp: Date.now(),
              coveredMessageCount: 1,
              updatedAt: Date.now()
            }
          })

          const firstRunner = createHumanTestRunner(runtime, {
            sessionId: SESSION_ID
          })
          const firstOutput = await firstRunner.run({
            taskId: `${runtime.taskId}-run-1`,
            userInput: CONVERSATION_MEMORY_FIRST_RUN_USER_INPUT
          })
          const firstRunEvents = runtime.eventCollector.snapshot()

          const firstUserTimestamp = Date.now() + 1
          const firstAssistantTimestamp = Date.now() + 2
          const batchBridgeMessages = Array.from({ length: 18 }, (_, index) => ({
            id: `live-conversation-memory-bridge-${index + 1}`,
            role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
            content:
              index % 2 === 0
                ? `继续保持发布准备上下文，第 ${index + 1} 条。`
                : `已记录发布准备上下文，第 ${index + 1} 条。`,
            timestamp: firstUserTimestamp + index
          }))
          await runtime.seedChatHistory({
            sessionId: SESSION_ID,
            messages: [
              {
                id: 'live-conversation-memory-user-1',
                role: 'user',
                content: CONVERSATION_MEMORY_FIRST_RUN_USER_INPUT,
                timestamp: firstUserTimestamp
              },
              {
                id: 'live-conversation-memory-assistant-1',
                role: 'assistant',
                content: firstOutput.deliveryMarkdown,
                timestamp: firstAssistantTimestamp,
                artifacts: firstOutput.artifacts
              },
              ...batchBridgeMessages.map((message, index) => ({
                ...message,
                timestamp: firstAssistantTimestamp + index + 1
              }))
            ]
          })
          const memoryBatch = await runtime.chatStore.getConversationMemoryCompaction({
            sessionId: SESSION_ID,
            recentTurns: CONVERSATION_MEMORY_RECENT_TURNS,
            triggerTurns: CONVERSATION_MEMORY_SUMMARY_TRIGGER_TURNS
          })
          if (!memoryBatch) throw new Error('conversation memory compaction was not triggered')
          const summary = await buildConversationMemorySummary({
            runId: runtime.runId,
            sessionId: SESSION_ID,
            previousSummary: initialMemorySummary,
            messages: memoryBatch.messagesToSummarize,
            runtimeSettings: await runtime.storageService.aiRuntimeSettings.get(),
            llmStore: runtime.llmStore,
            modelConfigId: liveConfig.id,
            modelName: liveConfig.model_name,
            sendEvent: (event) => runtime.eventCollector.add(event),
            recordLlmIo: (record) => runtime.eventCollector.addLlmIo(record)
          })
          await runtime.chatStore.saveConversationMemory(SESSION_ID, {
            summary,
            coveredMessageId: memoryBatch.targetCoveredMessageId,
            coveredTimestamp: memoryBatch.targetCoveredTimestamp,
            coveredMessageCount: memoryBatch.targetCoveredMessageCount,
            revision: (memoryBatch.memory?.revision || 0) + 1,
            updatedAt: Date.now()
          })

          const secondRunner = createHumanTestRunner(runtime, {
            sessionId: SESSION_ID
          })
          const secondOutput = await secondRunner.run({
            taskId: `${runtime.taskId}-run-2`,
            userInput: CONVERSATION_MEMORY_SECOND_RUN_USER_INPUT
          })
          const allEvents = runtime.eventCollector.snapshot()
          const secondRunEvents = allEvents.slice(firstRunEvents.length)
          const savedMemory = await runtime.chatStore.getConversationMemory(SESSION_ID)
          const brainPrompt =
            runtime.eventCollector
              .snapshotLlmIo()
              .filter((record) => record.caller === 'human.brain')
              .at(-1)?.user || ''

          return {
            workspaceSeed,
            firstOutput,
            secondOutput,
            savedMemory,
            memoryBatch: {
              count: memoryBatch.messagesToSummarize.length,
              targetCoveredMessageId: memoryBatch.targetCoveredMessageId,
              targetCoveredTimestamp: memoryBatch.targetCoveredTimestamp,
              targetCoveredMessageCount: memoryBatch.targetCoveredMessageCount
            },
            brainPrompt,
            firstRunEvents,
            secondRunEvents
          }
        },
        assert: async (result, runtime) => {
          if (!result.workspaceSeed) {
            runtime.assertThat(false, {
              name: 'live-config-not-provided',
              message:
                '未提供 live 模型配置，已跳过 human conversation memory multi-run live case。'
            })
            return
          }

          const summary = String(result.savedMemory?.summary || '')
          const persistenceSatisfied =
            result.firstOutput?.status === 'completed' &&
            result.secondOutput?.status === 'completed' &&
            result.memoryBatch?.count === 10 &&
            result.memoryBatch?.targetCoveredMessageId === 'live-conversation-memory-bridge-8' &&
            result.savedMemory?.coveredMessageId === result.memoryBatch?.targetCoveredMessageId &&
            result.savedMemory?.coveredTimestamp === result.memoryBatch?.targetCoveredTimestamp &&
            result.savedMemory?.coveredMessageCount ===
              result.memoryBatch?.targetCoveredMessageCount
          const memoryQualitySatisfied = summary.trim().length > 0
          const promptContinuitySatisfied =
            result.brainPrompt.includes('<conversation_history>') &&
            result.brainPrompt.includes('<summary>') &&
            result.brainPrompt.includes('<recent_turns>')
          runtime.assertThat(
            persistenceSatisfied && memoryQualitySatisfied && promptContinuitySatisfied,
            {
            name: 'human-live-conversation-memory-multi-run-recall-persists',
            message:
              'live conversation memory 应完成持久化，并在第二 run 的 brain prompt 中带回 memory 结构。',
            data: {
              savedMemory: result.savedMemory,
              brainPrompt: result.brainPrompt,
              memoryBatch: result.memoryBatch,
              firstRunStatus: result.firstOutput?.status,
              secondRunStatus: result.secondOutput?.status
            }
            }
          )
        }
      })
    })
  })
})
