import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('ai tool hand backend', () => {
  it('hand-docx-batch-write-limit', async () => {
    await runBackendCase({
      caseId: 'hand-docx-batch-write-limit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证 docx 串行批量写超过限制时会在执行前被阻止。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()

        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-write' })

        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: '请批量写入 docx'
          }),
          skills: {
            learnedSkillIds: ['docx-write']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '请批量写入 docx'
            }).execution,
            currentDecision: {
              decision: {
                summary: '尝试提交超限 docx 批量写',
                reason: '验证 hand 对 docx batch limit 的拦截。',
                expectedOutcome: '直接返回 hand_plan_invalid。'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: Array.from({ length: 6 }, (_, index) => ({
                    toolName: 'docx_paragraph_edit',
                    args: {
                      sourcePath: 'batch-limit.docx',
                      action: 'replace_text',
                      blockId: `b:${String(index)}`,
                      text: `Paragraph ${String(index)}`
                    }
                  }))
                }
              }
            }
          }
        })

        return {
          state
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.state.execution.watchHint?.code === 'hand_plan_invalid' &&
            result.state.execution.watchHint.detail.reason === 'docx_batch_write_limit_exceeded' &&
            result.state.execution.watchHint.detail.limit === 5,
          {
            name: 'docx-batch-write-limit-blocks-oversized-plan',
            message: '纯 docx 段落批量写超过 5 个时，应在执行前直接阻止。',
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
