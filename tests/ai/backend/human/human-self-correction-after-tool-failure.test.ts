import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { writeWorkbenchSampleDocx } from '../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'

describe('human self correction after tool failure', () => {
  it('keeps going after a non-blocking tool failure and switches to a viable strategy', async () => {
    await runBackendCase({
      caseId: 'human-self-correction-after-tool-failure',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'human',
      groups: [],
      description: '验证 human 在工具失败后能切换策略，而不是直接中断或死循环',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const docxPath = await writeWorkbenchSampleDocx(runtime.workspaceRoot, 'self-correct-source.docx')
        const runner = createHumanTestRunner(
          runtime,
          {
            humanDecisionOverrides: [
              {
                decision: {
                  action: 'load_skill',
                  skillId: 'docx-editing',
                  rationale: '需要先加载文档编辑能力。',
                  publicNarrative: '我先加载文档编辑能力。'
                }
              },
              {
                decision: {
                  action: 'invoke_tool',
                  toolName: 'docx_open',
                  args: {
                    sourcePath: path.relative(runtime.workspaceRoot, docxPath)
                  },
                  rationale: '先打开目标文档。',
                  publicNarrative: '我先打开文档。'
                }
              },
              {
                decision: {
                  action: 'invoke_tool',
                  toolName: 'docx_get_block',
                  args: {
                    blockId: 'missing-block-id'
                  },
                  rationale: '先尝试直接读取目标块。',
                  publicNarrative: '我先尝试直接定位目标块。'
                }
              },
              {
                decision: {
                  action: 'invoke_tool',
                  toolName: 'docx_search',
                  args: {
                    query: 'Hello team',
                    mode: 'literal'
                  },
                  rationale: '直接定位失败后，改为全文搜索目标文本。',
                  publicNarrative: '直接定位失败，我改用全文搜索重新找块。'
                }
              },
              {
                decision: {
                  action: 'complete_task',
                  summary: '已在失败后切换策略，并重新定位到目标段落。',
                  rationale: '虽然第一次 get_block 失败，但 search 已经找回目标文本。',
                  publicNarrative: '我已经纠偏成功，可以给出结果。',
                  resultData: {
                    locatedText: 'Hello team'
                  }
                }
              }
            ],
            humanDeliveryOverride: () =>
              [
                '# 子任务交付',
                '',
                '## 已完成',
                '第一次直接定位 block 失败后，已经改用 search 找到目标段落。',
                '',
                '## 关键发现',
                '目标文本为 Hello team。'
              ].join('\n')
          },
          {
            maxSteps: 6
          }
        )

        const output = await runner.run(
          {
            taskId: runtime.taskId,
            objective: '定位文档里包含 Hello team 的段落，并告诉我是否找到。'
          },
          {
            deliveryKind: 'handoff',
            streamAnswer: false
          }
        )

        const aiEvents = runtime.eventCollector.snapshot()

        runtime.recordEvent({
          type: 'step',
          name: 'human-self-correction-after-tool-failure',
          status: output.status === 'completed' ? 'ok' : 'failed',
          message:
            output.status === 'completed'
              ? 'human 在工具失败后完成了策略纠偏'
              : 'human 在工具失败后未完成策略纠偏',
          data: {
            status: output.status,
            resultCode: output.resultCode,
            summary: output.summary
          }
        })

        return {
          output,
          aiEvents
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.output.status === 'completed' &&
            result.output.resultCode === 'ok' &&
            result.output.deliveryMarkdown.includes('改用 search') &&
            result.output.resultData?.locatedText === 'Hello team',
          {
            name: 'human-self-correction-completed',
            message: 'human 在非阻塞失败后已完成策略切换并给出结果',
            data: {
              status: result.output.status,
              resultCode: result.output.resultCode,
              resultData: result.output.resultData
            }
          }
        )

        const failedToolStep = result.aiEvents.find(
          (event: AiRunEvent) =>
            event.type === 'human_step' &&
            event.action === 'invoke_tool' &&
            event.toolName === 'docx_get_block' &&
            event.resultStatus === 'error'
        )
        const recoveredToolStep = result.aiEvents.find(
          (event: AiRunEvent) =>
            event.type === 'human_step' &&
            event.action === 'invoke_tool' &&
            event.toolName === 'docx_search' &&
            event.resultStatus === 'ok'
        )
        const failedToolResult = result.aiEvents.find(
          (event: AiRunEvent) =>
            event.type === 'tool_call_result' &&
            event.toolName === 'docx_get_block' &&
            typeof event.error === 'string'
        )

        runtime.assertThat(
          Boolean(failedToolStep) && Boolean(recoveredToolStep) && Boolean(failedToolResult),
          {
            name: 'human-self-correction-event-sequence',
            message: '失败工具事件、纠偏后的成功工具事件和错误结果都已记录'
          }
        )
      }
    })
  })
})
