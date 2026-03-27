import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxApplyOpsResult,
  type DocxOpenResult,
  type DocxPreviewResult,
  type DocxSearchResult,
  type DocxValidateResult
} from './testUtils'

const SAMPLE_DOCX_FIXTURE = path.resolve('tests/fixtures/ai/docx/sample-edit.docx')

describe('ai tool docx backend', () => {
  it('docx-minimal-edit-flow', async () => {
    await runBackendCase({
      caseId: 'docx-minimal-edit-flow',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证修改 docx 某一段话的最小工具链能独立跑通。',
      fixtures: [SAMPLE_DOCX_FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createDocxToolHarness(runtime)
        try {
          const sourcePath = runtime.getFixtureWorkspacePath(SAMPLE_DOCX_FIXTURE)
          const opened = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath
          })
          const searchBefore = await harness.invoke<DocxSearchResult>('docx_search', {
            docId: opened.docId,
            query: 'Hello',
            mode: 'literal'
          })
          const applied = await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
            docId: opened.docId,
            ops: [
              {
                type: 'replace_text',
                query: 'Hello',
                replace: 'Hi'
              }
            ]
          })
          const searchAfter = await harness.invoke<DocxSearchResult>('docx_search', {
            docId: applied.newDocId,
            query: 'Hi',
            mode: 'literal'
          })
          const validated = await harness.invoke<DocxValidateResult>('docx_validate', {
            docId: applied.newDocId
          })
          const preview = await harness.invoke<DocxPreviewResult>('docx_render_preview', {
            docId: applied.newDocId,
            format: 'html'
          })

          return {
            opened,
            searchBefore,
            applied,
            searchAfter,
            validated,
            preview,
            previewExists: await fs
              .access(preview.previewPath)
              .then(() => true)
              .catch(() => false)
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.searchBefore.matches.length === 1 &&
            result.applied.newDocId !== result.opened.docId &&
            result.applied.changedBlocks.length === 1 &&
            result.applied.changedBlocks[0]?.action === 'replace_text',
          {
            name: 'minimal-edit-flow-produces-single-targeted-change',
            message: '最小编辑流程应生成新的 docId，且只命中目标段落对应的 changedBlocks。',
            data: {
              originalDocId: result.opened.docId,
              newDocId: result.applied.newDocId,
              changedBlocks: result.applied.changedBlocks
            }
          }
        )

        runtime.assertThat(
          result.searchAfter.matches.length === 1 &&
            result.validated.problems.length === 0 &&
            result.previewExists,
          {
            name: 'minimal-edit-flow-validates-and-produces-preview',
            message: '修改后应能 validate 通过，并生成可回看的 preview artifact。',
            data: {
              searchAfter: result.searchAfter.matches,
              validationProblems: result.validated.problems,
              previewPath: result.preview.previewPath,
              previewExists: result.previewExists
            }
          }
        )
      }
    })
  })
})
