import { test } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import { createBrainNode } from '../../../../src/main/services/ai/human/node/brainNode'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { createLearningNode } from '../../../../src/main/services/ai/human/node/learningNode'
import { createMouthNode } from '../../../../src/main/services/ai/human/node/mouthNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createHumanRunStateSchema } from '../../../../src/main/services/ai/human/state/schema'
import type { HumanState } from '../../../../src/main/services/ai/human/types'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/utils/state'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const isEventType = <TType extends AiRunEvent['type']>(
  event: AiRunEvent,
  type: TType
): event is Extract<AiRunEvent, { type: TType }> => event.type === type

type SchemaFields = {
  task: { parse: (value: unknown) => HumanState['task'] }
  brainMemory: { parse: (value: unknown) => HumanState['brainMemory'] }
}

test('state-transition-regression', async () => {
  await runBackendCase({
    caseId: 'state-transition-regression',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'human',
    description:
      'human state defaults stay aligned with the shared factory, brain/learning/hand/mouth transitions use the shared transition helpers, and watchHint branches remain recoverable.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const initialState = createInitialHumanState({
        taskId: runtime.taskId,
        userInput: '验证 human state 与 watchHint 回退行为'
      })
      const schemaFields = Reflect.get(
        createHumanRunStateSchema(),
        'fields'
      ) as SchemaFields
      const schemaDefaultTask = schemaFields.task.parse(undefined)
      const schemaDefaultBrainMemory = schemaFields.brainMemory.parse(undefined)

      const ctx = runtime.createAiRunContext()
      const learningNode = createLearningNode({
        ctx,
        cache: createHumanRuntimeCache()
      })
      const duplicateLearningState = createInitialHumanState({
        taskId: 'learning-watch-hint',
        userInput: '重复学习技能'
      })
      duplicateLearningState.brainMemory.outside.learnedSkillIds.push('kb-evidence-query')
      duplicateLearningState.lastBrainDecision = {
        memoryOps: [],
        decision: {
          summary: '重复学习技能',
          reason: '模拟重复学习路径。',
          expectedOutcome: '应直接回到 brain。'
        },
        nextAction: {
          action: 'learning',
          wantLearnSkillIds: ['kb-evidence-query']
        }
      }
      const learningResult = await learningNode(duplicateLearningState)

      const handNode = createHandNode({
        ctx,
        cache: createHumanRuntimeCache()
      })
      const invalidHandState = createInitialHumanState({
        taskId: 'hand-watch-hint',
        userInput: '构造非法并行批次'
      })
      invalidHandState.lastBrainDecision = {
        memoryOps: [],
        decision: {
          summary: '提交非法并行批次',
          reason: '模拟 hand guard 分支。',
          expectedOutcome: '应直接回到 brain。'
        },
        nextAction: {
          action: 'hand',
          parallelCallToolParam: [
            {
              toolName: 'terminal_run_command',
              args: {
                command: 'printf "alpha" > alpha.txt',
                cwd: '.'
              }
            },
            {
              toolName: 'terminal_run_command',
              args: {
                command: 'printf "beta" > beta.txt',
                cwd: '.'
              }
            }
          ]
        }
      }
      const handResult = await handNode(invalidHandState)

      const brainLearningNode = createBrainNode({
        ctx: runtime.createAiRunContext({
          humanReasonOverrides: [
            {
              output: {
                memoryOps: [],
                decision: {
                  summary: '先学习 KB skill',
                  reason: '需要先获得检索能力。',
                  expectedOutcome: '进入 learning 节点。'
                },
                nextAction: {
                  action: 'learning',
                  wantLearnSkillIds: ['kb-evidence-query']
                }
              }
            }
          ]
        }),
        cache: createHumanRuntimeCache()
      })
      const brainLearningResult = await brainLearningNode(
        createInitialHumanState({
          taskId: 'brain-to-learning',
          userInput: '验证 brain 到 learning 的跳转'
        })
      )

      const brainHandNode = createBrainNode({
        ctx: runtime.createAiRunContext({
          humanReasonOverrides: [
            {
              output: {
                memoryOps: [],
                decision: {
                  summary: '直接调用工具',
                  reason: '需要先执行一次知识库检索。',
                  expectedOutcome: '进入 hand 节点。'
                },
                nextAction: {
                  action: 'hand',
                  parallelCallToolParam: [
                    {
                      toolName: 'kb_hybrid_search_chunks',
                      args: {
                        queryText: '项目风险复核要求'
                      }
                    }
                  ]
                }
              }
            }
          ]
        }),
        cache: createHumanRuntimeCache()
      })
      const brainHandResult = await brainHandNode(
        createInitialHumanState({
          taskId: 'brain-to-hand',
          userInput: '验证 brain 到 hand 的跳转'
        })
      )

      const invalidMemoryState = createInitialHumanState({
        taskId: 'brain-invalid-memory',
        userInput: '验证非法 memory op 的回退'
      })
      invalidMemoryState.brainMemory.inside.evidences.push({
        id: 'evidence-1',
        toolName: 'kb_hybrid_search_chunks',
        summary: '已有证据',
        sourceType: 'tool_result'
      })
      const brainInvalidMemoryNode = createBrainNode({
        ctx: runtime.createAiRunContext({
          humanReasonOverrides: [
            {
              output: {
                memoryOps: [
                  {
                    op: 'remove',
                    field: 'evidences',
                    index: 0
                  },
                  {
                    op: 'add',
                    field: 'facts',
                    value: {
                      id: 'fact-invalid',
                      summary: '引用了被删除的证据。',
                      evidenceIds: ['evidence-1']
                    }
                  }
                ],
                decision: {
                  summary: '错误地修改记忆',
                  reason: '模拟非法 memory op。',
                  expectedOutcome: '应回到 brain 并给出 watchHint。'
                },
                nextAction: {
                  action: 'mouth',
                  status: 'completed'
                }
              }
            }
          ]
        }),
        cache: createHumanRuntimeCache()
      })
      const brainInvalidMemoryResult = await brainInvalidMemoryNode(invalidMemoryState)

      const mouthCompletedState = createInitialHumanState({
        taskId: 'mouth-completed',
        userInput: '验证 mouth 完成收口'
      })
      mouthCompletedState.lastBrainDecision = {
        memoryOps: [],
        decision: {
          summary: '可以完成交付',
          reason: '关键事实已经齐备。',
          expectedOutcome: '输出 completed 结果。'
        },
        nextAction: {
          action: 'mouth',
          status: 'completed'
        }
      }
      const mouthCompletedNode = createMouthNode({
        ctx: runtime.createAiRunContext({
          humanDeliveryOverride: () => '# 处理结果\n\n已完成交付。'
        }),
        cache: createHumanRuntimeCache(),
        deliveryMode: 'user_answer',
        streamAnswer: true,
        internalDelivery: false
      })
      const mouthCompletedResult = await mouthCompletedNode(mouthCompletedState)

      const mouthBlockedState = createInitialHumanState({
        taskId: 'mouth-blocked',
        userInput: '验证 mouth 阻塞收口'
      })
      mouthBlockedState.lastBrainDecision = {
        memoryOps: [],
        decision: {
          summary: '当前仍有阻塞',
          reason: '证据不完整。',
          expectedOutcome: '输出 blocked 结果。'
        },
        nextAction: {
          action: 'mouth',
          status: 'blocked'
        }
      }
      const mouthBlockedNode = createMouthNode({
        ctx: runtime.createAiRunContext({
          humanDeliveryOverride: () => '# 处理结果\n\n当前仍有阻塞。'
        }),
        cache: createHumanRuntimeCache(),
        deliveryMode: 'task_handoff',
        streamAnswer: false,
        internalDelivery: true
      })
      const mouthBlockedResult = await mouthBlockedNode(mouthBlockedState)

      return {
        initialState,
        schemaDefaultTask,
        schemaDefaultBrainMemory,
        learningResult,
        handResult,
        brainLearningResult,
        brainHandResult,
        brainInvalidMemoryResult,
        mouthCompletedResult,
        mouthBlockedResult,
        events: runtime.eventCollector.snapshot()
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(
        result.schemaDefaultTask.taskId === '' &&
          result.schemaDefaultTask.userInput === '' &&
          result.schemaDefaultBrainMemory.outside.skillCatalog.length ===
            result.initialState.brainMemory.outside.skillCatalog.length,
        {
          name: 'human-state-factory-alignment',
          message:
            'human state schema defaults should stay aligned with createInitialHumanState and keep the shared skill catalog',
          data: {
            schemaDefaultTask: result.schemaDefaultTask,
            schemaDefaultBrainMemory: result.schemaDefaultBrainMemory,
            initialState: result.initialState
          }
        }
      )

      runtime.assertThat(
        result.learningResult.runtime.stage === 'brain' &&
          Boolean(result.learningResult.watchHint),
        {
          name: 'human-learning-watchhint-return',
          message:
            'duplicate learning should return to brain with watchHint after the shared state transition helper refactor',
          data: result.learningResult
        }
      )

      runtime.assertThat(
        result.handResult.runtime.stage === 'brain' && Boolean(result.handResult.watchHint),
        {
          name: 'human-hand-watchhint-return',
          message:
            'invalid hand batch should return to brain with watchHint after the shared state transition helper refactor',
          data: result.handResult
        }
      )

      runtime.assertThat(
        result.brainLearningResult.runtime.stage === 'learning' &&
          result.brainHandResult.runtime.stage === 'hand',
        {
          name: 'human-brain-next-stage-routing',
          message:
            'brain transition helper should preserve learning and hand next-stage routing after the shared refactor',
          data: {
            brainLearningResult: result.brainLearningResult,
            brainHandResult: result.brainHandResult
          }
        }
      )

      runtime.assertThat(
        result.brainInvalidMemoryResult.runtime.stage === 'brain' &&
          Boolean(result.brainInvalidMemoryResult.watchHint) &&
          result.brainInvalidMemoryResult.brainMemory.inside.evidences.length === 0 &&
          result.brainInvalidMemoryResult.brainMemory.inside.facts.length === 0,
        {
          name: 'human-brain-invalid-memory-recovery',
          message:
            'invalid memory ops should ignore the illegal fact update, preserve valid removals, and return to brain with watchHint after reducer refactor',
          data: result.brainInvalidMemoryResult
        }
      )

      runtime.assertThat(
        result.mouthCompletedResult.runtime.status === 'completed' &&
          result.mouthCompletedResult.result?.status === 'completed' &&
          result.mouthBlockedResult.runtime.status === 'blocked' &&
          result.mouthBlockedResult.result?.status === 'blocked',
        {
          name: 'human-mouth-final-statuses',
          message:
            'mouth transition helper should preserve both completed and blocked final statuses after the shared refactor',
          data: {
            mouthCompletedResult: result.mouthCompletedResult,
            mouthBlockedResult: result.mouthBlockedResult
          }
        }
      )

      const watchHintEvents = result.events.filter((event) => isEventType(event, 'watch_hint'))
      runtime.assertThat(
        watchHintEvents.length === 3 &&
          watchHintEvents.some((event) => event.taskId === 'learning-watch-hint') &&
          watchHintEvents.some((event) => event.taskId === 'hand-watch-hint') &&
          watchHintEvents.some((event) => event.taskId === 'brain-invalid-memory'),
        {
          name: 'human-watchhint-events',
          message:
            'learning, hand, and invalid-memory branches should still emit watch_hint events after the shared helper extraction',
          data: watchHintEvents
        }
      )

      const deliveryEvents = result.events.filter((event) => isEventType(event, 'task_delivery_ready'))
      const answerCompletedEvents = result.events.filter((event) =>
        isEventType(event, 'answer_completed')
      )
      runtime.assertThat(
        deliveryEvents.length === 2 &&
          deliveryEvents.some((event) => event.taskId === 'mouth-completed') &&
          deliveryEvents.some((event) => event.taskId === 'mouth-blocked') &&
          answerCompletedEvents.length === 1 &&
          answerCompletedEvents[0]?.taskId === 'mouth-completed',
        {
          name: 'human-mouth-delivery-events',
          message:
            'mouth helper should preserve task delivery events for completed/blocked outputs and keep answer_completed on streamed final answers',
          data: {
            deliveryEvents,
            answerCompletedEvents
          }
        }
      )
    }
  })
})
