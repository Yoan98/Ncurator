import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-review-discard-preserves-source', async () => {
    await runBackendCase({
      caseId: 'docx-review-discard-preserves-source',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证放弃 review 只清理会话产物，不影响磁盘 source 文件。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'discard-review.docx')
        await writeTestDocxFile(runtime.workspaceRoot, 'discard-review.docx', [
          { type: 'paragraph', text: '源文档原始内容。' }
        ])
        const sourceBufferBefore = await fs.readFile(sourcePath)

        runtime.fileReviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'discard-review-session',
          inputText: '创建后再放弃'
        })

        const harness = createDocxToolHarness(runtime)
        try {
          const changed = await harness.invoke<DocxMutationResult>('docx_text_edit', {
            sourcePath: 'discard-review.docx',
            query: '源文档原始内容。',
            replace: '仅存在于工作稿中的内容。'
          })
          const details = await runtime.fileReviewService.finalizeRunReview({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot
          })
          const detail = details[0]
          if (!detail || !detail.review.draft_artifact_path || !detail.review.working_artifact_path) {
            throw new Error('expected finalized review detail')
          }

          const discard = await runtime.fileReviewService.discardReview({
            reviewId: detail.review.id
          })
          const sourceBufferAfter = await fs.readFile(sourcePath)
          await harness.release()
          const freshHarness = createDocxToolHarness(runtime)
          const sourceSearch = await freshHarness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'discard-review.docx',
            query: '源文档原始内容。'
          })
          const workingTextSearch = await freshHarness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'discard-review.docx',
            query: '仅存在于工作稿中的内容。'
          })
          await freshHarness.release()
          const reviewArtifactExists = await fs
            .access(detail.review.draft_artifact_path)
            .then(() => true)
            .catch(() => false)
          const workingArtifactExists = await fs
            .access(detail.review.working_artifact_path)
            .then(() => true)
            .catch(() => false)
          const discardedDetail = await runtime.fileReviewStore.getReviewDetail(detail.review.id)

          return {
            changed,
            discard,
            sourceBufferBefore,
            sourceBufferAfter,
            sourceSearch,
            workingTextSearch,
            reviewArtifactExists,
            workingArtifactExists,
            discardedStatus: discardedDetail?.review.status
          }
        } finally {
          try {
            await harness.release()
          } catch {
            // ignore double-release in tests
          }
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.discard.success === true && result.discardedStatus === 'discarded', {
          name: 'discard-marks-review-discarded',
          message: '放弃 review 后，review 状态应更新为 discarded。',
          data: {
            discard: result.discard,
            discardedStatus: result.discardedStatus
          }
        })

        runtime.assertThat(
          result.sourceBufferBefore.equals(result.sourceBufferAfter) &&
            result.sourceSearch.matches.length === 1 &&
            result.workingTextSearch.matches.length === 0 &&
            result.reviewArtifactExists === false &&
            result.workingArtifactExists === false,
          {
            name: 'discard-removes-artifacts-but-preserves-source',
            message: '放弃 review 应只清理 working/review artifact，不得改写 source 文件。',
            data: {
              sourceSearch: result.sourceSearch.matches,
              workingTextSearch: result.workingTextSearch.matches,
              reviewArtifactExists: result.reviewArtifactExists,
              workingArtifactExists: result.workingArtifactExists
            }
          }
        )
      }
    })
  })
})
