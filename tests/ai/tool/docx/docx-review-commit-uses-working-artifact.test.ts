import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-review-commit-uses-working-artifact', async () => {
    await runBackendCase({
      caseId: 'docx-review-commit-uses-working-artifact',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证提交确认文档时以 working artifact 落盘，而不是以 review artifact 落盘。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'commit-source.docx', [
          {
            type: 'paragraph',
            text: '源文档内容。'
          }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'commit-review.docx', [
          {
            type: 'paragraph',
            text: '这是审阅副本内容。'
          }
        ])
        await writeTestDocxFile(runtime.workspaceRoot, 'commit-working.docx', [
          {
            type: 'paragraph',
            text: '这是最终工作稿内容。'
          }
        ])

        const seeded = await runtime.seedDraftReview({
          sessionId: 'commit-working-session',
          runId: runtime.runId,
          title: 'Commit uses working artifact',
          status: 'pending_confirm',
          documents: [
            {
              sourcePath: `${runtime.workspaceRoot}/commit-source.docx`,
              confirmBasePath: `${runtime.workspaceRoot}/commit-review.docx`,
              sourceName: 'commit-source.docx'
            }
          ]
        })

        const detail = await runtime.draftReviewStore.getReviewDetail(seeded.reviewId)
        const document = detail?.documents[0]
        if (!document?.working_artifact_path) {
          throw new Error('expected seeded working artifact path')
        }

        await writeTestDocxFile(runtime.workspaceRoot, 'commit-working.docx', [
          {
            type: 'paragraph',
            text: '这是最终工作稿内容。'
          },
          {
            type: 'paragraph',
            text: '第二段落来自 working artifact。'
          }
        ])

        const workingSourceBuffer = await fs.readFile(`${runtime.workspaceRoot}/commit-working.docx`)
        await fs.writeFile(document.working_artifact_path, workingSourceBuffer)

        const commit = await runtime.draftReviewService.commitReview({
          reviewId: seeded.reviewId,
          overwrite: true
        })

        const harness = createDocxToolHarness(runtime)
        try {
          const committedSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'commit-source.docx',
            query: '这是最终工作稿内容。'
          })
          const committedSecondParagraph = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'commit-source.docx',
            query: '第二段落来自 working artifact。'
          })
          const reviewOnlySearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'commit-source.docx',
            query: '这是审阅副本内容。'
          })

          return {
            commit,
            committedSearch,
            committedSecondParagraph,
            reviewOnlySearch
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.commit.success === true, {
          name: 'commit-job-completes',
          message: 'draft review 提交应成功完成。',
          data: result.commit
        })

        runtime.assertThat(
          result.committedSearch.matches.length === 1 &&
            result.committedSecondParagraph.matches.length === 1 &&
            result.reviewOnlySearch.matches.length === 0,
          {
            name: 'commit-writes-working-artifact-content',
            message: '提交后磁盘源文件应采用 working artifact 内容，而不是 review artifact 内容。',
            data: {
              committedSearch: result.committedSearch.matches,
              committedSecondParagraph: result.committedSecondParagraph.matches,
              reviewOnlySearch: result.reviewOnlySearch.matches
            }
          }
        )
      }
    })
  })
})
