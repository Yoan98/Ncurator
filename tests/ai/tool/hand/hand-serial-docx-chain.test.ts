import { describe, it } from 'vitest'
import { createHandNode } from '../../../../src/main/services/ai/human/node/handNode'
import { ensureSkillTools } from '../../../../src/main/services/ai/human/node/learningNode/skillLoader'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

type DocxOpenResult = {
  ok: boolean
  docId: string
}

type ToolsetItem = {
  name?: string
  invoke: (input: Record<string, unknown>) => Promise<unknown>
}

const invokeCachedTool = async <TResult>(
  toolset: readonly ToolsetItem[],
  toolName: string,
  args: Record<string, unknown>
): Promise<TResult> => {
  const tool = toolset.find((item) => String(item.name || '') === toolName)
  if (!tool) {
    throw new Error(`tool not found in cache: ${toolName}`)
  }
  return (await tool.invoke(args)) as TResult
}

describe('ai tool hand backend', () => {
  it('hand-serial-docx-chain', async () => {
    await runBackendCase({
      caseId: 'hand-serial-docx-chain',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['hand'],
      description: '验证 hand 在 serial 模式下可以顺序执行 docx 写入、校验和预览链路。',
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
        ensureSkillTools({
          cache,
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          skillId: 'docx-delivery'
        })

        const docxReadTools = cache.skillToolsets['docx-read'] || []
        const opened = await invokeCachedTool<DocxOpenResult>(docxReadTools, 'docx_open', {
          sourcePath: 'serial-docx-chain.docx'
        })

        const handNode = createHandNode({ ctx, cache })
        const state = await handNode({
          ...createInitialHumanState({
            taskId: runtime.taskId,
            userInput: '请顺序完成风险周报文档修改与预览'
          }),
          skills: {
            learnedSkillIds: ['docx-read', 'docx-write', 'docx-delivery']
          },
          execution: {
            ...createInitialHumanState({
              taskId: runtime.taskId,
              userInput: '请顺序完成风险周报文档修改与预览'
            }).execution,
            currentDecision: {
            decision: {
              summary: '串行完成 docx 编辑链路',
              reason: '文档写入、validate 和 preview 依赖同一份最新快照。',
              expectedOutcome: '产出真实 preview artifact。'
            },
            readyToDeliver: false,
            nextAction: {
              action: 'hand',
              toolUsePlan: {
                mode: 'serial',
                calls: [
                  {
                    toolName: 'docx_apply_ops',
                    args: {
                      docId: opened.docId,
                      ops: [
                        {
                          type: 'replace_text',
                          query: 'RISK_TODO',
                          replace: '待跟进'
                        },
                        {
                          type: 'replace_text',
                          query: 'OWNER_TODO',
                          replace: 'Alice'
                        }
                      ]
                    }
                  },
                  {
                    toolName: 'docx_validate',
                    args: {}
                  },
                  {
                    toolName: 'docx_render_preview',
                    args: {
                      format: 'html'
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
          toolNames.join(',') === 'docx_apply_ops,docx_validate,docx_render_preview' &&
            result.state.execution.lastToolResults?.every((item) => item.code === 'ok') &&
            !result.state.execution.watchHint,
          {
            name: 'serial-docx-chain-executes-in-order',
            message: 'serial 模式应按顺序执行 docx_apply_ops、docx_validate、docx_render_preview。',
            data: {
              toolNames,
              lastToolUseResults: result.state.execution.lastToolResults,
              watchHint: result.state.execution.watchHint
            }
          }
        )

        runtime.assertThat(
          result.state.execution.artifacts.some(
            (artifact) =>
              artifact.kind === 'file' &&
              artifact.capability === 'docx' &&
              artifact.artifactRole === 'preview'
          ),
          {
            name: 'serial-docx-chain-produces-preview-artifact',
            message: 'serial docx 链路完成后应生成 preview artifact。',
            data: result.state.execution.artifacts
          }
        )
      }
    })
  })
})
