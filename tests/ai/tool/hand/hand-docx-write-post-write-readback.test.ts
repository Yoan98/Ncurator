import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('ai tool hand backend', () => {
  it('hand-docx-write-produces-post-write-readback', async () => {
    await runBackendCase({
      caseId: 'hand-docx-write-post-write-readback',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证一轮 hand 内发生 docx 写操作后，会返回 postWriteReadback 结果。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'post-write-readback.docx', [
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
            currentThought: {
              thought: {
                next: '执行 docx 写入'
              },
              nextAction: {
                action: 'hand',
                calls: [
                  {
                    toolName: 'docx_edit',
                    args: {
                      sourcePath: 'post-write-readback.docx',
                      actions: [{
                        type: 'replace_text',
                        query: 'Original content.',
                        replace: 'Updated content.'
                      }]
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
        runtime.assertThat(
            result.state.execution.pendingDecisionHint === undefined &&
            result.state.execution.lastToolResults?.[0]?.toolName === 'docx_edit' &&
            result.state.execution.lastToolResults?.[0]?.ok === true &&
            typeof result.state.execution.lastToolResults?.[0]?.data === 'object' &&
            result.state.execution.lastToolResults?.[0]?.data !== null &&
            Array.isArray(
              (result.state.execution.lastToolResults?.[0]?.data as { postWriteReadback?: { regions?: unknown[] } }).postWriteReadback?.regions
            ),
          {
            name: 'docx-write-produces-post-write-readback',
            message: '只要 hand 成功执行过 docx 写，就应返回 postWriteReadback，且不再产生旧写后阻断。',
            data: {
              lastToolResults: result.state.execution.lastToolResults
            }
          }
        )
      }
    })
  })
})
