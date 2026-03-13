import { describe, test } from 'vitest'
import { recordAssertion } from '../../../harness/main/assertions'
import { runRuntimeCase } from '../../../harness/main/capabilityCase'
import { enrichCompleteTaskResultData } from '../../../../src/main/services/ai/node/human/resultData'

describe('main/ai/runtime/human resultData', () => {
  test('complete_task should preserve unique local-kb provenance fields', async () => {
    await runRuntimeCase({
      caseId: 'human-result-data-enrichment',
      description: '验证 human 在 local-kb observation 只有唯一文档来源时，会把 document_name/document_id 收敛到 resultData。',
      expectedOutcome: 'success',
      scenarioTags: ['human', 'local-kb', 'result-data', 'contract'],
      requiredFixtures: [],
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'human result data enrichment completed'
      }),
      execute: async () => {
        const enriched = enrichCompleteTaskResultData({
          resultData: {
            answer: 'Ada Lovelace',
            document_name: 'local-knowledge-base'
          },
          lastObservation: {
            kind: 'tool_result',
            toolName: 'kb_hybrid_search_chunks',
            ok: true,
            code: 'ok',
            summary: 'kb_hybrid_search_chunks returned text evidence',
            data: [
              {
                id: 'chunk-atlas-owner',
                text: 'Project Atlas 的负责人是 Ada Lovelace。',
                document_name: 'atlas-notes.md',
                document_id: 'doc-atlas',
                source_type: 'file'
              }
            ]
          }
        })

        const untouchedAmbiguous = enrichCompleteTaskResultData({
          resultData: {
            answer: 'Ada Lovelace',
            document_name: 'local-knowledge-base'
          },
          lastObservation: {
            kind: 'tool_result',
            toolName: 'kb_hybrid_search_chunks',
            ok: true,
            code: 'ok',
            summary: 'kb_hybrid_search_chunks returned text evidence',
            data: [
              {
                id: 'chunk-a',
                text: 'Project Atlas 的负责人是 Ada Lovelace。',
                document_name: 'atlas-notes.md',
                document_id: 'doc-atlas',
                source_type: 'file'
              },
              {
                id: 'chunk-b',
                text: 'Project Atlas 的负责人是 Ada Lovelace。',
                document_name: 'team-notes.md',
                document_id: 'doc-team',
                source_type: 'file'
              }
            ]
          }
        })

        return {
          enriched,
          untouchedAmbiguous
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'human.result-data.enriches-unique-document-name',
          pass:
            result.enriched?.document_name === 'atlas-notes.md' &&
            result.enriched?.document_id === 'doc-atlas',
          details: JSON.stringify(result.enriched)
        })
        recordAssertion(runtime.assertions, {
          id: 'human.result-data.keeps-answer',
          pass: result.enriched?.answer === 'Ada Lovelace',
          details: JSON.stringify(result.enriched)
        })
        recordAssertion(runtime.assertions, {
          id: 'human.result-data.skips-ambiguous-provenance',
          pass:
            result.untouchedAmbiguous?.document_name === 'local-knowledge-base' &&
            !('document_id' in (result.untouchedAmbiguous || {})),
          details: JSON.stringify(result.untouchedAmbiguous)
        })
      }
    })
  })
})
