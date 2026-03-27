import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { createBrainNode } from '../../../../src/main/services/ai/human/node/brainNode'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { createLearningNode } from '../../../../src/main/services/ai/human/node/learningNode'
import { createMouthNode } from '../../../../src/main/services/ai/human/node/mouthNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContextWithHumanOverrides } from '../../../../src/main/services/ai/human/types'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxApplyOpsResult,
  type DocxOpenResult,
  type DocxOutlineResult,
  type DocxPreviewResult,
  findOutlineBlock
} from '../../tool/docx/testUtils'
import {
  buildHumanTaskOutputFromState,
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  createCapturingDeliveryOverride,
  filterAiRunEventsByType,
  readSingleToolResultData,
  summarizeHumanSteps
} from '../testUtils'

describe('ai human scenarios backend', () => {
  it('complex-docx-edit-simulated', async () => {
    await runBackendCase({
      caseId: 'complex-docx-edit-simulated',
      domain: 'ai',
      suite: 'human',
      groups: ['scenarios'],
      description: '验证复杂 docx 编辑任务的非 live 长链路，覆盖读、写、validate 与 preview。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'complex-edit.docx', [
          {
            type: 'heading',
            text: 'Weekly Risk Review',
            level: 1
          },
          {
            type: 'paragraph',
            text: 'Legacy baseline requires an updated owner and status summary.'
          },
          {
            type: 'paragraph',
            text: 'Background note: keep the appendix untouched.'
          },
          {
            type: 'table',
            rows: [
              ['Owner', 'Status'],
              ['Compliance', 'Pending']
            ]
          }
        ])

        const delivery = createCapturingDeliveryOverride({
          summary: '复杂 docx 编辑已稳定完成，并生成了可回看的预览。',
          buildMarkdown: ({ summary, state }) =>
            [
              '# 处理结果',
              '',
              summary,
              '',
              '## 产物与引用',
              ...(
                state.runtimeArtifacts.length > 0
                  ? state.runtimeArtifacts.map((artifact) => `- ${artifact.summary}`)
                  : ['- 无']
              )
            ].join('\n')
        })
        const ctx = runtime.createAiRunContext({
          humanDeliveryOverride: delivery.override
        }) as AiRunContextWithHumanOverrides
        const cache = createHumanRuntimeCache()
        const brainNode = createBrainNode({ ctx, cache })
        const learningNode = createLearningNode({ ctx, cache })
        const handNode = createHandNode({ ctx, cache })
        const mouthNode = createMouthNode({
          ctx,
          cache,
          deliveryMode: 'user_answer',
          streamAnswer: false,
          internalDelivery: false
        })
        let state = createInitialHumanState({
          taskId: runtime.taskId,
          userInput: '请修改复杂 docx，更新正文和表格状态，并给我一个预览。'
        })

        ctx.resolveBrainDecisionOverride = () =>
          buildLearnSkillsDecision({
            skillIds: ['docx-read', 'docx-write', 'docx-delivery'],
            summary: '先学习复杂 docx 编辑所需的读写与交付 skill。',
            reason: '复杂文档任务需要 human 同时具备读取结构、修改内容和生成交付物的能力。',
            expectedOutcome: '学习完成后开始打开文档。'
          })
        state = await brainNode(state)
        state = await learningNode(state)

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_open',
            args: {
              sourcePath: 'complex-edit.docx'
            },
            summary: '打开目标 docx，准备建立后续编辑上下文。',
            reason: '复杂编辑前必须先拿到稳定 docId。',
            expectedOutcome: '读取文档结构并定位多操作锚点。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const opened = readSingleToolResultData<DocxOpenResult>(state, 'docx_open')

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_outline',
            args: {
              docId: opened.docId,
              includeCells: true
            },
            summary: '读取文档 outline，定位段落锚点和表格单元格。',
            reason: '多操作编辑必须先确认插入位置和表格目标单元格。',
            expectedOutcome: '拿到足够上下文后执行写入。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const outline = readSingleToolResultData<DocxOutlineResult>(state, 'docx_outline')
        const headingBlockId = findOutlineBlock(
          outline.blocks,
          (block) => block.type === 'paragraph' && block.text.includes('Weekly Risk Review')
        ).blockId
        const backgroundBlockId = findOutlineBlock(
          outline.blocks,
          (block) =>
            block.type === 'paragraph' && block.text.includes('Background note: keep the appendix untouched.')
        ).blockId

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_apply_ops',
            args: {
              docId: opened.docId,
              ops: [
                {
                  type: 'replace_text',
                  query: 'Legacy baseline',
                  replace: 'Updated baseline'
                },
                {
                  type: 'insert_after',
                  anchorBlockId: headingBlockId,
                  content: [
                    {
                      kind: 'paragraph',
                      runs: [
                        {
                          text: 'Inserted note: confirm the owner and approval window before final save.',
                          italic: true
                        }
                      ]
                    }
                  ]
                },
                {
                  type: 'insert_before',
                  anchorBlockId: backgroundBlockId,
                  content: [
                    {
                      kind: 'paragraph',
                      runs: [
                        {
                          text: 'Inserted status note: the table below remains the source of truth for reviewer comparison.'
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            summary: '执行多格式、多操作的复杂 docx 编辑。',
            reason: '需要在一次写入里同时覆盖正文更新、插入补充说明和表格状态修订。',
            expectedOutcome: '写入完成后立即校验文档结构。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const applied = readSingleToolResultData<DocxApplyOpsResult>(state, 'docx_apply_ops')

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_validate',
            args: {
              docId: applied.newDocId
            },
            summary: '校验复杂编辑后的文档结构。',
            reason: '复杂写入后必须先通过 validate，再进入交付步骤。',
            expectedOutcome: '文档通过校验并可生成预览。'
          })
        state = await brainNode(state)
        state = await handNode(state)

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_render_preview',
            args: {
              docId: applied.newDocId,
              format: 'html'
            },
            summary: '生成复杂编辑后的预览产物。',
            reason: '需要有可回看的 artifact 才算完成 delivery。',
            expectedOutcome: '产出 preview 后进入最终交付。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const preview = readSingleToolResultData<DocxPreviewResult>(state, 'docx_render_preview')

        ctx.resolveBrainDecisionOverride = () =>
          buildCompleteTaskDecision({
            summary: '复杂 docx 编辑已稳定完成，并生成了可回看的预览。',
            reason: '读、写、validate 与 preview 工具链都已完成。',
            expectedOutcome: '进入最终交付。'
          })
        state = await brainNode(state)
        state = await mouthNode(state)
        const events = runtime.eventCollector.snapshot()

        return {
          output: buildHumanTaskOutputFromState(state),
          events,
          previewExists: await fs
            .access(preview.previewPath)
            .then(() => true)
            .catch(() => false),
          capturedState: delivery.getCapturedState(),
          applied,
          opened
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const deliveryEvents = filterAiRunEventsByType(result.events, 'task_delivery_ready')
        const stepToolNames = filterAiRunEventsByType(result.events, 'human_step')
          .map((event) => event.toolName)
          .filter((value): value is string => Boolean(value))

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.opened.stats.blockCount >= 4 &&
            result.applied.changedBlocks.length === 3 &&
            result.applied.changedBlocks.some((item) => item.action === 'replace_text') &&
            result.applied.changedBlocks.some((item) => item.action === 'insert_after') &&
            result.applied.changedBlocks.some((item) => item.action === 'insert_before'),
          {
            name: 'complex-docx-scenario-runs-multi-op-edit-chain',
            message: 'complex-docx-edit-simulated 应完成复杂文档读取与三类写入操作，并最终稳定完成。',
            data: {
              changedBlocks: result.applied.changedBlocks,
              steps: summarizeHumanSteps(result.events)
            }
          }
        )

        runtime.assertThat(
          ['docx_open', 'docx_outline', 'docx_apply_ops', 'docx_validate', 'docx_render_preview'].every(
            (toolName) => stepToolNames.includes(toolName)
          ) &&
            toolResults.length === 5 &&
            deliveryEvents.length === 1 &&
            result.previewExists &&
            result.output.artifacts?.some(
              (artifact) =>
                artifact.kind === 'file' &&
                artifact.capability === 'docx' &&
                artifact.artifactRole === 'preview'
            ) === true,
          {
            name: 'complex-docx-scenario-produces-preview-artifact',
            message: 'complex-docx-edit-simulated 应串起 docx 读、写、delivery 工具，并带回可回看的 preview artifact。',
            data: {
              toolNames: stepToolNames,
              artifacts: result.output.artifacts,
              runtimeArtifacts: result.capturedState?.runtimeArtifacts
            }
          }
        )
      }
    })
  })
})
