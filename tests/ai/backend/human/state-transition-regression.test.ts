import { test } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { createLearningNode } from '../../../../src/main/services/ai/human/node/learningNode'
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
      'human state defaults stay aligned with the shared factory and learning/hand watchHint branches return to brain through the shared transition helper.',
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

      return {
        initialState,
        schemaDefaultTask,
        schemaDefaultBrainMemory,
        learningResult,
        handResult,
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

      const watchHintEvents = result.events.filter((event) => isEventType(event, 'watch_hint'))
      runtime.assertThat(
        watchHintEvents.length === 2 &&
          watchHintEvents.some((event) => event.taskId === 'learning-watch-hint') &&
          watchHintEvents.some((event) => event.taskId === 'hand-watch-hint'),
        {
          name: 'human-watchhint-events',
          message:
            'learning and hand guard branches should still emit watch_hint events after the shared helper extraction',
          data: watchHintEvents
        }
      )
    }
  })
})
