import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('ai tool hand backend', () => {
  it('hand-schema-preflight-invalid-input', async () => {
    await runBackendCase({
      caseId: 'hand-schema-preflight-invalid-input',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证 hand preflight schema 失败时稳定返回 invalid_input，并保留具体 diagnostic。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()

        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-write' })

        const baseState = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '请测试 hand preflight schema 失败'
        })
        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...baseState,
          skills: {
            learnedSkillIds: ['docx-write']
          },
          execution: {
            ...baseState.execution,
            currentThought: {
              thought: {
                next: '给一个双层嵌套的坏 docx_create'
              },
              nextAction: {
                action: 'hand',
                calls: [
                  {
                    toolName: 'docx_create',
                    args: {
                      toolName: 'docx_create',
                      args: {
                        sourcePath: 'broken.docx',
                        blocks: [
                          {
                            type: 'paragraph',
                            text: 'hello'
                          }
                        ]
                      }
                    }
                  }
                ]
              }
            }
          }
        })

        return {
          state
        }
      },
      assert: async (result, runtime) => {
        const toolResult = result.state.execution.lastToolResults?.[0]
        runtime.assertThat(
          toolResult?.ok === false &&
            typeof toolResult.diagnostic?.message === 'string' &&
            toolResult.diagnostic.message.includes('calls[0].args') &&
            result.state.execution.pendingDecisionHint?.code === 'hand_call_invalid' &&
            result.state.execution.pendingDecisionHint.detail.invalidCalls[0]?.callIndex === 0,
          {
            name: 'hand-schema-preflight-invalid-input',
            message: 'hand preflight schema 失败时应返回 invalid_input、保留具体 schema diagnostic，并提升为 hand_call_invalid。',
            data: {
              toolResult,
              pendingDecisionHint: result.state.execution.pendingDecisionHint
            }
          }
        )
      }
    })
  })
})
