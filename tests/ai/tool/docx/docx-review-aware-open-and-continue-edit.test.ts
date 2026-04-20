import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxMutationResult,
  type DocxSearchResult
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-review-aware-open-and-continue-edit', async () => {
    await runBackendCase({
      caseId: 'docx-review-aware-open-and-continue-edit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 active review 场景下 docx 自动 open 会继续打开最新 working draft 并叠加新改动。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'review-aware-source.docx', [
          {
            type: 'paragraph',
            text: 'Cycle 1 draft content.'
          },
          {
            type: 'paragraph',
            text: 'Keep original note.'
          }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'review-aware-effective-draft.docx', [
          {
            type: 'paragraph',
            text: 'Cycle 2 draft content.'
          },
          {
            type: 'paragraph',
            text: 'Keep original note.'
          }
        ])

        await runtime.seedDraftReview({
          sessionId: 'review-aware-session',
          runId: runtime.runId,
          title: 'Review aware docx seed',
          status: 'pending_confirm',
          documents: [
            {
              sourcePath: `${runtime.workspaceRoot}/review-aware-source.docx`,
              confirmBasePath: `${runtime.workspaceRoot}/review-aware-effective-draft.docx`,
              sourceName: 'review-aware-source.docx'
            }
          ]
        })

        const harness = createDocxToolHarness(runtime)

        try {
          const readDraft = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'review-aware-source.docx',
            query: 'Cycle 2 draft content.'
          })
          const readSourceOnly = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'review-aware-source.docx',
            query: 'Cycle 1 draft content.'
          })
          const applied = await harness.invoke<DocxMutationResult>('docx_text_edit', {
            sourcePath: 'review-aware-source.docx',
            query: 'Cycle 2 draft content.',
            replace: 'Cycle 3 cumulative draft content.'
          })
          const readAfter = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: applied.sourcePath,
            query: 'Cycle 3 cumulative draft content.'
          })
          return {
            readDraft,
            readSourceOnly,
            applied,
            readAfter,
            trackedSourcePath:
              harness.state.documentSessionBySourcePath.get(applied.sourcePath)?.sourcePath || ''
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.readDraft.matches.length === 1 && result.readSourceOnly.matches.length === 0,
          {
            name: 'review-aware-open-reads-latest-effective-draft',
            message: '存在 active review 时，docx 自动 open 应先打开 latest working draft，而不是源文件旧内容。',
            data: {
              searchDraft: result.readDraft.matches,
              searchSourceOnly: result.readSourceOnly.matches
            }
          }
        )

        runtime.assertThat(
          result.applied.changedBlocks.length === 1 &&
            result.readAfter.matches.length === 1 &&
            result.applied.warnings.length === 0 &&
            result.trackedSourcePath.endsWith('/review-aware-source.docx'),
          {
            name: 'review-aware-edit-keeps-cumulative-delta-and-source-target',
            message: '继续编辑后应在最新草稿上叠加 delta，并继续跟踪原始 sourcePath 作为后续落盘目标。',
            data: {
              changedBlocks: result.applied.changedBlocks,
              searchAfter: result.readAfter.matches,
              trackedSourcePath: result.trackedSourcePath,
              warnings: result.applied.warnings
            }
          }
        )
      }
    })
  })
})
