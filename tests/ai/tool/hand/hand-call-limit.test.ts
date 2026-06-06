import { describe, it } from 'vitest'
import { HUMAN_HAND_CALL_LIMIT } from '../../../../src/main/services/ai/human/constants'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const isWindows = process.platform === 'win32'

describe('ai tool hand backend', () => {
  it('hand-call-limit', async () => {
    await runBackendCase({
      caseId: 'hand-call-limit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证 hand 会在执行前拦截超过单轮调用上限的 calls。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()

        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'terminal' })

        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: '请执行多个终端安全指令'
          }),
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '请执行多个终端安全指令'
            }).execution,
            currentThought: {
              thought: {
                next: '提交超长 calls'
              },
              nextAction: {
                action: 'hand',
                calls: Array.from({ length: HUMAN_HAND_CALL_LIMIT + 1 }, () => ({
                  toolName: 'terminal_run',
                  args: {
                    command: isWindows ? 'Get-Location' : 'pwd'
                  }
                }))
              }
            }
          }
        })

        return { state }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.state.execution.pendingDecisionHint?.code === 'hand_call_limit_exceeded' &&
            result.state.execution.pendingDecisionHint.detail.limit === HUMAN_HAND_CALL_LIMIT &&
            result.state.execution.pendingDecisionHint.detail.callCount === HUMAN_HAND_CALL_LIMIT + 1 &&
            result.state.execution.lastToolResults === undefined,
          {
            name: 'hand-call-limit-blocks-oversized-calls-before-execution',
            message: 'calls 超出单轮调用上限时，应在执行前直接返回 hand_call_limit_exceeded。',
            data: {
              decisionHint: result.state.execution.pendingDecisionHint,
              lastToolResults: result.state.execution.lastToolResults
            }
          }
        )
      }
    })
  })
})
