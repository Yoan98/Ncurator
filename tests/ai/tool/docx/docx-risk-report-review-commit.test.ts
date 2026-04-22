import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { XMLSerializer } from '@xmldom/xmldom'
import { loadDocxBundle } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import { createDocxToolHarness } from '../../../harness/backend/aiToolHarness'
import { seedRiskReportWorkspace } from '../../../harness/backend/aiLiveTestData'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxMutationResult, DocxOutlineResult, DocxSearchResult } from './testUtils'

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
        runtime.fileReviewService.beginRun({
          runId: runtime.runId,
          sessionId: 'docx-risk-report-review-commit-session',
          inputText: '补全风险周报模板并提交'
        })

        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_outline', {
            sourcePath: workspaceSeed.templateRelativePath
          })
          const firstEdit = await harness.invoke<DocxMutationResult>('docx_text_edit', {
            sourcePath: workspaceSeed.templateRelativePath,
            query: 'RISK_TODO',
            replace: '在合规签署前，风险状态保持为“待跟进”。'
          })
          const secondEdit = await harness.invoke<DocxMutationResult>('docx_text_edit', {
            sourcePath: workspaceSeed.templateRelativePath,
            query: 'OWNER_TODO',
            replace: '最终复核窗口由合规负责人 Alice 牵头。'
          })

          const details = await runtime.fileReviewService.finalizeRunReview({
            runId: runtime.runId,
            workspaceRootPath: runtime.workspaceRoot
          })
          const detail = details[0]
          if (!detail || !detail.review.draft_artifact_path) {
            throw new Error('expected generated review artifact for risk report')
          }

          const reviewRelativePath = path.relative(runtime.workspaceRoot, detail.review.draft_artifact_path)
          const reviewRisk = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: reviewRelativePath,
            query: '待跟进'
          })
          const reviewOwner = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: reviewRelativePath,
            query: 'Alice'
          })
          const reviewOldRiskPlaceholder = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: reviewRelativePath,
            query: 'RISK_TODO'
          })
          const reviewOldOwnerPlaceholder = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: reviewRelativePath,
            query: 'OWNER_TODO'
          })
          const reviewXml = new XMLSerializer().serializeToString(
            (await loadDocxBundle(await fs.readFile(detail.review.draft_artifact_path))).documentDom
          )

          const commit = await runtime.fileReviewService.commitReview({
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
            outline,
            firstEdit,
            secondEdit,
            reviewId: detail.review.id,
            reviewArtifactPath: detail.review.draft_artifact_path,
            reviewRisk,
            reviewOwner,
            reviewOldRiskPlaceholder,
            reviewOldOwnerPlaceholder,
            reviewXml,
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
            result.reviewOwner.matches.length >= 1 &&
            result.reviewOldRiskPlaceholder.matches.length >= 1 &&
            result.reviewOldOwnerPlaceholder.matches.length >= 1,
          {
            name: 'risk-report-review-artifact-contains-updated-content',
            message: '风险周报 review artifact 应同时包含旧占位符删除项和新内容新增项。',
            data: {
              reviewId: result.reviewId,
              reviewArtifactPath: result.reviewArtifactPath,
              outlineBlocks: result.outline.blocks,
              firstEdit: result.firstEdit.changedBlocks,
              secondEdit: result.secondEdit.changedBlocks,
              reviewRisk: result.reviewRisk.matches,
              reviewOwner: result.reviewOwner.matches,
              reviewOldRiskPlaceholder: result.reviewOldRiskPlaceholder.matches,
              reviewOldOwnerPlaceholder: result.reviewOldOwnerPlaceholder.matches
            }
          }
        )

        runtime.assertThat(
          result.reviewXml.includes('本周风险结论：RISK_TODO') &&
            result.reviewXml.includes('本周风险结论：在合规签署前，风险状态保持为“待跟进”。') &&
            result.reviewXml.includes('负责人说明：OWNER_TODO') &&
            result.reviewXml.includes('负责人说明：最终复核窗口由合规负责人 Alice 牵头。') &&
            /<w:strike\/>[\s\S]*本周风险结论：RISK_TODO/.test(result.reviewXml) &&
            /w:color w:val="166534"[\s\S]*本周风险结论：在合规签署前，风险状态保持为“待跟进”。/.test(result.reviewXml),
          {
            name: 'risk-report-review-artifact-keeps-old-and-new-xml-pairs',
            message: '风险周报 review artifact 的 XML 应保留旧文本删除节点和新文本新增节点，不能把红绿两份都写成新文本。',
            data: {
              reviewArtifactPath: result.reviewArtifactPath,
              reviewXmlSnippet: result.reviewXml.slice(0, 1600)
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
