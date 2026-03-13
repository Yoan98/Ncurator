import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type { ChatMessage } from '../../../../src/shared/types'
import { recordAssertion } from '../../../harness/main/assertions'
import { runRuntimeCase } from '../../../harness/main/capabilityCase'
import { isLiveSuiteEnabled } from '../../../harness/main/llmConfig'
import { runLiveMainRuntime } from '../../../harness/main/mainContextRuntime'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const buildHistoryMessage = (input: {
  id: string
  sessionId: string
  role: ChatMessage['role']
  content: string
  timestamp: number
}): ChatMessage => ({
  id: input.id,
  session_id: input.sessionId,
  role: input.role,
  content: input.content,
  timestamp: input.timestamp
})

describe('main/ai/runtime/context live', () => {
  test.skipIf(!isLiveSuiteEnabled())(
    'live context should handle anaphora follow-up without leaving runtime state empty',
    async () => {
      const caseId = 'context-anaphora-followup'
      const caseMetadata = {
        description: '验证 live main runtime 在指代型 follow-up 中能够消化历史与本地上下文并产出非空交付。',
        taskGoal: '继续刚才第二步，并根据 workspace 中的 plan.txt / step2.txt 提供可执行结果或明确澄清结果。',
        scenarioTags: ['runtime', 'main-context', 'live', 'anaphora'],
        expectedOutcome: 'success',
        requiredFixtures: [],
        retentionTier: 'live-eval',
        lifecycle: 'active',
        runPolicy: 'batch_only',
        capabilityArea: 'ai-runtime'
      } as const

      await runRuntimeCase({
        caseId,
        description: caseMetadata.description,
        caseMetadata,
        expectedOutcome: caseMetadata.expectedOutcome,
        scenarioTags: caseMetadata.scenarioTags,
        requiredFixtures: caseMetadata.requiredFixtures,
        fixtureCopies: [],
        buildExecutionOutcome: (result) => ({
          status: result.finalState.error ? 'blocked' : 'completed',
          resultCode: result.finalState.error ? 'blocked' : 'ok',
          summary: 'live main context anaphora follow-up completed'
        }),
        buildSignalOverrides: (result, runtime) => {
          const contextTaskIds = runtime.eventCollector
            .snapshot()
            .filter(
              (event) => event.type === 'task_delivery_ready' && event.taskId.startsWith('context-')
            )
            .map((event) => event.taskId)
          return {
            contextRoundCount: result.finalState.contextRounds,
            contextEvidenceCount: result.finalState.contextEvidence.length,
            internalContextDeliveryCount: contextTaskIds.length,
            contextFinalRoute:
              result.finalState.finalDeliveryTaskId === 'direct-human'
                ? 'main_direct_human_exec'
                : result.finalState.finalDeliveryTaskId === 'synthesis-human'
                  ? 'main_synthesis_human'
                  : result.finalState.mainStage,
            fellBackByRoundCap: result.finalState.contextRounds >= 2,
            internalContextTaskIds: contextTaskIds,
            contextEvidenceItems: result.finalState.contextEvidence
          }
        },
        execute: async (runtime) => {
          const sessionId = 'context-anaphora-followup'
          await fs.writeFile(
            path.join(runtime.workspaceRoot, 'plan.txt'),
            '第二步：读取 step2.txt 的第一行，并告诉用户结果。',
            'utf8'
          )
          await fs.writeFile(path.join(runtime.workspaceRoot, 'step2.txt'), 'Beta second step', 'utf8')

          const finalState = await runLiveMainRuntime({
            runId: runtime.runId,
            sessionId,
            workspaceRootPath: runtime.workspaceRoot,
            eventCollector: runtime.eventCollector,
            userInput: '继续刚才第二步。',
            bindWorkspace: true,
            historyMessages: [
              buildHistoryMessage({
                id: 'm1',
                sessionId,
                role: 'user',
                content: '请继续按 workspace 中 plan.txt 里的步骤执行。',
                timestamp: 1
              }),
              buildHistoryMessage({
                id: 'm2',
                sessionId,
                role: 'assistant',
                content: '我会根据 plan.txt 继续后续步骤。',
                timestamp: 2
              })
            ]
          })

          return { finalState }
        },
        assert: async (result, runtime) => {
          const contextTaskIds = runtime.eventCollector
            .snapshot()
            .filter(
              (event) => event.type === 'task_delivery_ready' && event.taskId.startsWith('context-')
            )
            .map((event) => event.taskId)

          recordAssertion(runtime.assertions, {
            id: 'context.live.delivery.non-empty',
            pass: Boolean(result.finalState.finalDeliveryMarkdown && result.finalState.finalDeliveryMarkdown.trim()),
            details: result.finalState.finalDeliveryMarkdown || 'empty final delivery'
          })
          recordAssertion(runtime.assertions, {
            id: 'context.live.rounds-bounded',
            pass: result.finalState.contextRounds <= 2,
            details: `contextRounds=${result.finalState.contextRounds}`
          })
          recordAssertion(runtime.assertions, {
            id: 'context.live.context-events-match-rounds',
            pass:
              result.finalState.contextRounds === 0 ||
              contextTaskIds.length === result.finalState.contextRounds,
            details: `rounds=${result.finalState.contextRounds}, contextTaskIds=${contextTaskIds.join(',')}`
          })
        }
      })

      const report = await readLatestCaseReportArtifacts('main-ai-runtime', caseId)
      expect(report.metrics.contextRoundCount).toBeGreaterThanOrEqual(0)
      expect(report.metrics.contextRoundCount).toBeLessThanOrEqual(2)
      expect(report.signals.contextEvidenceItems).toBeDefined()
    },
    240000
  )

  test.skipIf(!isLiveSuiteEnabled())(
    'live context should preserve insufficient local-evidence semantics',
    async () => {
      const caseId = 'context-local-evidence-insufficient'
      const caseMetadata = {
        description: '验证 live main runtime 在本地证据不足时不会把 context 往返伪装成已澄清事实。',
        taskGoal: '继续上次那个问题，只用当前本地资料告诉我 Project Atlas 的负责人；若证据不足必须显式说明。',
        scenarioTags: ['runtime', 'main-context', 'live', 'local-evidence-insufficient'],
        expectedOutcome: 'blocked',
        requiredFixtures: [],
        retentionTier: 'live-eval',
        lifecycle: 'active',
        runPolicy: 'batch_only',
        capabilityArea: 'ai-runtime'
      } as const

      await runRuntimeCase({
        caseId,
        description: caseMetadata.description,
        caseMetadata,
        expectedOutcome: caseMetadata.expectedOutcome,
        scenarioTags: caseMetadata.scenarioTags,
        requiredFixtures: caseMetadata.requiredFixtures,
        fixtureCopies: [],
        buildExecutionOutcome: (result) => ({
          status:
            result.finalState.localSourceStatus === 'insufficient' || result.finalState.error
              ? 'blocked'
              : 'completed',
          resultCode:
            result.finalState.localSourceStatus === 'insufficient' || result.finalState.error
              ? 'blocked'
              : 'ok',
          summary: 'live main context local evidence insufficient completed'
        }),
        buildSignalOverrides: (result, runtime) => {
          const contextTaskIds = runtime.eventCollector
            .snapshot()
            .filter(
              (event) => event.type === 'task_delivery_ready' && event.taskId.startsWith('context-')
            )
            .map((event) => event.taskId)
          return {
            contextRoundCount: result.finalState.contextRounds,
            contextEvidenceCount: result.finalState.contextEvidence.length,
            internalContextDeliveryCount: contextTaskIds.length,
            contextFinalRoute:
              result.finalState.finalDeliveryTaskId === 'direct-human'
                ? 'main_direct_human_exec'
                : result.finalState.finalDeliveryTaskId === 'synthesis-human'
                  ? 'main_synthesis_human'
                  : result.finalState.mainStage,
            fellBackByRoundCap: result.finalState.contextRounds >= 2,
            internalContextTaskIds: contextTaskIds,
            contextEvidenceItems: result.finalState.contextEvidence,
            contextResolutionStatus:
              result.finalState.localSourceStatus === 'insufficient' || result.finalState.error
                ? 'unresolved'
                : 'resolved'
          }
        },
        execute: async (runtime) => {
          const sessionId = 'context-local-evidence-insufficient'
          await fs.writeFile(
            path.join(runtime.workspaceRoot, 'atlas-notes.txt'),
            'Project Atlas 会议纪要，仅包含时间安排和议题，没有负责人信息。',
            'utf8'
          )

          const finalState = await runLiveMainRuntime({
            runId: runtime.runId,
            sessionId,
            workspaceRootPath: runtime.workspaceRoot,
            eventCollector: runtime.eventCollector,
            userInput: '继续上次那个问题，只用当前本地资料告诉我 Project Atlas 的负责人。',
            bindWorkspace: true,
            historyMessages: [
              buildHistoryMessage({
                id: 'm1',
                sessionId,
                role: 'user',
                content: '我稍后会继续问你刚才关于 Project Atlas 负责人的问题。',
                timestamp: 1
              }),
              buildHistoryMessage({
                id: 'm2',
                sessionId,
                role: 'assistant',
                content: '我会仅依据你允许的本地资料回答。',
                timestamp: 2
              })
            ]
          })

          return { finalState }
        },
        assert: async (result, runtime) => {
          const blockedLike =
            result.finalState.localSourceStatus === 'insufficient' ||
            Boolean(result.finalState.error) ||
            String(result.finalState.finalDeliveryMarkdown || '').includes('不足')

          recordAssertion(runtime.assertions, {
            id: 'context.live.local-evidence-insufficient',
            pass: blockedLike,
            details: JSON.stringify({
              error: result.finalState.error,
              localSourceStatus: result.finalState.localSourceStatus,
              finalDeliveryMarkdown: result.finalState.finalDeliveryMarkdown
            })
          })
          recordAssertion(runtime.assertions, {
            id: 'context.live.rounds-bounded',
            pass: result.finalState.contextRounds <= 2,
            details: `contextRounds=${result.finalState.contextRounds}`
          })
        }
      })

      const report = await readLatestCaseReportArtifacts('main-ai-runtime', caseId)
      expect(report.metrics.contextRoundCount).toBeGreaterThanOrEqual(0)
      expect(report.signals.contextResolutionStatus).toMatch(/resolved|unresolved|fallback_to_plan/)
    },
    240000
  )
})
