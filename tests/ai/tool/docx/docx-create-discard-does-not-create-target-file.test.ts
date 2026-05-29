import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { createDocxToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxCreateResult } from './testUtils'

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

describe('ai tool docx backend', () => {
  it('docx-create-discard-does-not-create-target-file', async () => {
    await runBackendCase({
      caseId: 'docx-create-discard-does-not-create-target-file',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 discard create-target review 不会创建正式目标文件。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxReviewRun()
          await harness.invoke<DocxCreateResult>('docx_edit', {
            sourcePath: 'generated-summary.docx',
            actions: [{
              type: 'create_document',
              blocks: [{ type: 'paragraph', text: '过拟合：训练时间过久时容易出现。' }]
            }]
          })
          const details = await harness.ctx.finalizeDocxReviewRun()
          await runtime.fileReviewService.persistMaterializedReviews(details)
          const discard = await runtime.fileReviewService.discardReview({
            reviewId: details[0]!.review.id
          })

          return {
            discard,
            targetExists: await fileExists(`${runtime.workspaceRoot}/generated-summary.docx`)
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.discard.success === true &&
            result.discard.review?.status === 'discarded' &&
            result.targetExists === false,
          {
            name: 'docx-create-discard-keeps-target-absent',
            message: 'discard create-target review 后不应生成正式目标文件。',
            data: result
          }
        )
      }
    })
  })
})
