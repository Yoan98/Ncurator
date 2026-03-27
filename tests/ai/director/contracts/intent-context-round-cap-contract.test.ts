import { describe, it } from 'vitest'
import { createIntentNode } from '../../../../src/main/services/ai/director/node/intentNode'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createTestDirectorState } from '../testUtils'

describe('ai director contracts backend', () => {
  it('intent-context-round-cap-contract', async () => {
    await runBackendCase({
      caseId: 'intent-context-round-cap-contract',
      domain: 'ai',
      suite: 'director',
      groups: ['contracts'],
      description: '验证 director_intent 在 context 轮次达到上限后直接转入 plan，不再继续补上下文。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let chatStructuredCalls = 0
        const ctx = runtime.createAiRunContext({
          chatStructuredOverride: async () => {
            chatStructuredCalls += 1
            throw new Error('context 轮次达到上限后不应再调用 chatStructured')
          }
        })
        const node = createIntentNode({
          ctx,
          maxContextRounds: 2
        })

        const patch = await node(
          createTestDirectorState({
            runId: runtime.runId,
            input: '继续上一次未完成的复杂任务，并补齐缺失信息。',
            contextRounds: 2,
            contextObjective: '旧的 context 目标应被清空'
          })
        )

        return {
          patch,
          chatStructuredCalls
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.patch.directorStage === 'director_plan' &&
            result.patch.contextObjective === undefined &&
            result.chatStructuredCalls === 0,
          {
            name: 'intent-skips-context-when-round-cap-is-hit',
            message:
              'intent-context-round-cap-contract 应在 contextRounds 达到上限后直接进入 director_plan，并且不再触发额外的 intent 推理。',
            data: {
              patch: result.patch,
              chatStructuredCalls: result.chatStructuredCalls
            }
          }
        )
      }
    })
  })
})
