import { describe, it } from 'vitest'
import {
  appendRoundRecord,
  buildHandExecution,
  buildLearningExecution
} from '../../../../src/main/services/ai/human/memory/rounds'
import { createContextCompactionNode } from '../../../../src/main/services/ai/human/node/contextCompactionNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { loadLiveLlmConfigFromEnv, hasLiveLlmConfigInEnv } from '../../../harness/backend/llmConfig'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { BackendTestRuntime } from '../../../harness/backend/test-types'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const buildStateWithCompactionHistory = (runtime: BackendTestRuntime) => {
  const baseState = createInitialHumanState({
    taskId: runtime.taskId,
    userInput: '请继续一个会触发历史压缩的长任务。'
  })
  const withRound1 = {
    ...baseState,
    execution: {
      ...baseState.execution,
      contextBudget: {
        evaluationId: 'budget-live-compaction-quality',
        tokenEstimate: 9_600,
        contextWindowTokens: 10_000,
        compactionTriggerTokens: 8_000,
        hasCompressibleHistory: true
      }
    },
    memory: {
      ...baseState.memory,
      taskRun: appendRoundRecord({
        state: baseState,
        thought: {
          thought: {
            next: '先学习 docx-read，建立读取路径。'
          },
          nextAction: {
            action: 'learning',
            wantLearnSkillIds: ['docx-read']
          }
        },
        execution: buildLearningExecution({
          learningOutcome: {
            requestedSkillIds: ['docx-read'],
            loadedSkillIds: ['docx-read'],
            skippedDuplicateSkillIds: [],
            skippedUnknownSkillIds: [],
            evictedSkillIds: [],
            activeToolCount: 4
          }
        }),
        createdAt: 1
      })
    }
  }
  const roundSpecs = [
    {
      createdAt: 2,
      next: '第一次读取发布说明，确认审批人字段为空。',
      command: 'cat release-notes.txt',
      ok: true,
      code: 'ok' as const,
      outputPreview: '发布说明显示：审批人字段为空。'
    },
    {
      createdAt: 3,
      next: '错误地尝试直接发布，但因为审批未完成被阻断。',
      command: 'release --publish',
      ok: false,
      code: 'failed' as const,
      outputPreview: '发布失败：审批未完成，系统禁止继续发布。',
      diagnostic: '失败原因：审批未完成，系统禁止继续发布。'
    },
    {
      createdAt: 4,
      next: '回到审批记录，确认仍受“未审批不可发布”约束。',
      command: 'cat approval-log.txt',
      ok: true,
      code: 'ok' as const,
      outputPreview: '审批记录显示：负责人 Bob 待确认；未审批不可发布。'
    },
    {
      createdAt: 5,
      next: '当前结论是负责人已更新为 Bob，但上线窗口仍待确认。',
      command: 'cat schedule-note.txt',
      ok: true,
      code: 'ok' as const,
      outputPreview: '上线窗口仍待确认，需先解决窗口冲突。'
    },
    {
      createdAt: 6,
      next: '最新一轮原文保留：下一步先确认窗口，再推进 Bob 的审批。',
      command: 'echo latest',
      ok: true,
      code: 'ok' as const,
      outputPreview: 'latest'
    }
  ]

  return roundSpecs.reduce((state, spec) => ({
    ...state,
    memory: {
      ...state.memory,
      taskRun: appendRoundRecord({
        state,
        thought: {
          thought: {
            next: spec.next
          },
          nextAction: {
            action: 'hand',
            toolUsePlan: {
              mode: 'serial',
              calls: [
                {
                  toolName: 'terminal_run',
                  args: {
                    command: spec.command
                  }
                }
              ]
            }
          }
        },
        execution: buildHandExecution({
          toolUsePlan: {
            mode: 'serial',
            calls: [
              {
                toolName: 'terminal_run',
                args: {
                  command: spec.command
                }
              }
            ]
          },
          toolResults: [
            {
              toolName: 'terminal_run',
              ok: spec.ok,
              code: spec.code,
              data: spec.ok
                ? {
                    ok: true,
                    code: spec.code,
                    outputPreview: spec.outputPreview,
                    command: spec.command,
                    exitCode: 0,
                    timedOut: false,
                    truncated: false
                  }
                : {
                    ok: false,
                    code: spec.code,
                    stderrPreview: spec.outputPreview,
                    command: spec.command,
                    exitCode: 2,
                    timedOut: false,
                    truncated: false
                  },
              diagnostic: spec.diagnostic ? { message: spec.diagnostic } : undefined
            }
          ]
        }),
        createdAt: spec.createdAt
      })
    }
  }), withRound1)
}

describe('ai human live backend', () => {
  it('human-context-compaction-quality-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-context-compaction-quality-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模式下真实 context_compaction 会显著缩短历史，并保留失败原因、约束和当前结论。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return {
              skipped: true,
              compactedState: null,
              events: []
            }
          }

          const liveConfig = loadLiveLlmConfigFromEnv()
          await runtime.seedLlmConfig(liveConfig)
          const ctx = runtime.createAiRunContext({
            modelName: liveConfig.model_name
          })
          const cache = createHumanRuntimeCache()
          const compactionNode = createContextCompactionNode({ ctx, cache })
          const stateWithHistory = buildStateWithCompactionHistory(runtime)
          const compactedState = await compactionNode(stateWithHistory)

          return {
            skipped: false,
            compactedState,
            events: runtime.eventCollector.snapshot()
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped || !result.compactedState) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human context compaction quality live case。'
            })
            return
          }

          const startedEvents = filterAiRunEventsByType(result.events, 'context_compaction_started')
          const completedEvents = filterAiRunEventsByType(result.events, 'context_compaction_completed')
          const roundsBlock = result.compactedState.memory.taskRun.compactions.find(
            (block) => block.kind === 'rounds'
          )
          const ratio =
            roundsBlock?.sourceHistoryTokenEstimate && roundsBlock.tokenEstimateAfter !== undefined
              ? roundsBlock.tokenEstimateAfter / roundsBlock.sourceHistoryTokenEstimate
              : Number.POSITIVE_INFINITY
          const summary = String(roundsBlock?.summary || '')

          runtime.assertThat(
            startedEvents.length === 1 &&
              completedEvents.length === 1 &&
              Boolean(roundsBlock) &&
              result.compactedState.memory.taskRun.compactions.length === 1 &&
              result.compactedState.memory.taskRun.rounds.length === 1 &&
              result.compactedState.memory.taskRun.rounds[0]?.roundId === 6 &&
              summary.trim().length > 0 &&
              /审批/.test(summary) &&
              /失败|阻断|未完成/.test(summary) &&
              /约束|不可发布|窗口/.test(summary) &&
              /Bob|负责人/.test(summary) &&
              ratio <= 0.5 &&
              completedEvents[0]?.sourceHistoryTokenEstimate === roundsBlock?.sourceHistoryTokenEstimate,
            {
              name: 'human-live-context-compaction-preserves-key-facts',
              message:
                'live context compaction 应保留失败原因、仍生效约束和当前结论，保留 latest round 原文，并把历史压缩到可接受比例。',
              data: {
                startedEvents,
                completedEvents,
                roundsBlock,
                remainingRounds: result.compactedState.memory.taskRun.rounds,
                ratio
              }
            }
          )
        }
      })
    })
  }, 120_000)
})
