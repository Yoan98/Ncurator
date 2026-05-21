import { describe, it } from 'vitest'
import { HUMAN_DOCX_BATCH_WRITE_LIMIT } from '../../../../src/main/services/ai/human/constants'
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
      description: '验证 docx 串行批量写超过单轮上限时会在执行前被阻止。',
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
            currentThought: {
              thought: {
                next: '尝试提交超限 docx 批量写'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: Array.from({ length: HUMAN_DOCX_BATCH_WRITE_LIMIT + 1 }, (_, index) => ({
                    toolName: 'docx_text_edit',
                    args: {
                      sourcePath: 'batch-limit.docx',
                      query: `Paragraph ${String(index)}`,
                      replace: `Paragraph ${String(index)} updated`,
                      blockIds: [`b:${String(index)}`]
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
          result.state.execution.pendingDecisionHint?.code === 'hand_plan_invalid' &&
            result.state.execution.pendingDecisionHint.detail.reason === 'docx_batch_write_limit_exceeded' &&
            result.state.execution.pendingDecisionHint.detail.limit === HUMAN_DOCX_BATCH_WRITE_LIMIT,
          {
            name: 'docx-batch-write-limit-blocks-oversized-plan',
            message: `纯 docx 段落批量写超过 ${String(HUMAN_DOCX_BATCH_WRITE_LIMIT)} 个时，应在执行前直接阻止。`,
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
