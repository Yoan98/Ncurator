import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { createBrainNode } from '../../../../src/main/services/ai/human/node/brainNode'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { createLearningNode } from '../../../../src/main/services/ai/human/node/learningNode'
import { createMouthNode } from '../../../../src/main/services/ai/human/node/mouthNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContextWithHumanOverrides } from '../../../../src/main/services/ai/human/types'
import {
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type {
  DocxApplyOpsResult,
  DocxFailureResult,
  DocxOpenResult,
  DocxPreviewResult
} from '../../tool/docx/testUtils'
import {
  buildHumanTaskOutputFromState,
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  createCapturingDeliveryOverride,
  filterAiRunEventsByType,
  filterToolCallResultEventsByName,
  readSingleToolResultData,
  summarizeHumanSteps
} from '../testUtils'

describe('ai human scenarios backend', () => {
  it('approval-denied-restricted-delivery', async () => {
    await runBackendCase({
      caseId: 'approval-denied-restricted-delivery',
      domain: 'ai',
      suite: 'human',
      groups: ['scenarios'],
      description: '验证审批拒绝后 human 会停止重复触发同一动作，并以受限交付说明阻塞点和未完成项。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'approval-source.docx', [
          {
            type: 'paragraph',
            text: 'Original approval content.'
          }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'approval-target.docx', [
          {
            type: 'paragraph',
            text: 'Existing target content.'
          }
        ])

        const deniedBufferBefore = await fs.readFile(`${runtime.workspaceRoot}/approval-target.docx`)
        const delivery = createCapturingDeliveryOverride({
          summary: '文档修改已完成到预览阶段，但正式覆盖保存被审批拒绝。',
          buildMarkdown: ({ summary, state }) =>
            [
              '# 处理结果',
              '',
              summary,
              '',
              '## 当前已得到的结果',
              '- 已完成文档内存修改与校验。',
              `- 已生成 ${state.runtimeArtifacts.length} 个可回看产物。`,
              '',
              '## 阻塞点',
              '- 覆盖保存现有文件时审批被拒绝，当前不能继续写回源目标。',
              '',
              '## 未完成项',
              '- approval-target.docx 尚未落盘为最新修改结果。'
            ].join('\n')
        })
        const ctx = runtime.createAiRunContext({
          approvalPolicy: 'deny-all',
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
          userInput: '请修改文档并直接覆盖保存，如果不能保存就说明当前阻塞与已有结果。'
        })

        ctx.resolveBrainDecisionOverride = () =>
          buildLearnSkillsDecision({
            skillIds: ['docx-read', 'docx-write', 'docx-delivery'],
            summary: '先学习 docx 读写与交付 skill，准备执行覆盖保存任务。',
            reason: '审批拒绝场景仍然要先完成正常的编辑链路，再验证受限交付。',
            expectedOutcome: '打开源文档并开始修改。'
          })
        state = await brainNode(state)
        state = await learningNode(state)

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_open',
            args: {
              sourcePath: 'approval-source.docx'
            },
            summary: '打开待修改的源文档。',
            reason: '正式编辑前必须先拿到 docId。',
            expectedOutcome: '执行写入并生成预览。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const opened = readSingleToolResultData<DocxOpenResult>(state, 'docx_open')

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_apply_ops',
            args: {
              docId: opened.docId,
              ops: [
                {
                  type: 'replace_text',
                  query: 'Original approval content.',
                  replace: 'Updated approval content after review.'
                }
              ]
            },
            summary: '先完成文档修改，准备进入交付阶段。',
            reason: '审批拒绝只应阻断高风险保存，不应阻断前面的编辑结果。',
            expectedOutcome: '写入完成后校验并生成预览。'
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
            summary: '校验修改后的文档结构。',
            reason: '即便后续保存被拒绝，也应先保证当前编辑结果本身可用。',
            expectedOutcome: '文档通过校验后生成预览。'
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
            summary: '先生成可回看的预览产物。',
            reason: '审批拒绝后仍需交付当前已得到的结果。',
            expectedOutcome: '带着 preview 尝试执行保存。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const preview = readSingleToolResultData<DocxPreviewResult>(state, 'docx_render_preview')

        ctx.resolveBrainDecisionOverride = () =>
          buildToolDecision({
            toolName: 'docx_save',
            args: {
              docId: applied.newDocId,
              outPath: 'approval-target.docx',
              overwrite: true
            },
            summary: '尝试覆盖保存现有目标文件。',
            reason: '需要显式验证审批拒绝后的收敛行为。',
            expectedOutcome: '如果审批被拒绝，应直接转为受限交付而不是重复尝试。'
          })
        state = await brainNode(state)
        state = await handNode(state)
        const deniedSave = readSingleToolResultData<DocxFailureResult>(state, 'docx_save')

        ctx.resolveBrainDecisionOverride = () =>
          buildCompleteTaskDecision({
            summary: '文档修改已完成到预览阶段，但正式覆盖保存被审批拒绝。',
            reason: '审批拒绝已经形成稳定结论，继续重复同一动作没有价值。',
            expectedOutcome: '以受限交付说明阻塞点与未完成项。'
          })
        state = await brainNode(state)
        state = await mouthNode(state)
        const events = runtime.eventCollector.snapshot()
        const deniedBufferAfter = await fs.readFile(`${runtime.workspaceRoot}/approval-target.docx`)

        return {
          output: buildHumanTaskOutputFromState(state),
          events,
          deniedBufferBefore,
          deniedBufferAfter,
          previewExists: await fs
            .access(preview.previewPath)
            .then(() => true)
            .catch(() => false),
          deniedSave
        }
      },
      assert: async (result, runtime) => {
        const approvalRequired = filterAiRunEventsByType(result.events, 'approval_required')
        const approvalDecisions = filterAiRunEventsByType(result.events, 'approval_decision')
        const saveResults = filterToolCallResultEventsByName(result.events, 'docx_save')

        runtime.assertThat(
          result.deniedSave.ok === false &&
            result.deniedSave.code === 'approval_denied' &&
            saveResults.length === 1 &&
            approvalRequired.length === 1 &&
            approvalDecisions.length === 1 &&
            approvalDecisions[0]?.approved === false &&
            result.deniedBufferBefore.equals(result.deniedBufferAfter),
          {
            name: 'approval-denied-scenario-stops-after-first-rejection',
            message: 'approval-denied-restricted-delivery 应在第一次拒绝后停止重复撞同一保存动作，并保持磁盘目标文件不变。',
            data: {
              deniedSave: result.deniedSave,
              approvals: approvalRequired.map((event) => ({
                command: event.command,
                riskLevel: event.riskLevel
              })),
              decisions: approvalDecisions.map((event) => ({
                approved: event.approved,
                reason: event.reason
              }))
            }
          }
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.previewExists &&
            result.output.deliveryMarkdown?.includes('审批被拒绝') === true &&
            result.output.deliveryMarkdown?.includes('## 阻塞点') === true &&
            result.output.deliveryMarkdown?.includes('## 未完成项') === true &&
            result.output.artifacts?.some(
              (artifact) =>
                artifact.kind === 'file' &&
                artifact.capability === 'docx' &&
                artifact.artifactRole === 'preview'
            ) === true,
          {
            name: 'approval-denied-scenario-produces-restricted-delivery',
            message: 'approval-denied-restricted-delivery 应明确说明阻塞点、未完成项和当前已得到的 preview 结果。',
            data: {
              deliveryMarkdown: result.output.deliveryMarkdown,
              artifacts: result.output.artifacts,
              steps: summarizeHumanSteps(result.events)
            }
          }
        )
      }
    })
  })
})
