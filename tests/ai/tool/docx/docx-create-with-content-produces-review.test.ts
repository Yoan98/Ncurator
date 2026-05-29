import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  buildBlockIndex,
  loadDocxBundle
} from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
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
  it('docx-create-with-content-produces-review', async () => {
    const targetFileName = '深度学习与图形学复习总结.docx'
    await runBackendCase({
      caseId: 'docx-create-with-content-produces-review',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证仅执行 docx_edit(create_document, blocks=...) 也能进入 review 主链并产出待确认稿。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxReviewRun()
          const created = await harness.invoke<DocxCreateResult>('docx_edit', {
            sourcePath: targetFileName,
            actions: [{
              type: 'create_document',
              blocks: [
              { type: 'heading', level: 1, text: '深度学习与图形学复习总结' },
              { type: 'paragraph', text: '过拟合：训练时间过久时容易出现。' },
              { type: 'paragraph', text: '反走样：采样频率不足时会出现锯齿。' }
            ]
            }]
          })
          const details = await harness.ctx.finalizeDocxReviewRun()

          const review = details[0]?.review
          const draftBuffer = review?.draft_artifact_path
            ? await fs.readFile(review.draft_artifact_path)
            : null
          const draftIndex = draftBuffer
            ? buildBlockIndex((await loadDocxBundle(draftBuffer)).documentDom)
            : null
          const topHeadingOccurrences = draftIndex
            ? draftIndex.outline.filter((block) => {
                if (block.type !== 'paragraph') return false
                return block.text === '深度学习与图形学复习总结'
              }).length
            : 0

          return {
            created,
            details,
            targetExists: await fileExists(`${runtime.workspaceRoot}/${targetFileName}`),
            draftExists: review?.draft_artifact_path
              ? await fileExists(review.draft_artifact_path)
              : false,
            workingExists: review?.working_artifact_path
              ? await fileExists(review.working_artifact_path)
              : false,
            committedExists: review?.committed_artifact_path
              ? await fileExists(review.committed_artifact_path)
              : false
            ,
            draftArtifactFileName: review?.draft_artifact_path
              ? review.draft_artifact_path.split('/').pop() || ''
              : '',
            topHeadingOccurrences
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.created.previousRevisionRef === 'v1' &&
            result.created.currentRevisionRef === 'v2' &&
            result.created.createdBlocks.length >= 2 &&
            result.details.length === 1 &&
            result.details[0]?.review.output_operation === 'created' &&
            result.details[0]?.review.change_count === result.details[0]?.changes.length &&
            result.details[0]?.changes.length >= 2 &&
            result.targetExists === false &&
            result.draftExists === true &&
            result.workingExists === true &&
            result.committedExists === true &&
            result.draftArtifactFileName === `draft-${targetFileName}` &&
            result.topHeadingOccurrences === 1,
          {
            name: 'docx-create-only-produces-review-artifacts',
            message: 'create-only docx 应能直接产出 review detail 与 working/review/committed artifacts，且正式目标文件在 commit 前不存在。',
            data: result
          }
        )
      }
    })
  })
})
