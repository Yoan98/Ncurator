import { describe, it } from 'vitest'
import { createHandNode } from '../../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../../src/main/services/ai/human/state/schema'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('ai tool hand backend', () => {
  it('hand-invalid-tool-input', async () => {
    await runBackendCase({
      caseId: 'hand-invalid-tool-input',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证双层嵌套坏参数会被工具层 schema 校验拒绝并产生失败的工具结果。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()

        ensureSkillTools({
          cache,
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          skillId: 'docx-write'
        })

        const baseState = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '请测试 hand 工具参数非法'
        })
        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...baseState,
          skills: {
            learnedSkillIds: ['docx-write']
          },
          execution: {
            ...baseState.execution,
            pendingRound: {
              thought: {
                text: '给一个双层嵌套的坏 docx_edit'
              },
              nextAction: {
                action: 'hand',
                calls: [
                  {
                    toolCallId: 'call-0',
                    toolName: 'docx_edit',
                    args: {
                      toolName: 'docx_edit',
                      args: {
                        sourcePath: 'broken.docx',
                        actions: [
                          {
                            type: 'insert_blocks',
                            blocks: [
                              {
                                type: 'paragraph',
                                text: 'hello'
                              }
                            ]
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
            typeof toolResult.data?.error === 'string' &&
            toolResult.data.error.includes('did not match expected schema'),
          {
            name: 'hand-invalid-tool-input-rejects-nested-args',
            message: '双层嵌套坏参数应由工具层 schema 校验拒绝，并产生失败的工具结果。',
            data: {
              toolResult
            }
          }
        )
      }
    })
  })
})
