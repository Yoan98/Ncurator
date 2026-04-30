import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('ai tool hand backend', () => {
  it('hand-docx-write-requires-readback-watchhint', async () => {
    await runBackendCase({
      caseId: 'hand-docx-write-requires-readback-watchhint',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证一轮 hand 内只要发生 docx 写操作，就会产出必须 readback 的 watch hint。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'readback-required.docx', [
          { type: 'paragraph', text: 'Original content.' }
        ])

        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()

        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-read' })
        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-write' })

        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: '请修改文档'
          }),
          skills: {
            learnedSkillIds: ['docx-read', 'docx-write']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '请修改文档'
            }).execution,
            currentDecision: {
              decision: {
                summary: '执行 docx 写入',
                reason: '验证写后收敛提示。',
                expectedOutcome: '触发写后必须 readback 的 watch hint。'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: [
                    {
                      toolName: 'docx_text_edit',
                      args: {
                        sourcePath: 'readback-required.docx',
                        query: 'Original content.',
                        replace: 'Updated content.'
                      }
                    }
                  ]
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
          result.state.execution.watchHint?.code === 'docx_write_requires_readback' &&
            result.state.execution.lastToolResults?.[0]?.toolName === 'docx_text_edit' &&
            result.state.execution.lastToolResults?.[0]?.code === 'ok',
          {
            name: 'docx-write-produces-readback-watchhint',
            message: '只要 hand 成功执行过 docx 写，就应把 execution.watchHint 置为 docx_write_requires_readback。',
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
