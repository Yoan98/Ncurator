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
      description: '验证自动 open 下，传入无效 sourcePath 时的前置保护。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createDocxToolHarness(runtime)
        try {
          return {
            outlineInvalidPath: await harness.invoke<DocxFailureResult>('docx_outline', {
              sourcePath: 'missing.docx'
            }),
            readInvalidPath: await harness.invoke<DocxFailureResult>('docx_read', {
              sourcePath: 'missing.docx',
              fromBlockId: 'b:0'
            }),
            editInvalidPath: await harness.invoke<DocxFailureResult>('docx_text_edit', {
              sourcePath: 'missing.docx',
              query: 'hello',
              replace: 'hi'
            }),
            rollbackInvalidPath: await harness.invoke<DocxFailureResult>('docx_rollback', {
              sourcePath: 'missing.docx',
              versionRef: 'v1'
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
            result.outlineInvalidPath,
            result.readInvalidPath,
            result.editInvalidPath,
            result.rollbackInvalidPath
          ].every((item) => item.ok === false),
          {
            name: 'docx-tools-fail-fast-on-invalid-source-path',
            message: '自动 open 模式下，docx 工具遇到无效 sourcePath 仍应明确失败，不生成新版本。',
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
