import { describe, it } from 'vitest'
import { createDocxToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { type DocxFailureResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-precondition-guard', async () => {
    await runBackendCase({
      caseId: 'docx-precondition-guard',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证未 open 或传入无效 docId 时的前置保护。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createDocxToolHarness(runtime)
        try {
          return {
            outlineWithoutOpen: await harness.invoke<DocxFailureResult>('docx_outline', {}),
            searchWithoutOpen: await harness.invoke<DocxFailureResult>('docx_search', {
              query: 'hello',
              mode: 'literal'
            }),
            applyWithoutOpen: await harness.invoke<DocxFailureResult>('docx_apply_ops', {
              ops: [
                {
                  type: 'replace_text',
                  query: 'hello',
                  replace: 'hi'
                }
              ]
            }),
            rollbackWithoutOpen: await harness.invoke<DocxFailureResult>('docx_rollback', {}),
            invalidDocId: await harness.invoke<DocxFailureResult>('docx_search', {
              docId: 'missing-doc-id',
              query: 'hello',
              mode: 'literal'
            }),
            lastDocId: harness.state.lastDocId,
            trackedSourceCount: harness.state.sourcePathByDocId.size
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          [
            result.outlineWithoutOpen,
            result.searchWithoutOpen,
            result.applyWithoutOpen,
            result.rollbackWithoutOpen
          ].every((item) => item.ok === false && item.code === 'invalid_input') &&
            result.invalidDocId.ok === false,
          {
            name: 'docx-tools-fail-fast-before-open',
            message: '未 open 或传入无效 docId 时，docx 工具应返回明确失败，不生成新快照。',
            data: result
          }
        )

        runtime.assertThat(
          !result.lastDocId && result.trackedSourceCount === 0,
          {
            name: 'docx-precondition-failures-do-not-pollute-runtime-state',
            message: '前置条件失败后，不应生成新快照，也不应污染当前 run 状态。',
            data: {
              lastDocId: result.lastDocId,
              trackedSourceCount: result.trackedSourceCount
            }
          }
        )
      }
    })
  })
})
