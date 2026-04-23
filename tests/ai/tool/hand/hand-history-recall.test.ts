import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import {
  appendRoundRecord,
  buildHandExecution,
  buildLearningExecution
} from '../../../../src/main/services/ai/human/memory/roundHistory'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('ai tool hand backend', () => {
  it('hand-history-recall', async () => {
    await runBackendCase({
      caseId: 'hand-history-recall',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证 builtin history-recall 能通过真实 hand 链路加载旧历史，并写入 loaded_history_context。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()
        const handNode = createHandNode({ ctx, cache })
        const initialState = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '回看之前与 docx 编辑相关的历史执行情况'
        })

        const stateWithLearningRound = {
          ...initialState,
          memory: {
            ...initialState.memory,
            history: appendRoundRecord({
              state: initialState,
              decision: {
                decision: {
                  summary: '学习 docx-write',
                  reason: '后续需要修改文档。',
                  expectedOutcome: '补齐结构化写入能力。'
                },
                nextAction: {
                  action: 'learning',
                  wantLearnSkillIds: ['docx-write']
                }
              },
              execution: buildLearningExecution({
                learningOutcome: {
                  requestedSkillIds: ['docx-write'],
                  loadedSkillIds: ['docx-write'],
                  skippedDuplicateSkillIds: [],
                  skippedUnknownSkillIds: [],
                  evictedSkillIds: [],
                  activeToolCount: 6
                }
              }),
              createdAt: 1
            })
          }
        }

        const stateWithHandRound = {
          ...stateWithLearningRound,
          memory: {
            ...stateWithLearningRound.memory,
            history: appendRoundRecord({
              state: stateWithLearningRound,
              decision: {
                decision: {
                  summary: '执行 docx 编辑',
                  reason: '已经具备 write 能力，可以执行文本替换。',
                  expectedOutcome: '拿到 changedBlocks。'
                },
                nextAction: {
                  action: 'hand',
                  toolUsePlan: {
                    mode: 'serial',
                    calls: [
                      {
                        toolName: 'docx_text_edit',
                        args: {
                          sourcePath: 'history-recall.docx',
                          query: 'old',
                          replace: 'new'
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
                      toolName: 'docx_text_edit',
                      args: {
                        sourcePath: 'history-recall.docx',
                        query: 'old',
                        replace: 'new'
                      }
                    }
                  ]
                },
                toolResults: [
                  {
                    toolName: 'docx_text_edit',
                    ok: true,
                    code: 'ok',
                    resourceContext: {
                      family: 'docx',
                      sourcePath: 'history-recall.docx',
                      previousRevisionRef: 'v1',
                      currentRevisionRef: 'v2',
                      effectKind: 'mutated'
                    },
                    data: {
                      ok: true,
                      code: 'ok',
                      summary: '文本替换完成',
                      sourcePath: 'history-recall.docx',
                      previousRevisionRef: 'v1',
                      currentRevisionRef: 'v2',
                      changedBlocks: [
                        {
                          action: 'replace_text',
                          blockId: 'b:1',
                          beforeText: 'old',
                          afterText: 'new'
                        }
                      ]
                    }
                  }
                ]
              }),
              createdAt: 2
            })
          },
          execution: {
            ...stateWithLearningRound.execution,
            currentDecision: {
              decision: {
                summary: '回看 docx 编辑相关历史',
                reason: '最近历史摘要还不够，需要看更详细的旧轮次。',
                expectedOutcome: '加载到包含 docx_text_edit 的旧历史。'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'parallel',
                  calls: [
                    {
                      toolName: 'history_search',
                      args: {
                        query: 'docx_text_edit',
                        startRoundId: 1,
                        endRoundId: 2,
                        limit: 1
                      }
                    }
                  ]
                }
              }
            }
          }
        }

        const nextState = await handNode(stateWithHandRound)

        return {
          nextState
        }
      },
      assert: async (result, runtime) => {
        const loadedRounds = result.nextState.memory.history.loadedHistoryContext?.rounds || []
        const latestRound = result.nextState.memory.history.roundHistory.at(-1)

        runtime.assertThat(
          result.nextState.execution.lastToolResults?.[0]?.toolName === 'history_search' &&
            loadedRounds.length === 1 &&
            loadedRounds[0]?.roundId === 2 &&
            latestRound?.execution.kind === 'hand' &&
            latestRound.execution.toolResults[0]?.toolName === 'history_search',
          {
            name: 'history-recall-loads-old-rounds',
            message: 'history_search 应通过 hand 真实执行，并把匹配到的旧历史写入 loaded_history_context。',
            data: {
              lastToolUseResults: result.nextState.execution.lastToolResults,
              loadedHistoryContext: result.nextState.memory.history.loadedHistoryContext,
              latestRound
            }
          }
        )
      }
    })
  })
})
