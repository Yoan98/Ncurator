import fs from 'node:fs/promises'
import type { JsonValue, SearchResult } from '../../../../../src/shared/types'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { defineAiHumanCase, getEventsByType } from '../helpers'

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}

const getFirstPreviewRecord = (
  value: JsonValue | undefined
): Record<string, JsonValue> | null => {
  if (!value) return null
  if (Array.isArray(value)) {
    const first = value[0]
    if (!first || Array.isArray(first) || typeof first !== 'object') return null
    return first as Record<string, JsonValue>
  }
  if (typeof value !== 'object') return null
  return value as Record<string, JsonValue>
}

defineAiHumanCase({
  caseId: 'human-kb-docx-bridge',
  caseType: 'scenario',
  groups: ['scenario'],
  description: 'human 先检索本地规范，再把规范要求写入 docx 预览并形成交付。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    await writeTestDocxFile(runtime.workspaceRoot, 'release-check.docx', [
      { type: 'heading', text: 'Release Checklist', level: 1 },
      { type: 'paragraph', text: 'Checklist summary: pending policy sync.' },
      { type: 'paragraph', text: 'Risk note: TBD.' }
    ])

    const runner = createHumanTestRunner(
      runtime,
      {
        selectedDocumentIds: ['doc-policy'],
        documentsStoreOverrides: {
          hybridSearch: async (_vector, queryText, _limit, _sourceType, documentIds) => {
            if (
              queryText.includes('approval denied') &&
              Array.isArray(documentIds) &&
              documentIds.includes('doc-policy')
            ) {
              const rows: SearchResult[] = [
                {
                  id: 'chunk-policy-1',
                  text: 'Release reports must mention approval-denied coverage and terminal artifact assertion before sign-off.',
                  document_id: 'doc-policy',
                  document_name: 'release-policy.md',
                  source_type: 'file',
                  _score: 0.93
                }
              ]
              return rows
            }
            return []
          }
        },
        humanDecisionOverrides: [
          {
            decision: {
              action: 'load_skill',
              skillId: 'local-kb-retrieval',
              rationale: '先检索本地规范。',
              publicNarrative: '我先读取本地规范要求。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'kb_hybrid_search_chunks',
              args: {
                queryText: 'approval denied terminal artifact requirement',
                limit: 3
              },
              rationale: '先定位 release policy 中的明确要求。',
              publicNarrative: '我正在检索本地知识库里的发布规范。'
            }
          },
          {
            decision: {
              action: 'load_skill',
              skillId: 'docx-editing',
              rationale: '拿到规范后切换到 docx 编辑。',
              publicNarrative: '我现在把规范要求写进文档模板。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'docx_open',
              args: {
                sourcePath: 'release-check.docx'
              },
              rationale: '先打开模板文档。',
              publicNarrative: '我正在打开发布检查模板。'
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
                    query: 'Checklist summary: pending policy sync.',
                    replace:
                      'Checklist summary: Mention approval-denied coverage and terminal artifact assertion before sign-off.'
                  }
                ]
              },
              rationale: '把检索到的规范要求落到摘要段落。',
              publicNarrative: '我正在把规范要求转成文档摘要。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'docx_render_preview',
              args: {
                format: 'html'
              },
              rationale: '生成可审阅预览。',
              publicNarrative: '我先生成文档预览，方便继续审阅。'
            }
          },
          {
            decision: {
              action: 'invoke_tool',
              toolName: 'docx_validate',
              args: {},
              rationale: '确认结构有效。',
              publicNarrative: '我正在校验文档结构。'
            }
          },
          {
            decision: {
              action: 'complete_task',
              summary: '已把本地发布规范写入 release checklist 预览。',
              rationale: 'KB -> DOCX 的 bridge 已完成。',
              publicNarrative: '我已经把查到的规范转成可审阅文档交付。',
              resultData: {
                document_name: 'release-check.docx',
                artifact_role: 'preview',
                source_document_name: 'release-policy.md',
                source_document_id: 'doc-policy'
              }
            }
          }
        ],
        humanDeliveryOverride: ({ resultData, summary }) =>
          [
            '# 子任务交付',
            '',
            `已完成：${summary}`,
            `来源：${typeof resultData?.source_document_name === 'string' ? resultData.source_document_name : 'release-policy.md'}`,
            `交付形式：${typeof resultData?.artifact_role === 'string' ? resultData.artifact_role : 'preview'}`
          ].join('\n')
      },
      { maxSteps: 9 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective: '先检索本地发布规范，再按规范修改 release checklist 模板。'
      },
      {
        deliveryKind: 'handoff'
      }
    )

    const toolResults = getEventsByType(runtime, 'tool_call_result')
    const fileArtifacts = getEventsByType(runtime, 'file_artifact')
    const previewArtifact = fileArtifacts.find((event) => event.artifactRole === 'preview')
    const previewPath = previewArtifact?.path || ''
    const previewExists = previewPath ? await fileExists(previewPath) : false
    const inspectionHarness = createDocxToolHarness(runtime)

    try {
      const openPreview = await inspectionHarness.invoke<{
        ok: boolean
        docId: string
      }>('docx_open', {
        sourcePath: previewPath
      })
      const summarySearch = await inspectionHarness.invoke<{
        ok: boolean
        matches: Array<{ blockId: string; text: string }>
      }>('docx_search', {
        docId: openPreview.docId,
        query: 'approval-denied coverage and terminal artifact assertion',
        mode: 'literal'
      })

      return {
        output,
        previewExists,
        summarySearch,
        humanSteps: getEventsByType(runtime, 'human_step'),
        toolCalls: getEventsByType(runtime, 'tool_call_started'),
        toolResults,
        fileArtifacts
      }
    } finally {
      await inspectionHarness.release()
    }
  },
  assert: async (result, runtime) => {
    const kbResult = result.toolResults.find((event) => event.toolName === 'kb_hybrid_search_chunks')
    const kbPreview = kbResult ? getFirstPreviewRecord(kbResult.outputPreview) : null

    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.resultCode === 'ok' &&
        result.output.resultData?.source_document_name === 'release-policy.md' &&
        result.output.resultData?.artifact_role === 'preview',
      {
        name: 'human-kb-docx-bridge-completed',
        message: 'kb -> docx bridge 应形成完成态交付'
      }
    )
    runtime.assertThat(
      Boolean(kbPreview) &&
        String(kbPreview?.document_name || '').includes('release-policy.md') &&
        String(kbPreview?.document_id || '').includes('doc-policy'),
      {
        name: 'human-kb-docx-bridge-kb-evidence',
        message: 'bridge 前应先拿到可引用的本地 KB 证据'
      }
    )
    runtime.assertThat(
      result.previewExists &&
        result.summarySearch.ok &&
        result.summarySearch.matches.length >= 1,
      {
        name: 'human-kb-docx-bridge-preview',
        message: '预览文档中应写入从本地规范提炼出的要求'
      }
    )
    runtime.assertThat(
      result.toolCalls
        .slice(0, 5)
        .map((event) => event.toolName)
        .join(',') ===
        [
          'kb_hybrid_search_chunks',
          'docx_open',
          'docx_apply_ops',
          'docx_render_preview',
          'docx_validate'
        ].join(','),
      {
        name: 'human-kb-docx-bridge-order',
        message: 'human 应先检索 KB，再按 docx 编辑链路生成预览'
      }
    )
    runtime.assertThat(
      result.humanSteps.filter((event) => event.action === 'load_skill').length === 2 &&
        result.fileArtifacts.some((event) => event.artifactRole === 'preview') &&
        result.output.localSourceStatus === 'used',
      {
        name: 'human-kb-docx-bridge-events',
        message: '事件流应体现 KB 与 docx 的跨工具 bridge'
      }
    )
  }
})
