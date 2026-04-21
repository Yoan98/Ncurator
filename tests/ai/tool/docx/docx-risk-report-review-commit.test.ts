import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness } from '../../../harness/backend/aiToolHarness'
import { seedRiskReportWorkspace } from '../../../harness/backend/aiLiveTestData'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-risk-report-review-commit', async () => {
    await runBackendCase({
      caseId: 'docx-risk-report-review-commit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证风险周报场景在 review 生成后可检查待确认稿，并在 commit 后把结果落盘到源文档。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const workspaceSeed = await seedRiskReportWorkspace(runtime)
        runtime.draftReviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'docx-risk-report-review-commit-session',
          inputText: '补全风险周报模板并提交'
        })

        const harness = createDocxToolHarness(runtime)
        try {
          const firstEdit = await harness.invoke<DocxMutationResult>('docx_paragraph_edit', {
            sourcePath: workspaceSeed.templateRelativePath,
            action: 'replace_text',
            blockId: 'b:1',
            text: '本周风险结论：在合规签署前，风险状态保持为“待跟进”。'
          })
          const secondEdit = await harness.invoke<DocxMutationResult>('docx_paragraph_edit', {
            sourcePath: workspaceSeed.templateRelativePath,
            action: 'replace_text',
            blockId: 'b:2',
            text: '负责人说明：最终复核窗口由合规负责人 Alice 牵头。'
          })

          const details = await runtime.draftReviewService.finalizeRunReview({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot
          })
          const detail = details[0]
          const document = detail?.documents[0]
          if (!detail || !document?.review_artifact_path) {
            throw new Error('expected generated review artifact for risk report')
          }

          const reviewRelativePath = path.relative(runtime.workspaceRoot, document.review_artifact_path)
          const reviewRisk = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: reviewRelativePath,
            query: '待跟进'
          })
          const reviewOwner = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: reviewRelativePath,
            query: 'Alice'
          })

          const commit = await runtime.draftReviewService.commitReview({
            reviewId: detail.review.id,
            overwrite: true
          })

          const committedRisk = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: workspaceSeed.templateRelativePath,
            query: '待跟进'
          })
          const committedOwner = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: workspaceSeed.templateRelativePath,
            query: 'Alice'
          })
          const oldRiskPlaceholder = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: workspaceSeed.templateRelativePath,
            query: 'RISK_TODO'
          })
          const oldOwnerPlaceholder = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: workspaceSeed.templateRelativePath,
            query: 'OWNER_TODO'
          })

          return {
            firstEdit,
            secondEdit,
            reviewId: detail.review.id,
            reviewArtifactPath: document.review_artifact_path,
            reviewRisk,
            reviewOwner,
            commit,
            committedRisk,
            committedOwner,
            oldRiskPlaceholder,
            oldOwnerPlaceholder
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.firstEdit.changedBlocks.length === 1 &&
            result.secondEdit.changedBlocks.length === 1 &&
            result.reviewRisk.matches.length >= 1 &&
            result.reviewOwner.matches.length >= 1,
          {
            name: 'risk-report-review-artifact-contains-updated-content',
            message: '风险周报 review artifact 应包含风险结论与负责人两处更新结果。',
            data: {
              reviewId: result.reviewId,
              reviewArtifactPath: result.reviewArtifactPath,
              firstEdit: result.firstEdit.changedBlocks,
              secondEdit: result.secondEdit.changedBlocks,
              reviewRisk: result.reviewRisk.matches,
              reviewOwner: result.reviewOwner.matches
            }
          }
        )

        runtime.assertThat(
          result.commit.success === true &&
            result.committedRisk.matches.length === 1 &&
            result.committedOwner.matches.length === 1 &&
            result.oldRiskPlaceholder.matches.length === 0 &&
            result.oldOwnerPlaceholder.matches.length === 0,
          {
            name: 'risk-report-commit-writes-final-content-to-source-docx',
            message: '风险周报 commit 后源模板应落盘最终内容，并移除原占位符。',
            data: {
              commit: result.commit,
              committedRisk: result.committedRisk.matches,
              committedOwner: result.committedOwner.matches,
              oldRiskPlaceholder: result.oldRiskPlaceholder.matches,
              oldOwnerPlaceholder: result.oldOwnerPlaceholder.matches
            }
          }
        )
      }
    })
  })
})
