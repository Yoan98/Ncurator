import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { createDocxToolHarness, writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { executeToolCall } from '../../../../src/main/services/ai/human/node/handNode/toolExecutor'
import type { DocxOutlineResult } from '../docx/testUtils'

describe('ai tool hand backend', () => {
  it('hand-docx-serial-successor-chain', async () => {
    await runBackendCase({
      caseId: 'hand-docx-serial-successor-chain',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证同一批 docx 串行写中，replace 后继续 insert_after 同锚点时能通过 live resolve 与 continuation 继续成功。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'successor-chain.docx', [
          { type: 'paragraph', text: '项目对外同步周报' },
          { type: 'paragraph', text: '二、主要风险与当前卡点' },
          { type: 'paragraph', text: '主要风险：RISK_TODO' }
        ])

        const harness = createDocxToolHarness(runtime)
        const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
          sourcePath: 'successor-chain.docx'
        })
        await harness.release()

        const riskBlockId =
          outline.blocks.find(
            (block) => block.type === 'paragraph' && block.preview.includes('主要风险：RISK_TODO')
          )?.blockId || ''

        const ctx = runtime.createAiRunContext()
        const cache = createHumanRuntimeCache()
        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-read' })
        ensureSkillTools({ cache, ctx, runId: runtime.runId, taskId: runtime.taskId, skillId: 'docx-write' })

        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: '请完成风险周报剩余章节'
          }),
          skills: {
            learnedSkillIds: ['docx-read', 'docx-write']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '请完成风险周报剩余章节'
            }).execution,
            currentThought: {
              thought: {
                next: '串行补全风险周报章节'
              },
              nextAction: {
                action: 'hand',
                toolUsePlan: {
                  mode: 'serial',
                  calls: [
                    {
                      toolName: 'docx_paragraph_edit',
                      args: {
                        sourcePath: 'successor-chain.docx',
                        action: 'replace_text',
                        blockId: riskBlockId,
                        text: '主要风险：最后一份合规附件仍在内部确认流程中。'
                      }
                    },
                    {
                      toolName: 'docx_paragraph_edit',
                      args: {
                        sourcePath: 'successor-chain.docx',
                        action: 'insert_after',
                        anchorBlockId: riskBlockId,
                        text: '三、负责人及协同分工'
                      }
                    },
                    {
                      toolName: 'docx_paragraph_edit',
                      args: {
                        sourcePath: 'successor-chain.docx',
                        action: 'insert_after',
                        anchorBlockId: riskBlockId,
                        text: '四、下周动作'
                      }
                    }
                  ]
                }
              }
            }
          }
        })

        const updatedOutline = await executeToolCall({
          ctx,
          cache,
          taskId: runtime.taskId,
          learnedSkillIds: ['docx-read', 'docx-write'],
          toolName: 'docx_outline',
          args: {
            sourcePath: 'successor-chain.docx',
            maxBlocks: 20
          }
        })

        return {
          state,
          updatedOutline
        }
      },
      assert: async (result, runtime) => {
        const outline = result.updatedOutline.data as DocxOutlineResult
        const previews = outline.blocks
          .filter((block) => block.type === 'paragraph')
          .map((block) => block.preview)
        runtime.assertThat(
          result.state.execution.lastToolResults?.length === 3 &&
            result.state.execution.lastToolResults.every((item) => item.code === 'ok') &&
            previews.includes('主要风险：最后一份合规附件仍在内部确认流程中。') &&
            previews.includes('三、负责人及协同分工') &&
            previews.includes('四、下周动作'),
          {
            name: 'serial-successor-chain-completes-with-live-resolve',
            message: '同批 replace 后继续 insert_after 同锚点时，应通过 successor/live resolve 与 continuation 继续成功，而不是因旧 blockId 失效中断。',
            data: {
              lastToolResults: result.state.execution.lastToolResults,
              watchHint: result.state.execution.watchHint,
              outline: outline.blocks
            }
          }
        )
      }
    })
  })
})
