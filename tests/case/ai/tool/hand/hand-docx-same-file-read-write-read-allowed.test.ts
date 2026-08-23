import { describe, it } from 'vitest'
import path from 'node:path'
import { createHandNode } from '../../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../../src/main/services/ai/human/state/schema'
import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('ai tool hand backend', () => {
  it('hand-docx-same-file-read-write-read-allowed', async () => {
    await runBackendCase({
      caseId: 'hand-docx-same-file-read-write-read-allowed',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证同一文件同轮 read -> docx_edit -> read 允许通过。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'same-file-read-write-read.docx', [
          { type: 'paragraph', text: 'Alpha' }
        ])

        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()
        ensureSkillTools({
          cache,
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          skillId: 'docx-read'
        })
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
            userInput: '读取后修改再读取'
          }),
          skills: {
            learnedSkillIds: ['docx-read', 'docx-write']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '读取后修改再读取'
            }).execution,
            pendingRound: {
              thought: {
                text: '先读，再写，再读同一 docx'
              },
              nextAction: {
                action: 'hand',
                calls: [
                  {
                    toolCallId: 'call-0',
                    toolName: 'docx_read_outline',
                    args: {
                      sourcePath: path.join(runtime.workspaceRoot, 'same-file-read-write-read.docx'),
                      ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 10 }]
                    }
                  },
                  {
                    toolCallId: 'call-1',
                    toolName: 'docx_edit',
                    args: {
                      sourcePath: path.join(runtime.workspaceRoot, 'same-file-read-write-read.docx'),
                      actions: [
                        {
                          type: 'replace_text',
                          query: 'Alpha',
                          replace: 'Alpha updated'
                        }
                      ]
                    }
                  },
                  {
                    toolCallId: 'call-2',
                    toolName: 'docx_read_blocks',
                    args: {
                      sourcePath: path.join(runtime.workspaceRoot, 'same-file-read-write-read.docx'),
                      range: { type: 'block_index', fromBlockIndex: 0, toBlockIndex: 0 }
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
          results.length === 3 &&
            results.map((item) => item.toolName).join(',') ===
              'docx_read_outline,docx_edit,docx_read_blocks' &&
            results.every((item) => item.ok) &&
            typeof results[2]?.data === 'object' &&
            results[2]?.data !== null &&
            JSON.stringify(results[2].data).includes('Alpha updated'),
          {
            name: 'same-file-read-write-read-plan-is-allowed',
            message: '同一文件的读写混排应允许通过。',
            data: {
              lastToolResults: results
            }
          }
        )
      }
    })
  })
})
