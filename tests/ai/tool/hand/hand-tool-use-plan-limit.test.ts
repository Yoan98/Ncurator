import { describe, it } from 'vitest'
import { HUMAN_TOOL_USE_PLAN_LIMIT } from '../../../../src/main/services/ai/human/constants'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('ai tool hand backend', () => {
  it('hand-tool-use-plan-limit', async () => {
    await runBackendCase({
      caseId: 'hand-tool-use-plan-limit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证 hand 会在执行前拦截超过总计划长度上限的 toolUsePlan。',
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
            userInput: '请执行多个终端只读命令'
          }),
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '请执行多个终端只读命令'
            }).execution,
            currentThought: {
              thought: {
                summary: '提交超长 toolUsePlan'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: Array.from({ length: HUMAN_TOOL_USE_PLAN_LIMIT + 1 }, () => ({
                    toolName: 'terminal_run',
                    args: {
                      command: 'pwd'
                    }
                  }))
                }
              }
            }
          }
        })

        return { state }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.state.execution.watchHint?.code === 'hand_plan_invalid' &&
            result.state.execution.watchHint.detail.reason === 'tool_use_plan_limit_exceeded' &&
            result.state.execution.watchHint.detail.limit === HUMAN_TOOL_USE_PLAN_LIMIT &&
            result.state.execution.watchHint.detail.callCount === HUMAN_TOOL_USE_PLAN_LIMIT + 1 &&
            result.state.execution.lastToolResults === undefined,
          {
            name: 'tool-use-plan-limit-blocks-oversized-plan-before-execution',
            message: 'toolUsePlan 超出总长度上限时，应在执行前直接返回 tool_use_plan_limit_exceeded。',
            data: {
              watchHint: result.state.execution.watchHint,
              lastToolResults: result.state.execution.lastToolResults
            }
          }
        )
      }
    })
  })
})
