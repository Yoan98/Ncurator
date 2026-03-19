import type { DocumentRecord, JsonValue, SearchResult } from '../../../../../src/shared/types'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import {
  defineAiHumanLiveCase,
  getEventsByType,
  loadPrimaryLiveHumanConfig
} from '../helpers'

const releaseChecklistDocument: DocumentRecord = {
  id: 'doc-beta',
  name: 'release-checklist.md',
  source_type: 'file',
  created_at: 1710000000000,
  import_status: 2
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

defineAiHumanLiveCase({
  caseId: 'human-live-direct-kb-answer',
  caseType: 'live',
  groups: ['live'],
  description: 'live 模型直接使用本地 KB 回答问题，并在结果里保留可回看的文档引用。',
  fixtures: [],
  runMode: 'single',
  execute: async (runtime) => {
    const runner = createHumanTestRunner(
      runtime,
      {
        bindWorkspace: false,
        selectedDocumentIds: ['doc-beta'],
        liveModelConfig: loadPrimaryLiveHumanConfig(),
        documentsStoreOverrides: {
          hybridSearch: async () => {
            const rows: SearchResult[] = [
              {
                id: 'chunk-beta-1',
                text: 'Approval flow still needs regression coverage before release.',
                document_id: 'doc-beta',
                document_name: 'release-checklist.md',
                source_type: 'file',
                _score: 0.91
              }
            ]
            return rows
          },
          vectorSearch: async () => {
            const rows: SearchResult[] = [
              {
                id: 'chunk-beta-1',
                text: 'Approval flow still needs regression coverage before release.',
                document_id: 'doc-beta',
                document_name: 'release-checklist.md',
                source_type: 'file',
                _score: 0.91
              }
            ]
            return rows
          },
          ftsSearch: async () => {
            const rows: SearchResult[] = [
              {
                id: 'chunk-beta-1',
                text: 'Approval flow still needs regression coverage before release.',
                document_id: 'doc-beta',
                document_name: 'release-checklist.md',
                source_type: 'file',
                _score: 0.91
              }
            ]
            return rows
          },
          listDocuments: async () => ({
            items: [releaseChecklistDocument],
            total: 1
          }),
          getDocumentById: async (id: string) => (id === 'doc-beta' ? releaseChecklistDocument : null)
        }
      },
      { hardActionLimit: 6 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        objective:
          '请仅使用当前本地资料范围回答 approval flow regression coverage 是否已经完成。先做本地 KB 检索，一旦拿到直接证据就停止，不要重复确认。最终答复要明确说明是否完成，并引用依据文档；答复里保留短语 "regression coverage"。'
      }
    )

    const toolResults = getEventsByType(runtime, 'tool_call_result')
    const firstKbResult = toolResults.find((event) => event.toolName.startsWith('kb_'))
    const kbPreview = firstKbResult ? getFirstPreviewRecord(firstKbResult.outputPreview) : null

    return {
      output,
      kbPreview,
      toolCalls: getEventsByType(runtime, 'tool_call_started'),
      deliveries: getEventsByType(runtime, 'task_delivery_ready')
    }
  },
  assert: async (result, runtime) => {
    const joinedOutputText = [
      result.output.summary,
      result.output.deliveryMarkdown,
      JSON.stringify(result.output.resultData || {})
    ].join('\n')

    runtime.assertThat(
      result.output.status === 'completed' &&
        result.output.resultCode === 'ok' &&
        result.output.localSourceStatus === 'used',
      {
        name: 'human-live-kb-answer-completed',
        message: 'live human 应能基于本地 KB 形成完成态问答交付',
        data: {
          status: result.output.status,
          resultCode: result.output.resultCode,
          localSourceStatus: result.output.localSourceStatus,
          summary: result.output.summary,
          resultData: result.output.resultData,
          toolNames: result.toolCalls.map((event) => event.toolName)
        }
      }
    )
    runtime.assertThat(
      Boolean(result.kbPreview) &&
        String(result.kbPreview?.document_name || '').includes('release-checklist.md') &&
        String(result.kbPreview?.document_id || '').includes('doc-beta'),
      {
        name: 'human-live-kb-answer-evidence',
        message: 'live human 应先拿到可回看的 KB 文档证据'
      }
    )
    runtime.assertThat(
      joinedOutputText.includes('regression coverage') &&
        (joinedOutputText.includes('release-checklist.md') || joinedOutputText.includes('doc-beta')),
      {
        name: 'human-live-kb-answer-result-data',
        message: 'live human 应在交付中保留答案关键短语和文档引用'
      }
    )
    runtime.assertThat(
      result.toolCalls.some((event) => event.toolName.startsWith('kb_')) &&
        result.toolCalls.every((event) => event.toolName.startsWith('kb_')) &&
        result.deliveries.length === 1,
      {
        name: 'human-live-kb-answer-events',
        message: 'live human 直接问答应只留下 KB 检索和最终交付事件'
      }
    )
  }
})
