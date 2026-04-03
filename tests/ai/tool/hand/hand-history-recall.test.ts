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
          userInput: '回看之前与 docx 预览相关的历史执行情况'
        })

        const stateWithLearningRound = {
          ...initialState,
          processMemory: appendRoundRecord({
            state: initialState,
            decision: {
              memoryOps: [],
              decision: {
                summary: '学习 docx-delivery',
                reason: '后续需要生成预览。',
                expectedOutcome: '补齐预览交付能力。'
              },
              readyToDeliver: false,
              nextAction: {
                action: 'learning',
                wantLearnSkillIds: ['docx-delivery']
              }
            },
            execution: buildLearningExecution({
              learningOutcome: {
                requestedSkillIds: ['docx-delivery'],
                loadedSkillIds: ['docx-delivery'],
                skippedDuplicateSkillIds: [],
                skippedUnknownSkillIds: [],
                evictedSkillIds: [],
                activeToolCount: 3
              }
            }),
            createdAt: 1
          })
        }

        const stateWithHandRound = {
          ...stateWithLearningRound,
          processMemory: appendRoundRecord({
            state: stateWithLearningRound,
            decision: {
              memoryOps: [],
              decision: {
                summary: '生成 docx 预览',
                reason: '已经具备 delivery 能力，可以生成预览。',
                expectedOutcome: '拿到 preview artifact。'
              },
              readyToDeliver: false,
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: [
                    {
                      toolName: 'docx_render_preview',
                      args: {
                        docId: 'doc-1'
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
                    toolName: 'docx_render_preview',
                    args: {
                      docId: 'doc-1'
                    }
                  }
                ]
              },
              toolResults: [
                {
                  toolName: 'docx_render_preview',
                  ok: true,
                  code: 'ok',
                  data: {
                    ok: true,
                    code: 'ok',
                    summary: 'preview generated (html)',
                    previewPath: '/tmp/preview.docx'
                  }
                }
              ]
            }),
            createdAt: 2
          }),
          lastBrainDecision: {
            memoryOps: [],
            decision: {
              summary: '回看 docx 预览相关历史',
              reason: '最近历史摘要还不够，需要看更详细的旧轮次。',
              expectedOutcome: '加载到包含 docx_render_preview 的旧历史。'
            },
            readyToDeliver: false,
            nextAction: {
              action: 'hand',
              toolUsePlan: {
                mode: 'parallel',
                calls: [
                  {
                    toolName: 'history_recall',
                    args: {
                      executionKinds: ['hand'],
                      toolNames: ['docx_render_preview'],
                      limit: 1
                    }
                  }
                ]
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
        const loadedRounds = result.nextState.processMemory.loadedHistoryContext?.rounds || []
        const latestRound = result.nextState.processMemory.roundHistory.at(-1)

        runtime.assertThat(
          result.nextState.lastToolUseResults?.[0]?.toolName === 'history_recall' &&
            loadedRounds.length === 1 &&
            loadedRounds[0]?.roundId === 2 &&
            latestRound?.execution.kind === 'hand' &&
            latestRound.execution.toolResults[0]?.toolName === 'history_recall',
          {
            name: 'history-recall-loads-old-rounds',
            message: 'history_recall 应通过 hand 真实执行，并把匹配到的旧历史写入 loaded_history_context。',
            data: {
              lastToolUseResults: result.nextState.lastToolUseResults,
              loadedHistoryContext: result.nextState.processMemory.loadedHistoryContext,
              latestRound
            }
          }
        )
      }
    })
  })
})
