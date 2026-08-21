import { describe, it } from 'vitest'
import {
  appendRoundRecord,
  buildHandExecution,
  buildLearningExecution
} from '../../../../../src/main/services/ai/human/memory/rounds'
import { createBrainNode } from '../../../../../src/main/services/ai/human/node/brainNode'
import { createContextCompactionNode } from '../../../../../src/main/services/ai/human/node/contextCompactionNode'
import { createHumanRuntimeCache } from '../../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../../src/main/services/ai/human/state/schema'
import type { BackendTestRuntime } from '../../../../harness/backend/test-types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, filterAiRunEventsByType } from '../testUtils'

const buildStateWithCompactionHistory = (runtime: BackendTestRuntime) => {
  const baseState = createInitialHumanState({
    taskId: runtime.taskId,
    userInput: '请继续一个已经执行很久的任务。'
  })
  const withRound1 = {
    ...baseState,
    execution: {
      ...baseState.execution,
      contextBudget: {
        evaluationId: 'budget-compaction-quality',
        basis: 'usage_plus_delta',
        budgetTokens: 8_200,
        contextWindowTokens: 9_000,
        compactionTriggerTokens: 7_200,
        hasCompressibleHistory: true,
        usageAvailable: true,
        lastBrainInputTokens: 7_000,
        deltaTokenEstimate: 1_200
      }
    },
    memory: {
      ...baseState.memory,
      taskRun: appendRoundRecord({
        state: baseState,
        thought: {
          next: '先学习 kb-retrieval，建立检索路径。'
        },
        nextAction: {
          action: 'learning',
          wantLearnSkillIds: ['docx-read']
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
  const withRound2 = {
    ...withRound1,
    memory: {
      ...withRound1.memory,
      taskRun: appendRoundRecord({
        state: withRound1,
        thought: {
          next: '第一次读取发布说明，确认当前版本仍缺少审批人。'
        },
        nextAction: {
          action: 'hand',
          calls: [
            {
              toolName: 'terminal_run',
              args: {
                command: 'cat release-notes.txt'
              }
            }
          ]
        },
        execution: buildHandExecution({
          calls: [
            {
              toolName: 'terminal_run',
              args: {
                command: 'cat release-notes.txt'
              }
            }
          ],
          toolResults: [
            {
              toolName: 'terminal_run',
              ok: true,
              data: {
                stdout: '发布说明显示：审批人字段为空。',
                stderr: '',
                command: 'cat release-notes.txt',
                exitCode: 0,
                timedOut: false
              }
            }
          ]
        }),
        createdAt: 2
      })
    }
  }
  const withRound3 = {
    ...withRound2,
    memory: {
      ...withRound2.memory,
      taskRun: appendRoundRecord({
        state: withRound2,
        thought: {
          next: '尝试直接发布，但因为审批未完成被阻断。'
        },
        nextAction: {
          action: 'hand',
          calls: [
            {
              toolName: 'terminal_run',
              args: {
                command: 'release --publish'
              }
            }
          ]
        },
        execution: buildHandExecution({
          calls: [
            {
              toolName: 'terminal_run',
              args: {
                command: 'release --publish'
              }
            }
          ],
          toolResults: [
            {
              toolName: 'terminal_run',
              ok: false,
              data: {
                error: '失败原因：审批未完成，系统禁止继续发布。',
                stdout: '',
                stderr: '发布失败：审批未完成，系统禁止继续发布。',
                command: 'release --publish',
                exitCode: 2,
                timedOut: false
              }
            }
          ]
        }),
        createdAt: 3
      })
    }
  }
  const withRound4 = {
    ...withRound3,
    memory: {
      ...withRound3.memory,
      taskRun: appendRoundRecord({
        state: withRound3,
        thought: {
          next: '改为读取审批记录，确认当前仍受“未审批不可发布”约束。'
        },
        nextAction: {
          action: 'hand',
          calls: [
            {
              toolName: 'terminal_run',
              args: {
                command: 'cat approval-log.txt'
              }
            }
          ]
        },
        execution: buildHandExecution({
          calls: [
            {
              toolName: 'terminal_run',
              args: {
                command: 'cat approval-log.txt'
              }
            }
          ],
          toolResults: [
            {
              toolName: 'terminal_run',
              ok: true,
              data: {
                stdout: '审批记录显示：负责人 Bob 待确认；未审批不可发布。',
                stderr: '',
                command: 'cat approval-log.txt',
                exitCode: 0,
                timedOut: false
              }
            }
          ]
        }),
        createdAt: 4
      })
    }
  }
  const withRound5 = {
    ...withRound4,
    memory: {
      ...withRound4.memory,
      taskRun: appendRoundRecord({
        state: withRound4,
        thought: {
          next: '当前结论已经明确：负责人是 Bob，但审批和上线窗口都未完成。'
        },
        nextAction: {
          action: 'hand',
          calls: [
            {
              toolName: 'terminal_run',
              args: {
                command: 'cat schedule-note.txt'
              }
            }
          ]
        },
        execution: buildHandExecution({
          calls: [
            {
              toolName: 'terminal_run',
              args: {
                command: 'cat schedule-note.txt'
              }
            }
          ],
          toolResults: [
            {
              toolName: 'terminal_run',
              ok: true,
              data: {
                stdout: '上线窗口仍待确认，需先解决窗口冲突。',
                stderr: '',
                command: 'cat schedule-note.txt',
                exitCode: 0,
                timedOut: false
              }
            }
          ]
        }),
        createdAt: 5
      })
    }
  }
  return {
    ...withRound5,
    memory: {
      ...withRound5.memory,
      taskRun: appendRoundRecord({
        state: withRound5,
        thought: {
          next: '最新一轮准备说明：下一步先确认窗口，再推进 Bob 的审批。'
        },
        nextAction: {
          action: 'hand',
          calls: [
            {
              toolName: 'terminal_run',
              args: {
                command: 'echo latest'
              }
            }
          ]
        },
        execution: buildHandExecution({
          calls: [
            {
              toolName: 'terminal_run',
              args: {
                command: 'echo latest'
              }
            }
          ],
          toolResults: [
            {
              toolName: 'terminal_run',
              ok: true,
              data: {
                stdout: 'latest',
                stderr: '',
                command: 'echo latest',
                exitCode: 0,
                timedOut: false
              }
            }
          ]
        }),
        createdAt: 6
      })
    }
  }
}

describe('ai human mock-llm backend', () => {
  it('context-compaction-ratio-and-fact-retention', async () => {
    await runBackendCase({
      caseId: 'context-compaction-ratio-and-fact-retention',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证 scripted compaction 会保留关键事实，后续 brain prompt 使用 compactions，且压缩比例符合预期。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext({
          humanRuntimeOverrides: {
            modelContextWindowTokens: 9_000
          },
          structuredOutputScript: {
            'human.brain': [
              ({ user }) => {
                compactedPromptSeen =
                  user.includes('<compactions>') &&
                  user.includes('审批未完成') &&
                  user.includes('未审批不可发布') &&
                  user.includes('负责人已更新为 Bob') &&
                  !user.includes('尝试直接发布，但因为审批未完成被阻断。') &&
                  user.includes('判断：') &&
                  user.includes('执行：') &&
                  user.includes('最新一轮准备说明：下一步先确认窗口，再推进 Bob 的审批。')
                return buildCompleteTaskDecision({
                  summary: '压缩后的关键信息仍完整。'
                })
              }
            ]
          }
        })
        const cache = createHumanRuntimeCache()
        const compactionNode = createContextCompactionNode({ ctx, cache })
        const brainNode = createBrainNode({ ctx, cache })
        const stateWithHistory = buildStateWithCompactionHistory(runtime)

        let compactedPromptSeen = false
        let compactionPrompt = ''
        const originalChatText = ctx.chatText
        ctx.chatText = async (input) => {
          if (input.caller === 'human.context_compaction') {
            compactionPrompt = input.user
            return [
              '任务锚点：',
              '- 目标：继续一个已经执行很久的任务，并基于已有事实完成后续推进判断。',
              '- 当前交付：保留仍影响任务推进的审批与窗口事实，供后续 brain 继续决策。',
              '- 关键引用锚点：`release-notes.txt`（已读取）；`approval-log.txt`（已读取）；`schedule-note.txt`（已读取）',
              '',
              '已确认事实：',
              '- 已补齐 docx-read 技能。',
              '- 发布说明显示审批人字段为空。',
              '- 审批记录显示负责人已更新为 Bob，且仍有“未审批不可发布”约束。',
              '- 上线窗口仍待确认。',
              '',
              '仍有效约束：',
              '- 审批未完成前不能发布。',
              '- 负责人 Bob 仍待确认。',
              '- 上线窗口冲突尚未解除。',
              '',
              '已尝试但未解决：',
              '- 曾尝试直接发布，但因审批未完成失败，问题仍未解决。',
              '',
              '重复或低价值内容：',
              '- 多次围绕审批状态的读取过程与命令参数已省略，只保留结果事实。',
              '',
              '已失效或仅作背景的信息：',
              '- 较早的技能补齐过程细节仅保留结论。'
            ].join('\n')
          }
          return await originalChatText(input)
        }

        const compactedState = await compactionNode(stateWithHistory)
        const nextState = await brainNode(compactedState)
        const events = runtime.eventCollector.snapshot()
        const roundsBlock = compactedState.memory.taskRun.compactions.find(
          (block) => block.kind === 'rounds'
        )

        return {
          nextState,
          events,
          compactionPrompt,
          compactedPromptSeen,
          roundsBlock,
          remainingRounds: compactedState.memory.taskRun.rounds
        }
      },
      assert: async (result, runtime) => {
        const startedEvents = filterAiRunEventsByType(result.events, 'context_compaction_started')
        const completedEvents = filterAiRunEventsByType(
          result.events,
          'context_compaction_completed'
        )
        const completedEvent = completedEvents[0]
        const ratio =
          result.roundsBlock?.sourceHistoryTokenEstimate &&
          result.roundsBlock.tokenEstimateAfter !== undefined
            ? result.roundsBlock.tokenEstimateAfter / result.roundsBlock.sourceHistoryTokenEstimate
            : Number.POSITIVE_INFINITY

        runtime.assertThat(
          result.nextState.execution.stage === 'mouth' &&
            startedEvents.length === 1 &&
            completedEvents.length === 1 &&
            Boolean(result.compactionPrompt.includes('<user_goal>')) &&
            Boolean(result.compactionPrompt.includes('<history_rounds>')) &&
            Boolean(result.compactionPrompt.includes('失败原因：审批未完成')) &&
            Boolean(result.compactionPrompt.includes('负责人 Bob 待确认')) &&
            Boolean(result.roundsBlock?.summary.includes('任务锚点：')) &&
            Boolean(result.roundsBlock?.summary.includes('关键引用锚点：')) &&
            Boolean(result.roundsBlock?.summary.includes('已确认事实：')) &&
            Boolean(result.roundsBlock?.summary.includes('仍有效约束：')) &&
            Boolean(result.roundsBlock?.summary.includes('已尝试但未解决：')) &&
            Boolean(result.roundsBlock?.summary.includes('重复或低价值内容：')) &&
            Boolean(result.roundsBlock?.summary.includes('已失效或仅作背景的信息：')) &&
            Boolean(result.roundsBlock?.summary.includes('审批未完成')) &&
            Boolean(result.roundsBlock?.summary.includes('未审批不可发布')) &&
            Boolean(result.roundsBlock?.summary.includes('负责人已更新为 Bob')) &&
            Boolean(result.roundsBlock?.summary.includes('上线窗口仍待确认')) &&
            !result.roundsBlock?.summary.includes('结果与已有摘要一致') &&
            !result.roundsBlock?.summary.includes('已经读过了') &&
            result.remainingRounds.length === 1 &&
            result.remainingRounds[0]?.roundId === 6 &&
            result.compactedPromptSeen &&
            completedEvent?.sourceHistoryTokenEstimate ===
              result.roundsBlock?.sourceHistoryTokenEstimate &&
            ratio <= 0.45,
          {
            name: 'context-compaction-ratio-and-fact-retention-holds',
            message:
              '压缩应保留失败原因、约束和当前结论，后续 prompt 使用 compactions，且 source history 压缩比例符合 mock 预期。',
            data: {
              ratio,
              startedEvents,
              completedEvents,
              roundsBlock: result.roundsBlock,
              remainingRounds: result.remainingRounds
            }
          }
        )
      }
    })
  })
})
