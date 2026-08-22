import { describe, it } from 'vitest'
import path from 'node:path'
import { createHandNode } from '../../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../../src/main/services/ai/human/state/schema'
import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('ai tool hand backend', () => {
  it('hand-docx-single-file-multi-write-allowed', async () => {
    await runBackendCase({
      caseId: 'hand-docx-single-file-multi-write-allowed',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证同一文件一轮 hand 内允许按顺序执行多次 docx_edit。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'same-file-multi-write.docx', [
          { type: 'paragraph', text: 'Alpha TODO' },
          { type: 'paragraph', text: 'Beta TODO' }
        ])

        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()

        ensureSkillTools({
          cache,
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          skillId: 'docx-write'
        })

        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: '请在同一文档里连续写两次'
          }),
          skills: {
            learnedSkillIds: ['docx-write']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '请在同一文档里连续写两次'
            }).execution,
            pendingRound: {
              thought: {
                text: '对同一 docx 连续执行两次写'
              },
              nextAction: {
                action: 'hand',
                calls: [
                  {
                    toolName: 'docx_edit',
                    args: {
                      sourcePath: path.join(runtime.workspaceRoot, 'same-file-multi-write.docx'),
                      actions: [
                        {
                          type: 'replace_text',
                          query: 'Alpha TODO',
                          replace: 'Alpha done'
                        }
                      ]
                    }
                  },
                  {
                    toolName: 'docx_edit',
                    args: {
                      sourcePath: path.join(runtime.workspaceRoot, 'same-file-multi-write.docx'),
                      actions: [
                        {
                          type: 'replace_text',
                          query: 'Beta TODO',
                          replace: 'Beta done'
                        }
                      ]
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
        const results = result.state.execution.lastToolResults || []
        runtime.assertThat(
          result.state.execution.pendingDecisionHint === undefined &&
            results.length === 2 &&
            results.every((item) => item.toolName === 'docx_edit' && item.ok),
          {
            name: 'same-file-multi-write-plan-is-executed',
            message: '同一文件多次 docx_edit 应按 hand 顺序执行，不再被预拦截。',
            data: {
              decisionHint: result.state.execution.pendingDecisionHint,
              lastToolResults: results
            }
          }
        )
      }
    })
  })
})
