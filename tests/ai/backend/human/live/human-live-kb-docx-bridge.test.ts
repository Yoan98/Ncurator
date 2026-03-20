import fs from 'node:fs/promises'
import type { DocumentRecord, JsonValue, SearchResult } from '../../../../../src/shared/types'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import {
  defineAiHumanLiveCase,
  getEventsByType,
  loadPrimaryLiveHumanConfig
} from '../helpers'

const releasePolicyDocument: DocumentRecord = {
  id: 'doc-policy',
  name: 'release-policy.md',
  source_type: 'file',
  created_at: 1710000000000,
  import_status: 2
}

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

defineAiHumanLiveCase({
  caseId: 'human-live-kb-docx-bridge',
  caseType: 'live',
  groups: ['live'],
  description: 'live 模型先检索本地 KB，再把规范要求落到 docx preview 并交付。',
  fixtures: [],
  runMode: 'single',
  execute: async (runtime) => {
    let trackedPreviewPath = ''

    await writeTestDocxFile(runtime.workspaceRoot, 'release-check.docx', [
      { type: 'heading', text: 'Release Checklist', level: 1 },
      { type: 'paragraph', text: 'Checklist summary: pending policy sync.' },
      { type: 'paragraph', text: 'Risk note: TBD.' }
    ])

    const runner = createHumanTestRunner(
      runtime,
      {
        trackDocxPreview: ({ previewPath }) => {
          trackedPreviewPath = previewPath
        },
        selectedDocumentIds: ['doc-policy'],
        liveModelConfig: loadPrimaryLiveHumanConfig(),
        documentsStoreOverrides: {
          hybridSearch: async () => {
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
          },
          vectorSearch: async () => {
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
          },
          ftsSearch: async () => {
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
          },
          listDocuments: async () => ({
            items: [releasePolicyDocument],
            total: 1
          }),
          getDocumentById: async (id: string) => (id === 'doc-policy' ? releasePolicyDocument : null)
        }
      },
      { hardActionLimit: 12 }
    )

    const output = await runner.run(
      {
        taskId: runtime.taskId,
        userInput:
          '请仅在当前已选本地文档范围内做一次发布规范检索，来源就是 release-policy.md。拿到条款后不要再列文档、不要重复检索、不要使用 terminal，也不需要 save。随后直接打开 release-check.docx，把 “Checklist summary: pending policy sync.” 替换成 “Checklist summary: Mention approval-denied coverage and terminal artifact assertion before sign-off.”，生成可审阅 preview，并以 handoff 形式交付，在交付里说明来源文档 release-policy.md。'
      }
    )

    const toolCalls = getEventsByType(runtime, 'tool_call_started')
    const toolResults = getEventsByType(runtime, 'tool_call_result')
    const fileArtifacts = getEventsByType(runtime, 'file_artifact')
    const previewPath = trackedPreviewPath
    const previewExists = previewPath ? await fileExists(previewPath) : false
    const firstKbResult = toolResults.find((event) => event.toolName.startsWith('kb_'))
    const kbPreview = firstKbResult ? getFirstPreviewRecord(firstKbResult.outputPreview) : null

    if (!previewExists) {
      return {
        output,
        kbPreview,
        previewExists,
        previewPath,
        summarySearchOk: false,
        summaryMatchCount: 0,
        toolCalls,
        fileArtifacts
      }
    }

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
        query: 'approval-denied coverage and terminal artifact assertion before sign-off',
        mode: 'literal'
      })

      return {
        output,
        kbPreview,
        previewExists,
        previewPath,
        summarySearchOk: summarySearch.ok,
        summaryMatchCount: summarySearch.matches.length,
        toolCalls,
        fileArtifacts
      }
    } finally {
      await inspectionHarness.release()
    }
  },
  assert: async (result, runtime) => {
    const kbCallIndex = result.toolCalls.findIndex((event) => event.toolName.startsWith('kb_'))
    const docxApplyIndex = result.toolCalls.findIndex((event) => event.toolName === 'docx_apply_ops')
    const joinedOutputText = [result.output.summary, result.output.deliveryMarkdown].join('\n')

    runtime.assertThat(
        result.output.status === 'completed',
      {
        name: 'human-live-kb-docx-bridge-completed',
        message: 'live human 的 KB -> DOCX bridge 应形成完成态交付',
        data: {
          status: result.output.status,
          summary: result.output.summary,
          previewExists: result.previewExists,
          previewPath: result.previewPath,
          toolNames: result.toolCalls.map((event) => event.toolName)
        }
      }
    )
    runtime.assertThat(
      Boolean(result.kbPreview) &&
        String(result.kbPreview?.document_name || '').includes('release-policy.md') &&
        String(result.kbPreview?.document_id || '').includes('doc-policy'),
      {
        name: 'human-live-kb-docx-bridge-kb-evidence',
        message: 'live human 应先拿到本地发布规范证据'
      }
    )
    runtime.assertThat(
      result.previewExists &&
        result.summarySearchOk &&
        result.summaryMatchCount >= 1 &&
        joinedOutputText.includes('release-policy.md'),
      {
        name: 'human-live-kb-docx-bridge-preview',
        message: 'live human 应把 KB 规范写入 preview，并在交付中保留来源文档'
      }
    )
    runtime.assertThat(
      kbCallIndex >= 0 &&
        docxApplyIndex > kbCallIndex &&
        result.toolCalls.some((event) => event.toolName === 'docx_open') &&
        result.fileArtifacts.some((event) => event.artifactRole === 'preview'),
      {
        name: 'human-live-kb-docx-bridge-events',
        message: 'live human 应先检索 KB，再进入 docx 编辑和 preview 交付链路'
      }
    )
  }
})
