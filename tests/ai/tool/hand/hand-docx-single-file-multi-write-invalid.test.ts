import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('ai tool hand backend', () => {
  it('hand-docx-single-file-multi-write-invalid', async () => {
    await runBackendCase({
      caseId: 'hand-docx-single-file-multi-write-invalid',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证同一文件一轮 hand 内出现两次 docx 写时，会在执行前被阻止。',
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
            currentThought: {
              thought: {
                next: '对同一 docx 连续执行两次写'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: [
                    {
                      toolName: 'docx_heading_edit',
                      args: {
                        sourcePath: 'same-file-invalid.docx',
                        anchorBlockId: 'b:1',
                        action: 'insert_after',
                        headings: [{ level: 2, text: '第一部分' }]
                      }
                    },
                    {
                      toolName: 'docx_paragraph_edit',
                      args: {
                        sourcePath: 'same-file-invalid.docx',
                        anchorBlockId: 'b:2',
                        action: 'insert_after',
                        paragraphs: ['补充说明']
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
          result.state.execution.pendingDecisionHint?.code === 'hand_plan_invalid' &&
            result.state.execution.pendingDecisionHint.detail.reason ===
              'docx_single_file_write_limit_exceeded' &&
            result.state.execution.pendingDecisionHint.detail.limit === 1 &&
            result.state.execution.pendingDecisionHint.detail.sourcePaths?.includes(
              'same-file-invalid.docx'
            ) &&
            result.state.execution.pendingDecisionHint.detail.offendingToolNames.join(',') ===
              'docx_heading_edit,docx_paragraph_edit' &&
            (result.state.execution.lastToolResults || []).length === 0,
          {
            name: 'same-file-multi-write-plan-is-rejected',
            message:
              '同一文件在一轮 hand 中出现第 2 次 docx 写时，应直接返回 hand_plan_invalid，并带稳定 decision hint。',
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
