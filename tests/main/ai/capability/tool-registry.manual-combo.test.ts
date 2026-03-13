import path from 'node:path'
import { describe, test } from 'vitest'
import { buildCapabilityToolRegistry } from '../../../../src/main/services/ai/tools/registry'
import type { SearchResult } from '../../../../src/shared/types'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/docx/sample-edit.docx')
const CASE_METADATA = {
  description: '直接通过 capability registry 组合调用 retrieval/terminal/docx，验证跨能力协作证据。',
  expectedOutcome: 'success',
  scenarioTags: ['combo', 'manual-orchestration', 'tool-registry'],
  requiredFixtures: [FIXTURE_SOURCE],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'tool-registry'
} as const

type JsonScalar = string | number | boolean | null

type JsonValue = JsonScalar | JsonRecord | JsonValue[]

type JsonRecord = {
  [key: string]: JsonValue
}

const asRecord = (value: JsonValue | undefined): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as JsonRecord
}

const asString = (value: JsonValue | undefined): string => {
  return String(value || '')
}

const asBoolean = (value: JsonValue | undefined): boolean => {
  return value === true
}

describe('capability/tool-registry combo', () => {
  test('manual orchestration across retrieval + terminal + docx should keep end-to-end tool evidence', async () => {
    await runCapabilityCase({
      caseId: 'tool-registry-manual-combo',
      description: CASE_METADATA.description,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.docx' }],
      buildExecutionOutcome: (result) => {
        const retrievalCount = Number(result.retrievalCount || 0)
        const terminalCode = asString(asRecord(result.terminalResult).code)
        const saveCode = asString(asRecord(result.saveResult).code)
        const completed = retrievalCount > 0 && terminalCode === 'ok' && saveCode === 'ok'
        return {
          status: completed ? 'completed' : 'failed',
          resultCode: completed ? 'ok' : saveCode || terminalCode || 'unknown',
          summary: `retrieval=${retrievalCount}, terminal=${terminalCode}, save=${saveCode}`
        }
      },
      execute: async (runtime) => {
        const ctx = {
          ...runtime.ctx,
          selectedDocumentIds: ['doc-a'],
          documentsStore: {
            ...runtime.ctx.documentsStore,
            hybridSearch: async (
              _vector: Float32Array,
              _queryText: string,
              _limit?: number,
              _sourceType?: string,
              _documentIds?: string[]
            ) => {
              return [
                {
                  id: 'chunk-1',
                  text: 'Hello from retrieval evidence',
                  document_name: 'doc-a',
                  document_id: 'doc-a',
                  source_type: 'file',
                  metadata: { page: 1 },
                  created_at: Date.now()
                }
              ] satisfies SearchResult[]
            }
          }
        }

        const registry = buildCapabilityToolRegistry({
          ctx,
          runId: runtime.runId,
          taskId: runtime.taskId
        })

        const getTool = (name: string) => {
          const found = registry.allTools.find((item) => String(item.name) === name)
          if (!found) throw new Error(`tool not found: ${name}`)
          return found
        }

        const retrievalResult = (await getTool('kb_hybrid_search_chunks').invoke({
          queryText: 'hello',
          limit: 5
        })) as JsonValue
        const terminalResult = asRecord(
          (await getTool('terminal_run_command').invoke({
            command: 'touch combo-note.txt',
            expectedArtifacts: [
              {
                path: 'combo-note.txt',
                operation: 'created',
                summary: 'combo note created'
              }
            ]
          })) as JsonValue
        )

        const openResult = asRecord((await getTool('docx_open').invoke({ sourcePath: 'input.docx' })) as JsonValue)
        const docId = asString(openResult.docId)
        const applyResult = asRecord(
          (await getTool('docx_apply_ops').invoke({
            docId,
            ops: [
              {
                type: 'replace_text',
                query: 'Hello',
                replace: 'Hello combo',
                replaceAll: false
              }
            ]
          })) as JsonValue
        )
        const newDocId = asString(applyResult.newDocId)
        const saveResult = asRecord(
          (await getTool('docx_save').invoke({
            docId: newDocId,
            outPath: 'output-combo.docx'
          })) as JsonValue
        )

        const toolSequence = runtime.eventCollector
          .snapshot()
          .filter((event) => event.type === 'tool_call_started')
          .map((event) => event.toolName)

        return {
          retrievalCount: Array.isArray(retrievalResult) ? retrievalResult.length : 0,
          terminalResult,
          openResult,
          applyResult,
          saveResult,
          toolSequence,
          artifacts: runtime.eventCollector
            .snapshot()
            .filter((event) => event.type === 'file_artifact')
            .map((event) => event.path)
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'combo.retrieval.has-evidence',
          pass: Number(result.retrievalCount || 0) > 0,
          details: `retrievalCount=${String(result.retrievalCount)}`
        })
        recordAssertion(runtime.assertions, {
          id: 'combo.terminal.ok',
          pass:
            asBoolean(asRecord(result.terminalResult).ok) &&
            asString(asRecord(result.terminalResult).code) === 'ok',
          details: JSON.stringify(asRecord(result.terminalResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'combo.docx.open-apply-save.ok',
          pass:
            asBoolean(asRecord(result.openResult).ok) &&
            asBoolean(asRecord(result.applyResult).ok) &&
            asBoolean(asRecord(result.saveResult).ok),
          details: JSON.stringify({
            open: asRecord(result.openResult),
            apply: asRecord(result.applyResult),
            save: asRecord(result.saveResult)
          })
        })

        const started = Array.isArray(result.toolSequence)
          ? result.toolSequence.filter((item): item is string => typeof item === 'string')
          : []
        const hasRetrievalFirst = started[0] === 'kb_hybrid_search_chunks'
        const hasTerminal = started.includes('terminal_run_command')
        const hasDocx = started.includes('docx_open') && started.includes('docx_save')
        recordAssertion(runtime.assertions, {
          id: 'combo.tool-sequence.cross-capability',
          pass: hasRetrievalFirst && hasTerminal && hasDocx,
          details: JSON.stringify({ started, sequenceCount: started.length })
        })

        const artifactPaths = (Array.isArray(result.artifacts) ? result.artifacts : []) as string[]
        recordAssertion(runtime.assertions, {
          id: 'combo.artifacts.multiple-capabilities',
          pass:
            artifactPaths.some((item) => item.endsWith('combo-note.txt')) &&
            artifactPaths.some((item) => item.endsWith('output-combo.docx')),
          details: artifactPaths.join(', ')
        })
      }
    })
  })
})
