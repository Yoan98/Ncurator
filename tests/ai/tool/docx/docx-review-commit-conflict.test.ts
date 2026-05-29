import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxMutationResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-review-commit-conflict', async () => {
    await runBackendCase({
      caseId: 'docx-review-commit-conflict',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 source freshness 冲突时会拒绝覆盖，并把 review 标记为 conflicted。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'commit-conflict.docx', [
          { type: 'paragraph', text: '待修改的原文。' }
        ])

        runtime.fileReviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'commit-conflict-session',
          inputText: '准备后制造冲突'
        })

        const harness = createDocxToolHarness(runtime)
        try {
          const changed = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'commit-conflict.docx',
            actions: [{
              type: 'replace_text',
              query: '待修改的原文。',
              replace: '工作稿中的新版本。'
            }]
          })
          const details = await runtime.fileReviewService.finalizeRunReview({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot
          })
          const detail = details[0]
          if (!detail) {
            throw new Error('expected finalized review detail')
          }

          await writeTestDocxFile(runtime.workspaceRoot, 'commit-conflict.docx', [
            { type: 'paragraph', text: '外部已改写源文件。' }
          ])
          const externalSourceBuffer = await fs.readFile(`${runtime.workspaceRoot}/commit-conflict.docx`)

          const validation = await runtime.fileReviewService.validateCommit({
            reviewId: detail.review.id
          })
          const commit = await runtime.fileReviewService.commitReview({
            reviewId: detail.review.id,
            overwrite: true
          })
          const conflictedDetail = await runtime.fileReviewStore.getReviewDetail(detail.review.id)
          const sourceBuffer = await fs.readFile(`${runtime.workspaceRoot}/commit-conflict.docx`)

          return {
            changed,
            validation,
            commit,
            conflictedStatus: conflictedDetail?.review.status,
            sourceMatchesExternal: sourceBuffer.equals(externalSourceBuffer)
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
        runtime.assertThat(
          result.validation.ready === false &&
            result.validation.issues.some((issue) => issue.code === 'source_changed'),
          {
            name: 'validate-commit-detects-source-freshness-conflict',
            message: 'source 文件被外部改写后，validateCommit 应返回 source_changed。',
            data: result.validation
          }
        )

        runtime.assertThat(
          result.commit.success === false &&
            result.commit.job?.status === 'conflicted' &&
            result.conflictedStatus === 'conflicted' &&
            result.sourceMatchesExternal,
          {
            name: 'conflict-prevents-overwrite-and-keeps-external-source',
            message: '发生 freshness 冲突时，commit 应拒绝覆盖源文件，并把 review 标记为 conflicted。',
            data: {
              commit: result.commit,
              conflictedStatus: result.conflictedStatus,
              sourceMatchesExternal: result.sourceMatchesExternal
            }
          }
        )
      }
    })
  })
})
