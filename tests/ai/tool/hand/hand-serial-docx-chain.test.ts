import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('ai tool hand backend', () => {
  it('hand-serial-docx-chain', async () => {
    await runBackendCase({
      caseId: 'hand-serial-docx-chain',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证 hand 在 serial 模式下可以顺序执行 docx 写入和读回确认链路。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'serial-docx-chain.docx', [
          {
            type: 'heading',
            text: 'Weekly Risk Report',
            level: 1
          },
          {
            type: 'paragraph',
            text: '本周风险结论：RISK_TODO'
          },
          {
            type: 'paragraph',
            text: '负责人说明：OWNER_TODO'
          }
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
            userInput: '请顺序完成风险周报文档修改与预览'
          }),
          skills: {
            learnedSkillIds: ['docx-read', 'docx-write']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '请顺序完成风险周报文档修改与预览'
            }).execution,
            currentThought: {
              thought: {
                next: '串行完成 docx 编辑链路'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: [
                    {
                      toolName: 'docx_text_edit',
                      args: {
                        sourcePath: 'serial-docx-chain.docx',
                        query: 'RISK_TODO',
                        replace: '待跟进'
                      }
                    },
                    {
                      toolName: 'docx_read_blocks',
                      args: {
                        sourcePath: 'serial-docx-chain.docx',
                        fromBlockId: 'b:1'
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
        const toolNames = result.state.execution.lastToolResults?.map((item) => item.toolName) || []

        runtime.assertThat(
          toolNames.join(',') === 'docx_text_edit,docx_read_blocks' &&
            result.state.execution.lastToolResults?.every((item) => item.code === 'ok') &&
            result.state.execution.watchHint?.code === 'docx_write_requires_readback',
          {
            name: 'serial-docx-chain-executes-in-order',
            message: 'serial 模式应按顺序执行 docx_text_edit、docx_read_blocks，并在写后留下必须 readback 的 watch hint。',
            data: {
              toolNames,
              lastToolUseResults: result.state.execution.lastToolResults,
              watchHint: result.state.execution.watchHint
            }
          }
        )

        runtime.assertThat(
          result.state.execution.artifacts.length === 0 &&
            result.state.execution.lastToolResults?.[1]?.toolName === 'docx_read_blocks',
          {
            name: 'serial-docx-chain-stays-within-edit-and-read-tools',
            message: 'docx 编辑的 hand 链路不再产出交付 artifact；后续交付由工程侧审阅稿/工作稿链路收口。',
            data: {
              artifacts: result.state.execution.artifacts,
              lastToolUseResults: result.state.execution.lastToolResults
            }
          }
        )
      }
    })
  })
})
