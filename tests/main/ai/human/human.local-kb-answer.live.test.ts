import type { DocumentRecord, SearchResult } from '../../../../src/shared/types'
import { describe, expect, test } from 'vitest'
import { isLiveSuiteEnabled } from '../../../harness/main/llmConfig'
import { recordAssertion } from '../../../harness/main/assertions'
import { runHumanCase } from '../../../harness/main/humanCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const CASE_ID = 'human-local-kb-answer'
const DOCUMENT_ID = 'doc-atlas'
const DOCUMENT_NAME = 'atlas-notes.md'
const EXPECTED_ANSWER = 'Ada Lovelace'
const CASE_METADATA = {
  description: '验证 human 在仅依赖本地知识库时能够加载 local-kb skill 并完成问答。',
  taskGoal:
    '请只使用当前可访问的本地知识库，不要读取 workspace 文件。回答 “Project Atlas 的负责人是谁？”。只有在本地证据明确时才完成任务；完成任务时 resultData 必须包含 answer 和 document_name 字段。',
  scenarioTags: ['human', 'local-kb', 'success-path'],
  expectedOutcome: 'success',
  requiredFixtures: [],
  retentionTier: 'live-eval',
  lifecycle: 'active',
  runPolicy: 'batch_only',
  capabilityArea: 'human-live',
  profiles: ['human-default']
} as const

const buildSearchResult = (): SearchResult[] => [
  {
    id: 'chunk-atlas-owner',
    text: 'Project Atlas 的负责人是 Ada Lovelace。',
    document_name: DOCUMENT_NAME,
    document_id: DOCUMENT_ID,
    source_type: 'file',
    metadata: { page: 1 },
    created_at: Date.now()
  }
]

const buildDocumentList = (): { items: DocumentRecord[]; total: number } => ({
  items: [
    {
      id: DOCUMENT_ID,
      name: DOCUMENT_NAME,
      source_type: 'file',
      created_at: Date.now(),
      import_status: 2
    }
  ],
  total: 1
})

describe('human', () => {
  test.skipIf(!isLiveSuiteEnabled())('human 应能通过 local-kb skill 回答知识库问题', async () => {
    await runHumanCase({
      caseId: CASE_ID,
      description: CASE_METADATA.description,
      objective: CASE_METADATA.taskGoal,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [],
      bindWorkspace: false,
      selectedDocumentIds: [DOCUMENT_ID],
      documentsStoreOverrides: {
        hybridSearch: async () => buildSearchResult(),
        vectorSearch: async () => [],
        ftsSearch: async () => [],
        listDocuments: async () => buildDocumentList()
      },
      approvalPolicy: 'auto-approve',
      maxSteps: 10,
      assert: async (result, runtime) => {
        const events = runtime.eventCollector.snapshot()
        const loadedKbSkill = events.some(
          (event) =>
            event.type === 'human_step' &&
            event.action === 'load_skill' &&
            event.skillId === 'local-kb-retrieval' &&
            String(event.taskId || '') === runtime.taskId
        )
        const usedKbHybridSearch = events.some(
          (event) =>
            event.type === 'tool_call_started' &&
            event.toolName === 'kb_hybrid_search_chunks' &&
            String(event.taskId || '') === runtime.taskId
        )

        recordAssertion(runtime.assertions, {
          id: 'human.status.completed',
          pass: result.status === 'completed',
          details: `status=${result.status}, resultCode=${result.resultCode}, summary=${result.summary}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.skills.local-kb-loaded',
          pass: loadedKbSkill,
          details: 'expected load_skill(local-kb-retrieval)'
        })
        recordAssertion(runtime.assertions, {
          id: 'human.events.kb-hybrid-search',
          pass: usedKbHybridSearch,
          details: 'expected kb_hybrid_search_chunks tool call'
        })
        recordAssertion(runtime.assertions, {
          id: 'human.result.answer',
          pass: result.resultData?.answer === EXPECTED_ANSWER,
          details: JSON.stringify(result.resultData)
        })
        recordAssertion(runtime.assertions, {
          id: 'human.result.document-name',
          pass:
            result.resultData?.document_name === DOCUMENT_NAME ||
            result.resultData?.document_name === DOCUMENT_ID,
          details: JSON.stringify(result.resultData)
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-human', CASE_ID)
    expect(report.metrics.executionStatus).toBe('completed')
    expect(report.signals.finalHumanAction).toBe('complete_task')
    expect(report.signals.skillActivationSequence).toContain('local-kb-retrieval')
    expect(report.signals.toolSequence).toContain('kb_hybrid_search_chunks')
    expect(report.signals.resultDataKeys).toContain('answer')
    expect(report.metrics.qualityGrade).toMatch(/hard_pass|soft_pass/)
  }, 240000)
})
