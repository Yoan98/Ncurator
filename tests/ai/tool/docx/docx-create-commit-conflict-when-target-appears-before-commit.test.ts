import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxCreateResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-create-commit-conflict-when-target-appears-before-commit', async () => {
    await runBackendCase({
      caseId: 'docx-create-commit-conflict-when-target-appears-before-commit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 create-target review 在目标文件被外部抢占创建后会触发 freshness conflict。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxReviewRun()
          await harness.invoke<DocxCreateResult>('docx_create', {
            sourcePath: 'generated-summary.docx',
            blocks: [{ type: 'paragraph', text: '反走样：采样频率不足时会出现锯齿。' }]
          })
          const details = await harness.ctx.finalizeDocxReviewRun()
          await runtime.fileReviewService.persistMaterializedReviews(details)

          await writeTestDocxFile(runtime.workspaceRoot, 'generated-summary.docx', [
            { type: 'paragraph', text: '外部文件已抢占目标路径。' }
          ])

          const validation = await runtime.fileReviewService.validateCommit({
            reviewId: details[0]!.review.id
          })
          const commit = await runtime.fileReviewService.commitReview({
            reviewId: details[0]!.review.id,
            overwrite: true
          })

          return {
            validation,
            commit
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.validation.ready === false &&
            result.validation.issues.some((issue) => issue.code === 'source_changed') &&
            result.commit.success === false &&
            result.commit.job?.status === 'conflicted',
          {
            name: 'docx-create-detects-target-create-conflict',
            message: 'create-target review 在目标路径被外部创建后应阻止 commit，并标记为 conflicted。',
            data: result
          }
        )
      }
    })
  })
})
