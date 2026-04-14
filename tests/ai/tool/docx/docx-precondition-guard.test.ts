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
      description: '验证未 open 或传入无效 sourcePath 时的前置保护。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createDocxToolHarness(runtime)
        try {
          return {
            outlineWithoutOpen: await harness.invoke<DocxFailureResult>('docx_outline', {
              sourcePath: 'missing.docx'
            }),
            searchWithoutOpen: await harness.invoke<DocxFailureResult>('docx_search', {
              sourcePath: 'missing.docx',
              query: 'hello',
              mode: 'literal'
            }),
            applyWithoutOpen: await harness.invoke<DocxFailureResult>('docx_apply_ops', {
              sourcePath: 'missing.docx',
              ops: [
                {
                  type: 'replace_text',
                  query: 'hello',
                  replace: 'hi'
                }
              ]
            }),
            rollbackWithoutOpen: await harness.invoke<DocxFailureResult>('docx_rollback', {
              sourcePath: 'missing.docx',
              steps: 1
            }),
            trackedSourceCount: harness.state.documentSessionBySourcePath.size
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
          ].every((item) => item.ok === false && item.code === 'invalid_input'),
          {
            name: 'docx-tools-fail-fast-before-open',
            message: '未 open 时，docx 工具应返回明确失败，不生成新版本。',
            data: result
          }
        )

        runtime.assertThat(
          result.trackedSourceCount === 0,
          {
            name: 'docx-precondition-failures-do-not-pollute-runtime-state',
            message: '前置条件失败后，不应生成新版本，也不应污染当前 run 状态。',
            data: {
              trackedSourceCount: result.trackedSourceCount
            }
          }
        )
      }
    })
  })
})
