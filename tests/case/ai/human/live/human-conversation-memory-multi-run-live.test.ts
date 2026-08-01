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

const normalizeAssertionText = (text: string): string => text.replace(/\s+/g, '')

const hasRiskConclusionSemantics = (text: string, expectedRiskConclusion: string): boolean => {
  const normalizedText = normalizeAssertionText(text)
  const normalizedExpected = normalizeAssertionText(expectedRiskConclusion)
  return (
    normalizedText.includes(normalizedExpected) ||
    /最终合规签署完成前[^。]{0,40}(?:仍需|继续)(?:保持|持续)跟进/.test(normalizedText) ||
    /风险状态(?:需|需要)?(?:保持|持续)?跟进/.test(normalizedText) ||
    /合规(?:签署)?[^。]{0,60}(?:未闭环|未完成|完成前)[^。]{0,60}(?:跟进|风险)/.test(
      normalizedText
    ) ||
    /风险[^。]{0,60}(?:跟进|未解除)/.test(normalizedText)
  )
}

const hasOwnerRecallSemantics = (text: string): boolean =>
  /Alice|Bob|合规负责人|财务接口人|交付负责人/.test(text)

const hasNextStepRecallSemantics = (text: string): boolean =>
  /周三|周四|周五|补件|复核窗口|跟进|对外口径|下一步|安排/.test(text)

const hasPrimaryPendingItemSemantics = (text: string): boolean =>
  /合规附件|附件版本|版本对齐|法务复核|合规复核|复核窗口|复核最终意见|最终合规签署|付款材料|附件映射/.test(
    text
  )

const hasContactDecisionSemantics = (text: string): boolean =>
  /先找|应该先找|优先找|先联系|先同步/.test(text) && /Alice|Bob/.test(text)

const hasOwnerRoleConsistencySemantics = (text: string): boolean =>
  (/Alice/.test(text) && /复核窗口|法务|统一口径|主负责人|牵头/.test(text)) ||
  (/Bob/.test(text) && /付款材料|附件映射|补齐|执行动作|材料收尾/.test(text))

const hasFollowupContinuitySemantics = (text: string): boolean =>
  /持续跟进|待确认|未完成|补齐|核对|签署窗口|下一步|同步/.test(text)

const hasWhySemantics = (text: string): boolean =>
  (/(复核窗口|法务|统一口径)/.test(text) && /Alice/.test(text)) ||
  (/(付款材料|附件映射|执行动作)/.test(text) && /Bob/.test(text))

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
          const memoryQualitySatisfied =
            summary.trim().length > 0 &&
            /周报|发布|风险|跟进/.test(summary) &&
            hasOwnerRecallSemantics(summary) &&
            /待确认|待跟进|未完成|复核/.test(summary) &&
            hasNextStepRecallSemantics(summary)
          const promptContinuitySatisfied =
            result.brainPrompt.includes('<conversation_history>') &&
            result.brainPrompt.includes('<summary>') &&
            result.brainPrompt.includes('<recent_turns>') &&
            hasOwnerRecallSemantics(result.brainPrompt) &&
            hasRiskConclusionSemantics(
              result.brainPrompt,
              result.workspaceSeed.expectedRiskConclusion
            ) &&
            hasNextStepRecallSemantics(result.brainPrompt)
          runtime.assertThat(
            persistenceSatisfied && memoryQualitySatisfied && promptContinuitySatisfied,
            {
            name: 'human-live-conversation-memory-multi-run-recall-persists',
            message:
              'live conversation memory 按 10 分制评估双 run 间的业务连续性，得分必须达到 8 分。',
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
