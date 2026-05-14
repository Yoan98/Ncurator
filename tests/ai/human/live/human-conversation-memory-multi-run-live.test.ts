import { describe, it } from 'vitest'
import { updateConversationMemoryAfterRun } from '../../../../src/main/services/ai/memory'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  loadRiskReportWorkspaceSeed,
  SHARED_WORKSPACE_FIXTURE_PATH
} from '../../../harness/backend/aiLiveTestData'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const SESSION_ID = 'live-conversation-memory-multi-run-session'
const FIRST_RUN_USER_INPUT =
  '先不要写周报，也不要新建文件。你先基于我工作目录下的真实材料，告诉我本周最关键的风险、负责人、待确认项和下一步。'
const SECOND_RUN_USER_INPUT =
  '沿着刚才那轮继续，不用重写背景，直接告诉我目前最关键的待确认项、应该先找谁、为什么。'

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

const hasPrimaryPendingItemSemantics = (text: string): boolean =>
  /付款材料.*(?:最终)?合规附件.*(?:对齐|一致)/.test(text) ||
  /合规附件.*付款材料.*(?:对齐|一致)/.test(text)

const hasBobFirstSemantics = (text: string): boolean =>
  /先找\s*\**Bob\**/.test(text) ||
  /应该先找\s*\**Bob\**/.test(text) ||
  /Bob\s+是财务接口人/.test(text)

const hasWhySemantics = (text: string): boolean =>
  /复核窗口/.test(text) && /Alice|法务/.test(text)

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
        fixtures: [SHARED_WORKSPACE_FIXTURE_PATH],
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
          const workspaceSeed = await loadRiskReportWorkspaceSeed(runtime)
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
            userInput: FIRST_RUN_USER_INPUT
          })
          const firstRunEvents = runtime.eventCollector.snapshot()

          await updateConversationMemoryAfterRun({
            runId: runtime.runId,
            sessionId: SESSION_ID,
            userInput: FIRST_RUN_USER_INPUT,
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
                content: FIRST_RUN_USER_INPUT,
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
            userInput: SECOND_RUN_USER_INPUT
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
              /Bob|财务接口人/.test(summary) &&
              /Alice|合规负责人/.test(summary) &&
              /待确认|待跟进|未完成|复核/.test(summary) &&
              result.brainPrompt.includes('<conversation_summary>') &&
              result.brainPrompt.includes('<recent_turns>') &&
              hasOwnerSummarySemantics(result.brainPrompt, result.workspaceSeed.expectedOwnerSummary) &&
              hasRiskConclusionSemantics(result.brainPrompt, result.workspaceSeed.expectedRiskConclusion) &&
              hasNextStepSemantics(result.brainPrompt, result.workspaceSeed.expectedNextStep) &&
              (secondToolNames.length === 0 ||
                secondToolNames.some((toolName) =>
                  ['docx_outline', 'docx_read_blocks', 'docx_search', 'kb_search', 'terminal_run'].includes(
                    toolName
                  )
                )) &&
              hasPrimaryPendingItemSemantics(secondDelivery) &&
              hasBobFirstSemantics(secondDelivery) &&
              hasWhySemantics(secondDelivery),
            {
              name: 'human-live-conversation-memory-multi-run-recall-persists',
              message:
                'live conversation memory 应在真实 workspace 双 run 间带回关键业务状态；第二轮可以选择直接复用记忆，也可以重新读取资料，但结论不能偏离已形成的连续主线。',
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
  }, 480_000)
})
