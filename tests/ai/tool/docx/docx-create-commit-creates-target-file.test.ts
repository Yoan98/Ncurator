import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { createDocxToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxCreateResult, DocxSearchResult } from './testUtils'

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

describe('ai tool docx backend', () => {
  it('docx-create-commit-creates-target-file', async () => {
    await runBackendCase({
      caseId: 'docx-create-commit-creates-target-file',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 create-target review 在 commit 成功后才正式创建目标文件。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const targetPath = `${runtime.workspaceRoot}/generated-summary.docx`
        const harness = createDocxToolHarness(runtime)
        let reviewId = ''
        try {
          harness.ctx.beginDocxReviewRun()
          await harness.invoke<DocxCreateResult>('docx_edit', {
            sourcePath: 'generated-summary.docx',
            actions: [{
              type: 'create_document',
              blocks: [
              { type: 'heading', level: 1, text: '深度学习与图形学复习总结' },
              { type: 'paragraph', text: '过拟合：训练时间过久时容易出现。' }
            ]
            }]
          })
          const details = await harness.ctx.finalizeDocxReviewRun()
          await runtime.fileReviewService.persistMaterializedReviews(details)
          reviewId = details[0]?.review.id || ''
          const persisted = reviewId
            ? await runtime.fileReviewStore.getReviewDetail(reviewId)
            : null

          const beforeCommitExists = await fileExists(targetPath)
          const validation = await runtime.fileReviewService.validateCommit({
            reviewId
          })
          const commit = await runtime.fileReviewService.commitReview({
            reviewId,
            overwrite: true
          })
          const afterCommitExists = await fileExists(targetPath)

          await harness.release()

          const verifyHarness = createDocxToolHarness(runtime)
          try {
            const search = await verifyHarness.invoke<DocxSearchResult>('docx_search', {
              sourcePath: 'generated-summary.docx',
              query: '训练时间过久'
            })
            return {
              persisted,
              validation,
              commit,
              beforeCommitExists,
              afterCommitExists,
              search
            }
          } finally {
            await verifyHarness.release()
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.persisted?.review.output_operation === 'created' &&
            result.persisted?.review.source_version.exists === false &&
            result.validation.ready === true &&
            result.commit.success === true &&
            result.commit.job?.results[0]?.operation === 'created' &&
            result.beforeCommitExists === false &&
            result.afterCommitExists === true &&
            result.search.matches.length === 1,
          {
            name: 'docx-create-commit-materializes-target-file',
            message: 'create-target review 应只在 commit 成功后正式创建目标文件，并以 created 语义记录结果。',
            data: result
          }
        )
      }
    })
  })
})
