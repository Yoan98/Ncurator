import type { AiRunEvent, JsonObject } from '../../../../src/shared/types'
import { isJsonObject } from '../../../../src/main/utils/aiCapabilityUtils'
import { describe, it } from 'vitest'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createDocxToolHarness, writeWorkbenchSampleDocx } from '../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { hasLiveLlmConfigInEnv, loadLiveLlmConfigFromEnv } from '../../../harness/backend/llmConfig'

const liveModelConfig = hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv() : null

type DocxSearchResult = {
  ok: boolean
  code: string
  summary: string
  matches: Array<{
    blockId: string
    text: string
  }>
}

const getLatestToolResultPayload = (
  events: AiRunEvent[],
  toolName: string
): JsonObject | undefined => {
  const event = events.findLast(
    (item) => item.type === 'tool_call_result' && item.toolName === toolName
  )
  if (!event || event.type !== 'tool_call_result') return undefined
  return isJsonObject(event.outputPreview) ? event.outputPreview : undefined
}

describe('human docx iterative edit', () => {
  it('keeps the objective stable across multiple docx refinement steps', async () => {
    const isLiveMode = liveModelConfig !== null

    await runBackendCase({
      caseId: 'human-docx-iterative-edit',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'human',
      groups: [],
      description: '验证 human 能对同一 docx 草稿做多轮 refinement，且目标不漂移',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: liveModelConfig?.model_name || null,
      execute: async (runtime) => {
        const docxPath = await writeWorkbenchSampleDocx(runtime.workspaceRoot, 'iterative-edit-source.docx')
        const runner = createHumanTestRunner(
          runtime,
          {
            liveModelConfig: liveModelConfig || undefined,
            humanDecisionOverrides: isLiveMode
              ? undefined
              : [
                  {
                    decision: {
                      action: 'load_skill',
                      skillId: 'docx-editing',
                      rationale: '需要先加载 docx 编辑能力。',
                      publicNarrative: '我先加载文档编辑能力。'
                    }
                  },
                  {
                    decision: {
                      action: 'invoke_tool',
                      toolName: 'docx_open',
                      args: {
                        sourcePath: 'iterative-edit-source.docx'
                      },
                      rationale: '先打开要编辑的文档。',
                      publicNarrative: '我先打开目标文档。'
                    }
                  },
                  {
                    decision: {
                      action: 'invoke_tool',
                      toolName: 'docx_apply_ops',
                      args: {
                        ops: [
                          {
                            type: 'replace_text',
                            query: 'Hello',
                            replace: 'Hi'
                          }
                        ]
                      },
                      rationale: '第一轮先把开头措辞改得更正式。',
                      publicNarrative: '我先完成第一轮措辞调整。'
                    }
                  },
                  {
                    decision: {
                      action: 'invoke_tool',
                      toolName: 'docx_apply_ops',
                      args: {
                        ops: [
                          {
                            type: 'replace_text',
                            query: 'Risk summary: monitor integration edge cases.',
                            replace: 'Risk summary: proceed conservatively and escalate unclear integration issues.'
                          }
                        ]
                      },
                      rationale: '第二轮把风险表达改得更保守。',
                      publicNarrative: '我继续做第二轮 refinement，收紧风险表述。'
                    }
                  },
                  {
                    decision: {
                      action: 'complete_task',
                      summary: '已完成两轮文档 refinement，目标仍然聚焦在措辞与风险表述。',
                      rationale: '两轮修改都围绕同一文档与同一目标，没有偏离。',
                      publicNarrative: '文档 refinement 已完成，可以交付当前草稿。',
                      resultData: {
                        sourcePath: 'iterative-edit-source.docx',
                        refinementRounds: 2
                      }
                    }
                  }
                ],
            humanDeliveryOverride: isLiveMode
              ? () =>
                  [
                    '# 子任务交付',
                    '',
                    '## 已完成',
                    '已完成文档 refinement，并保留当前可继续交接的草稿。',
                    '',
                    '## 风险与未决',
                    '当前没有新增阻塞。'
                  ].join('\n')
              : () =>
                  [
                    '# 子任务交付',
                    '',
                    '## 已完成',
                    '已完成两轮 refinement：第一轮调整开头措辞，第二轮收紧风险表述。',
                    '',
                    '## 风险与未决',
                    '当前没有偏离原始编辑目标。'
                  ].join('\n')
          },
          {
            maxSteps: isLiveMode ? 8 : 6
          }
        )

        const output = await runner.run(
          {
            taskId: runtime.taskId,
            objective:
              '把文档开头改成 Hi team，并把风险部分改成更保守的表述：Risk summary: proceed conservatively and escalate unclear integration issues.'
          },
          {
            deliveryKind: 'handoff',
            streamAnswer: false
          }
        )

        const aiEvents = runtime.eventCollector.snapshot()
        const applyPayload = getLatestToolResultPayload(aiEvents, 'docx_apply_ops')
        const latestDocId = typeof applyPayload?.newDocId === 'string' ? applyPayload.newDocId : ''

        const docxHarness = createDocxToolHarness(runtime)
        try {
          const hiSearch = await docxHarness.invoke<DocxSearchResult>('docx_search', {
            docId: latestDocId,
            query: 'Hi team',
            mode: 'literal'
          })
          const conservativeRiskSearch = await docxHarness.invoke<DocxSearchResult>('docx_search', {
            docId: latestDocId,
            query: 'proceed conservatively',
            mode: 'literal'
          })

          runtime.recordEvent({
            type: 'step',
            name: 'human-docx-iterative-edit',
            status: output.status === 'completed' ? 'ok' : 'failed',
            message:
              output.status === 'completed'
                ? 'human 多轮 docx refinement 执行成功'
                : 'human 多轮 docx refinement 执行失败',
            data: {
              status: output.status,
              resultCode: output.resultCode,
              latestDocId
            }
          })

          return {
            output,
            hiSearch,
            conservativeRiskSearch,
            aiEvents
          }
        } finally {
          await docxHarness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.output.resultCode === 'ok' &&
            (isLiveMode
              ? result.output.deliveryMarkdown.includes('文档 refinement')
              : result.output.resultData?.refinementRounds === 2 &&
                  result.output.deliveryMarkdown.includes('两轮 refinement')),
          {
            name: 'human-docx-iterative-edit-completed',
            message: 'human 已完成多轮 docx refinement 并维持目标稳定',
            data: {
              status: result.output.status,
              resultCode: result.output.resultCode,
              resultData: result.output.resultData
            }
          }
        )
        runtime.assertThat(
          result.hiSearch.matches.length === 1 && result.conservativeRiskSearch.matches.length === 1,
          {
            name: 'human-docx-iterative-edit-draft-updated',
            message: '两轮 refinement 的结果都已体现在最新 docx 草稿中'
          }
        )

        const docxOpenResults = result.aiEvents.filter(
          (event: AiRunEvent) =>
            event.type === 'tool_call_result' && event.toolName === 'docx_open'
        )
        const applyHumanSteps = result.aiEvents.filter(
          (event: AiRunEvent) =>
            event.type === 'human_step' &&
            event.action === 'invoke_tool' &&
            event.toolName === 'docx_apply_ops' &&
            event.resultStatus === 'ok'
        )

        runtime.assertThat(
          isLiveMode
            ? docxOpenResults.length >= 1 && applyHumanSteps.length >= 1
            : applyHumanSteps.length === 2,
          {
            name: 'human-docx-iterative-edit-two-rounds',
            message: 'human_step 中完整记录了 docx refinement 关键步骤',
            data: {
              docxOpenResults: docxOpenResults.length,
              applyHumanSteps: applyHumanSteps.length
            }
          }
        )
      }
    })
  })
})
