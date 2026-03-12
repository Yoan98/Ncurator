import path from 'node:path'
import type { DocumentRecord, SearchResult } from '../../../../src/shared/types'
import { describe, expect, test } from 'vitest'
import { isLiveSuiteEnabled } from '../../../harness/main/llmConfig'
import { recordAssertion } from '../../../harness/main/assertions'
import { runHumanCase } from '../../../harness/main/humanCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/fixtures/main/workspace/human-input.txt')
const CASE_ID = 'human-multi-skill-kb-then-shell'
const DOCUMENT_ID = 'doc-workspace-hint'
const DOCUMENT_NAME = 'input.txt'
const EXPECTED_FIRST_LINE = 'Hello from human fixture.'

const buildSearchResult = (): SearchResult[] => [
  {
    id: 'chunk-workspace-hint',
    text: '需要读取的 workspace 文件名是 input.txt。',
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
  test.skipIf(!isLiveSuiteEnabled())('human 应能先经 local-kb 再用 workspace-shell 完成任务', async () => {
    await runHumanCase({
      caseId: CASE_ID,
      description: '验证 human 在单任务中按 KB 提示切换到 workspace-shell 完成读取。',
      objective:
        '我不知道要读取哪个 workspace 文件。请先从当前可访问的本地知识库找出需要读取的文件名，再在当前 workspace 中读取该文件的第一行。不要跳过本地知识库步骤。完成任务时 resultData 必须包含 source_file 和 first_line 字段。',
      expectedOutcome: 'success',
      scenarioTags: ['human', 'multi-skill', 'local-kb', 'workspace-shell'],
      requiredFixtures: [FIXTURE_SOURCE],
      fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.txt' }],
      selectedDocumentIds: [DOCUMENT_ID],
      documentsStoreOverrides: {
        hybridSearch: async () => buildSearchResult(),
        vectorSearch: async () => [],
        ftsSearch: async () => [],
        listDocuments: async () => buildDocumentList()
      },
      approvalPolicy: 'auto-approve',
      maxSteps: 12,
      assert: async (result, runtime) => {
        const events = runtime.eventCollector.snapshot()
        const kbLoadIndex = events.findIndex(
          (event) =>
            event.type === 'human_step' &&
            event.action === 'load_skill' &&
            event.skillId === 'local-kb-retrieval' &&
            String(event.taskId || '') === runtime.taskId
        )
        const shellLoadIndex = events.findIndex(
          (event) =>
            event.type === 'human_step' &&
            event.action === 'load_skill' &&
            event.skillId === 'workspace-shell' &&
            String(event.taskId || '') === runtime.taskId
        )
        const kbToolIndex = events.findIndex(
          (event) =>
            event.type === 'tool_call_started' &&
            String(event.toolName || '').startsWith('kb_') &&
            String(event.taskId || '') === runtime.taskId
        )
        const shellToolIndex = events.findIndex(
          (event) =>
            event.type === 'tool_call_started' &&
            event.toolName === 'terminal_run_command' &&
            String(event.taskId || '') === runtime.taskId
        )

        recordAssertion(runtime.assertions, {
          id: 'human.status.completed',
          pass: result.status === 'completed',
          details: `status=${result.status}, resultCode=${result.resultCode}, summary=${result.summary}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.skills.kb-before-shell',
          pass:
            kbLoadIndex >= 0 &&
            shellLoadIndex > kbLoadIndex &&
            kbToolIndex >= 0 &&
            shellToolIndex > kbToolIndex,
          details: `kbLoadIndex=${kbLoadIndex}, shellLoadIndex=${shellLoadIndex}, kbToolIndex=${kbToolIndex}, shellToolIndex=${shellToolIndex}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.result.source-file',
          pass: result.resultData?.source_file === 'input.txt',
          details: JSON.stringify(result.resultData)
        })
        recordAssertion(runtime.assertions, {
          id: 'human.result.first-line',
          pass: result.resultData?.first_line === EXPECTED_FIRST_LINE,
          details: JSON.stringify(result.resultData)
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-human', CASE_ID)
    expect(report.metrics.executionStatus).toBe('completed')
    expect(report.signals.skillActivationSequence).toContain('local-kb-retrieval')
    expect(report.signals.skillActivationSequence).toContain('workspace-shell')
    const firstKbToolIndex = report.signals.toolSequence.findIndex((toolName) => toolName.startsWith('kb_'))
    expect(firstKbToolIndex).toBeGreaterThanOrEqual(0)
    expect(firstKbToolIndex).toBeLessThan(report.signals.toolSequence.indexOf('terminal_run_command'))
    expect(report.signals.resultDataKeys).toContain('source_file')
    expect(report.signals.resultDataKeys).toContain('first_line')
  }, 240000)
})
