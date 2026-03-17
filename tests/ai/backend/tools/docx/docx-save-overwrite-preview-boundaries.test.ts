import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  createDocxToolHarness,
  writeWorkbenchSampleDocx
} from '../../../../harness/backend/aiToolHarness'

type DocxOpenResult = {
  ok: boolean
  code: string
  summary: string
  docId: string
}

type DocxPreviewFailure = {
  ok: boolean
  code: string
  summary: string
  error?: string
}

type DocxSaveResult = {
  ok: boolean
  code: string
  summary: string
  outPath?: string
  operation?: 'created' | 'updated'
  error?: string
}

describe('docx save overwrite preview boundaries', () => {
  it('covers unsupported preview formats and overwrite approval behaviour', async () => {
    await runBackendCase({
      caseId: 'docx-save-overwrite-preview-boundaries',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'tools',
      groups: ['docx'],
      description: '验证 docx capability 的 preview 边界与 overwrite 冲突处理',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = await writeWorkbenchSampleDocx(runtime.workspaceRoot, 'docx-overwrite-flow.docx')
        const allowHarness = createDocxToolHarness(runtime)
        const denyHarness = createDocxToolHarness(runtime, {
          approvalPolicy: 'deny-all'
        })
        const overwritePath = 'deliverables/overwrite-target.docx'

        try {
          const opened = await allowHarness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: path.relative(runtime.workspaceRoot, sourcePath)
          })
          if (!opened.ok) {
            throw new Error(opened.summary)
          }

          const invalidPreview = await allowHarness.invoke<DocxPreviewFailure>('docx_render_preview', {
            docId: opened.docId,
            format: 'pdf'
          })
          const firstSave = await allowHarness.invoke<DocxSaveResult>('docx_save', {
            docId: opened.docId,
            outPath: overwritePath
          })
          const noOverwrite = await allowHarness.invoke<DocxSaveResult>('docx_save', {
            docId: opened.docId,
            outPath: overwritePath
          })

          const denyOpened = await denyHarness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: path.relative(runtime.workspaceRoot, sourcePath)
          })
          if (!denyOpened.ok) {
            throw new Error(denyOpened.summary)
          }

          const deniedOverwrite = await denyHarness.invoke<DocxSaveResult>('docx_save', {
            docId: denyOpened.docId,
            outPath: overwritePath,
            overwrite: true
          })
          const approvedOverwrite = await allowHarness.invoke<DocxSaveResult>('docx_save', {
            docId: opened.docId,
            outPath: overwritePath,
            overwrite: true
          })

          runtime.recordEvent({
            type: 'step',
            name: 'docx-preview-overwrite-boundaries',
            status: 'ok',
            message: 'docx preview 边界与 overwrite 审批路径已经执行',
            data: {
              invalidPreviewCode: invalidPreview.code,
              firstSaveCode: firstSave.code,
              noOverwriteCode: noOverwrite.code,
              deniedOverwriteCode: deniedOverwrite.code,
              approvedOverwriteCode: approvedOverwrite.code
            }
          })

          return {
            invalidPreview,
            firstSave,
            noOverwrite,
            deniedOverwrite,
            approvedOverwrite,
            aiEvents: runtime.eventCollector.snapshot()
          }
        } finally {
          await allowHarness.release()
          await denyHarness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.invalidPreview.ok === false && result.invalidPreview.code === 'invalid_input',
          {
            name: 'docx-preview-unsupported-format',
            message: '不支持的 preview format 会返回 invalid_input',
            data: {
              code: result.invalidPreview.code
            }
          }
        )
        runtime.assertThat(
          result.firstSave.ok === true && result.firstSave.operation === 'created',
          {
            name: 'docx-first-save-created',
            message: '首次保存会创建 committed docx 文件',
            data: {
              operation: result.firstSave.operation
            }
          }
        )
        runtime.assertThat(
          result.noOverwrite.ok === false && result.noOverwrite.code === 'invalid_input',
          {
            name: 'docx-save-conflict-without-overwrite',
            message: '已存在路径且未传 overwrite 时会直接返回 invalid_input'
          }
        )
        runtime.assertThat(
          result.deniedOverwrite.ok === false && result.deniedOverwrite.code === 'approval_denied',
          {
            name: 'docx-save-overwrite-denied',
            message: 'overwrite=true 且审批拒绝时会返回 approval_denied'
          }
        )
        runtime.assertThat(
          result.approvedOverwrite.ok === true && result.approvedOverwrite.operation === 'updated',
          {
            name: 'docx-save-overwrite-approved',
            message: 'overwrite=true 且审批通过时会更新目标文件',
            data: {
              operation: result.approvedOverwrite.operation
            }
          }
        )

        const approvalRequests = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'approval_required'
        )
        const approvalDenied = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'approval_decision' && event.approved === false
        )
        const approvalApproved = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'approval_decision' && event.approved === true
        )
        const committedArtifacts = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'file_artifact' && event.artifactRole === 'committed'
        )

        runtime.assertThat(
          approvalRequests.length === 2 &&
            approvalDenied.length === 1 &&
            approvalApproved.length === 1 &&
            committedArtifacts.length === 2,
          {
            name: 'docx-overwrite-approval-events',
            message: 'overwrite 审批与 committed artifact 事件数量符合预期',
            data: {
              approvalRequests: approvalRequests.length,
              approvalDenied: approvalDenied.length,
              approvalApproved: approvalApproved.length,
              committedArtifacts: committedArtifacts.length
            }
          }
        )
      }
    })
  })
})
