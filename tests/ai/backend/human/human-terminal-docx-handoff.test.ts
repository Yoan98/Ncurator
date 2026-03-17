import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent, JsonObject } from '../../../../src/shared/types'
import { isJsonObject } from '../../../../src/main/utils/aiCapabilityUtils'
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

const getToolResultPayload = (
  events: AiRunEvent[],
  toolName: string
): JsonObject | undefined => {
  const event = events.findLast(
    (item) => item.type === 'tool_call_result' && item.toolName === toolName
  )
  if (!event || event.type !== 'tool_call_result') return undefined
  return isJsonObject(event.outputPreview) ? event.outputPreview : undefined
}

describe('human terminal docx handoff', () => {
  it('chains workspace shell output into a docx editing flow and keeps the draft usable', async () => {
    const isLiveMode = liveModelConfig !== null

    await runBackendCase({
      caseId: 'human-terminal-docx-handoff',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'human',
      groups: [],
      description: '验证 human 能串联 terminal 与 docx 工具完成多步任务',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: liveModelConfig?.model_name || null,
      execute: async (runtime) => {
        const docxPath = await writeWorkbenchSampleDocx(runtime.workspaceRoot, 'handoff-source.docx')
        const notesPath = path.join(runtime.workspaceRoot, 'notes.txt')
        await fs.writeFile(
          notesPath,
          'Please add a conclusion: local-first retrieval remains the primary path.'
        )

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
                      skillId: 'workspace-shell',
                      rationale: '需要先读取工作区里的输入材料。',
                      publicNarrative: '我先读取工作区里的说明。'
                    }
                  },
                  {
                    decision: {
                      action: 'invoke_tool',
                      toolName: 'terminal_run_command',
                      args: {
                        command: 'cat notes.txt'
                      },
                      rationale: '先读取 notes.txt 中的修改要求。',
                      publicNarrative: '我先看一下工作区里的说明内容。'
                    }
                  },
                  {
                    decision: {
                      action: 'load_skill',
                      skillId: 'docx-editing',
                      rationale: '拿到要求后再切到 docx 编辑能力。',
                      publicNarrative: '我切到文档编辑能力继续处理。'
                    }
                  },
                  {
                    decision: {
                      action: 'invoke_tool',
                      toolName: 'docx_open',
                      args: {
                        sourcePath: path.relative(runtime.workspaceRoot, docxPath)
                      },
                      rationale: '需要先打开目标文档。',
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
                          },
                          {
                            type: 'replace_text',
                            query: 'Risk summary: monitor integration edge cases.',
                            replace:
                              'Risk summary: monitor integration edge cases. Conclusion: local-first retrieval remains the primary path.'
                          }
                        ]
                      },
                      rationale: '根据说明修改开头措辞，并补一段结论。',
                      publicNarrative: '我开始把要求落实到文档草稿里。'
                    }
                  },
                  {
                    decision: {
                      action: 'complete_task',
                      summary: '已根据工作区说明完成文档草稿修改。',
                      rationale: 'terminal 读取和 docx 编辑都已完成。',
                      publicNarrative: '文档草稿已经改好，可以交付当前结果。',
                      resultData: {
                        sourcePath: path.relative(runtime.workspaceRoot, docxPath),
                        note: 'draft updated'
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
                    '已读取 notes.txt，并把要求落实到文档草稿中。',
                    '',
                    '## 关键发现',
                    '文档已根据工作区说明完成更新。'
                  ].join('\n')
              : () =>
                  [
                    '# 子任务交付',
                    '',
                    '## 已完成',
                    '已读取 notes.txt，并把要求落实到 docx 草稿中。',
                    '',
                    '## 关键发现',
                    '已将开头措辞改为 Hi，并补入结论段。'
                  ].join('\n')
          },
          {
            maxSteps: isLiveMode ? 10 : 8
          }
        )

        const output = await runner.run(
          {
            taskId: runtime.taskId,
            objective: '先读取 notes.txt，再把要求落实到 handoff-source.docx。'
          },
          {
            deliveryKind: 'handoff',
            streamAnswer: false
          }
        )

        const aiEvents = runtime.eventCollector.snapshot()
        const applyPayload = getToolResultPayload(aiEvents, 'docx_apply_ops')
        const newDocId = typeof applyPayload?.newDocId === 'string' ? applyPayload.newDocId : ''

        const docxHarness = createDocxToolHarness(runtime)
        try {
          const conclusionSearch = await docxHarness.invoke<DocxSearchResult>('docx_search', {
            docId: newDocId,
            query: 'Conclusion: local-first retrieval remains the primary path.',
            mode: 'literal'
          })
          const helloSearch = await docxHarness.invoke<DocxSearchResult>('docx_search', {
            docId: newDocId,
            query: 'Hello',
            mode: 'literal'
          })

          runtime.recordEvent({
            type: 'step',
            name: 'human-terminal-docx-handoff',
            status: output.status === 'completed' ? 'ok' : 'failed',
            message:
              output.status === 'completed'
                ? 'human terminal -> docx 串联执行成功'
                : 'human terminal -> docx 串联执行失败',
            data: {
              status: output.status,
              resultCode: output.resultCode,
              newDocId
            }
          })

          return {
            output,
            conclusionSearch,
            helloSearch,
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
            result.output.deliveryMarkdown.includes('notes.txt') &&
            result.output.localSourceStatus === 'used',
          {
            name: 'human-terminal-docx-handoff-completed',
            message: 'human 已完成 terminal -> docx 串联任务并产出交付',
            data: {
              status: result.output.status,
              resultCode: result.output.resultCode
            }
          }
        )
        runtime.assertThat(result.conclusionSearch.matches.length === 1, {
          name: 'human-terminal-docx-handoff-conclusion-written',
          message: '串联后的 docx 草稿中已经存在新增结论段'
        })
        runtime.assertThat(result.helloSearch.matches.length === 0, {
          name: 'human-terminal-docx-handoff-text-replaced',
          message: '串联后的 docx 草稿中旧文本 Hello 已被替换'
        })

        const humanSteps = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'human_step'
        )
        const terminalResults = result.aiEvents.filter(
          (event: AiRunEvent) =>
            event.type === 'tool_call_result' && event.toolName === 'terminal_run_command'
        )
        const docxApplyResults = result.aiEvents.filter(
          (event: AiRunEvent) =>
            event.type === 'tool_call_result' && event.toolName === 'docx_apply_ops'
        )

        runtime.assertThat(
          isLiveMode
            ? humanSteps.length >= 4 && terminalResults.length >= 1 && docxApplyResults.length >= 1
            : humanSteps.length === 6 && terminalResults.length === 1 && docxApplyResults.length === 1,
          {
            name: 'human-terminal-docx-handoff-events',
            message: '多工具串联所需的 human_step 与关键 tool 事件都已记录',
            data: {
              humanSteps: humanSteps.length,
              terminalResults: terminalResults.length,
              docxApplyResults: docxApplyResults.length
            }
          }
        )
      }
    })
  })
})
