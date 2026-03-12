import { describe, expect, test } from 'vitest'
import { isLiveSuiteEnabled } from '../../../harness/main/llmConfig'
import { recordAssertion } from '../../../harness/main/assertions'
import { runHumanCase } from '../../../harness/main/humanCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const CASE_ID = 'human-local-kb-empty-result-block'
const DOCUMENT_ID = 'doc-empty'

describe('human', () => {
  test.skipIf(!isLiveSuiteEnabled())('human 在 local-kb 空结果时应阻塞而非猜测完成', async () => {
    await runHumanCase({
      caseId: CASE_ID,
      description: '验证 human 在 local-kb 为空时会阻塞收敛，而不是猜测答案。',
      objective:
        '请只使用当前可访问的本地知识库，不要读取 workspace 文件。回答 “Project Atlas 的负责人是谁？”。如果本地知识库没有明确证据，请阻塞并说明原因；不要猜测。只有在确认无误时才完成任务，且 resultData 必须包含 answer 字段。',
      expectedOutcome: 'blocked',
      scenarioTags: ['human', 'local-kb', 'empty-result', 'negative-path'],
      requiredFixtures: [],
      fixtureCopies: [],
      bindWorkspace: false,
      selectedDocumentIds: [DOCUMENT_ID],
      documentsStoreOverrides: {
        hybridSearch: async () => [],
        vectorSearch: async () => [],
        ftsSearch: async () => [],
        listDocuments: async () => ({ items: [], total: 0 })
      },
      approvalPolicy: 'auto-approve',
      maxSteps: 8,
      assert: async (result, runtime) => {
        const events = runtime.eventCollector.snapshot()
        const kbToolCalls = events.filter(
          (event) =>
            event.type === 'tool_call_started' &&
            String(event.toolName || '').startsWith('kb_') &&
            String(event.taskId || '') === runtime.taskId
        ).length

        recordAssertion(runtime.assertions, {
          id: 'human.status.blocked',
          pass: result.status === 'blocked',
          details: `status=${result.status}, resultCode=${result.resultCode}, summary=${result.summary}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.events.kb-attempted',
          pass: kbToolCalls >= 1,
          details: `kbToolCalls=${kbToolCalls}`
        })
        recordAssertion(runtime.assertions, {
          id: 'human.result.no-answer',
          pass: result.resultData?.answer === undefined,
          details: JSON.stringify(result.resultData)
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-human', CASE_ID)
    expect(report.metrics.executionStatus).toBe('blocked')
    expect(report.signals.finalHumanAction).toBe('block_task')
    expect(report.signals.skillActivationSequence).toContain('local-kb-retrieval')
    expect(report.signals.resultDataKeys).not.toContain('answer')
    expect(report.metrics.qualityGrade).toBe('expected_block')
  }, 240000)
})
