import { describe, it } from 'vitest'
import { updateConversationMemoryAfterRun } from '../../../../../src/main/services/ai/memory'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  CONVERSATION_MEMORY_FIRST_RUN_USER_INPUT,
  CONVERSATION_MEMORY_SECOND_RUN_USER_INPUT,
  CONVERSATION_MEMORY_SHARED_WORKSPACE_FIXTURE_PATH,
  loadConversationMemoryWorkspaceSeed
} from '../../../../harness/backend/liveScenarios/conversationMemoryScenario'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const SESSION_ID = 'live-conversation-memory-multi-run-session'

const normalizeAssertionText = (text: string): string => text.replace(/\s+/g, '')

const hasOwnerSummarySemantics = (text: string, expectedOwnerSummary: string): boolean =>
  text.includes(expectedOwnerSummary) ||
  /(?:最终复核窗口|最终合规复核|复核窗口).*(?:合规负责人\s*)?Alice.*(?:牵头|协调|把控)/.test(text)

const hasNextStepSemantics = (text: string, expectedNextStep: string): boolean =>
  text.includes(expectedNextStep) ||
  /财务接口人\s*Bob.*补齐付款材料(?:与附件映射说明)?，?并在复核前完成附件对齐/.test(
    text
  ) ||
  /Bob.*(?:负责|本周内)?.*补齐(?:剩余)?付款材料/.test(text)

const hasRiskConclusionSemantics = (
  text: string,
  expectedRiskConclusion: string
): boolean => {
  const normalizedText = normalizeAssertionText(text)
  const normalizedExpected = normalizeAssertionText(expectedRiskConclusion)
  return (
    normalizedText.includes(normalizedExpected) ||
    /最终合规签署完成前[^。]{0,40}(?:仍需|继续)(?:保持|持续)跟进/.test(normalizedText)
  )
}

const hasOwnerRecallSemantics = (text: string): boolean =>
  /Alice|Bob|合规负责人|财务接口人|交付负责人/.test(text)

const hasNextStepRecallSemantics = (text: string): boolean =>
  /周三|周四|周五|补件|复核窗口|跟进|对外口径|下一步|安排/.test(text)

const hasPrimaryPendingItemSemantics = (text: string): boolean =>
  /合规附件|附件版本|版本对齐|法务复核|复核最终意见|付款材料|附件映射/.test(text)

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
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return {
              skipped: true,
              firstOutput: null,
              secondOutput: null,
              savedMemory: null,
              brainPrompt: '',
              firstRunEvents: [],
              secondRunEvents: []
            }
          }

          const liveConfig = loadLiveLlmConfigFromEnv()
          const workspaceSeed = await loadConversationMemoryWorkspaceSeed(runtime)
          await runtime.seedLlmConfig(liveConfig)
          await runtime.seedWorkspaceKb({
            mode: 'all-supported'
          })
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
              summary: '用户正在围绕本周发布准备和风险周报连续推进。'
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

          await updateConversationMemoryAfterRun({
            runId: runtime.runId,
            sessionId: SESSION_ID,
            userInput: CONVERSATION_MEMORY_FIRST_RUN_USER_INPUT,
            assistantOutput: firstOutput.deliveryMarkdown,
            artifacts: firstOutput.artifacts || [],
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
                id: 'live-conversation-memory-user-1',
                role: 'user',
                content: CONVERSATION_MEMORY_FIRST_RUN_USER_INPUT,
                timestamp: Date.now() + 1
              },
              {
                id: 'live-conversation-memory-assistant-1',
                role: 'assistant',
                content: firstOutput.deliveryMarkdown,
                timestamp: Date.now() + 2,
                artifacts: firstOutput.artifacts
              }
            ]
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
            skipped: false,
            workspaceSeed,
            firstOutput,
            secondOutput,
            savedMemory,
            brainPrompt,
            firstRunEvents,
            secondRunEvents
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
          const secondDelivery = String(result.secondOutput?.deliveryMarkdown || '')
          const secondToolNames = filterAiRunEventsByType(result.secondRunEvents, 'tool_call_result').map(
            (event) => event.toolName
          )

          runtime.assertThat(
            result.firstOutput?.status === 'completed' &&
              result.secondOutput?.status === 'completed' &&
              summary.trim().length > 0 &&
              /周报|发布|风险|跟进/.test(summary) &&
              hasOwnerRecallSemantics(summary) &&
              /待确认|待跟进|未完成|复核/.test(summary) &&
              hasNextStepRecallSemantics(summary) &&
              result.brainPrompt.includes('<conversation_history>') &&
              result.brainPrompt.includes('<summary>') &&
              result.brainPrompt.includes('<recent_turns>') &&
              hasOwnerRecallSemantics(result.brainPrompt) &&
              hasRiskConclusionSemantics(result.brainPrompt, result.workspaceSeed.expectedRiskConclusion) &&
              hasNextStepRecallSemantics(result.brainPrompt) &&
              (secondToolNames.length === 0 ||
                secondToolNames.some((toolName) =>
                  ['docx_outline', 'docx_read_blocks', 'docx_search', 'kb_search', 'terminal_run'].includes(
                    toolName
                  )
                )) &&
              hasPrimaryPendingItemSemantics(secondDelivery) &&
              hasContactDecisionSemantics(secondDelivery) &&
              hasOwnerRoleConsistencySemantics(secondDelivery) &&
              hasFollowupContinuitySemantics(secondDelivery) &&
              hasWhySemantics(secondDelivery),
            {
              name: 'human-live-conversation-memory-multi-run-recall-persists',
              message:
                'live conversation memory 应在真实 workspace 双 run 间带回关键业务状态；第二轮可以选择直接复用记忆，也可以重新读取资料，但结论不能偏离第一轮形成的连续主线，并继续围绕负责人分工、阻塞项与后续动作展开。',
              data: {
                savedMemory: result.savedMemory,
                brainPrompt: result.brainPrompt,
                secondDelivery,
                secondToolNames
              }
            }
          )
        }
      })
    })
  })
})
