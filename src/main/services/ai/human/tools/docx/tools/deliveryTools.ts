import fs from 'node:fs'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiFileArtifactOperation } from '../../../../../../../shared/types'
import { emitFileArtifactEvent } from '../../../../events/fileArtifacts'
import { clipText } from '../../../../utils/text'
import type { DocxToolRuntime } from '../runtime'
import { renderPreviewSchema, saveSchema, validateSchema } from '../schemas'
import { callExpectedWorkerAction, createDocxTool, isDocxToolFailure } from './workerTool'

export const buildDocxDeliveryTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxRenderPreviewTool = createDocxTool({
    runtime,
    name: 'docx_render_preview',
    description:
      'Render preview artifact for the current doc snapshot. html returns a preview docx artifact path for renderer.',
    schema: renderPreviewSchema,
    execute: async ({ args, toolName, toolCallId }) => {
        const docId = runtime.getRequiredDocId({
          toolName,
          toolCallId,
          docId: args.docId
        })
        if (!docId) return runtime.toFailure({
          code: 'invalid_input',
          error: `docId is required before ${toolName}; open a document first`
        })

        const previewDir = path.join(runtime.workspaceRootPath, '.ncurator', 'docx-previews')
        const previewPath = path.join(
          previewDir,
          `${runtime.input.runId}-${docId}-${Date.now().toString(36)}.docx`
        )
        const existsBefore = fs.existsSync(previewPath)
        const workerPayload = await callExpectedWorkerAction({
          runtime,
          toolName,
          toolCallId,
          expectedAction: 'render_preview',
          request: {
            action: 'render_preview',
            payload: {
              docId,
              format: args.format,
              previewPath
            }
          }
        })
        if (isDocxToolFailure(workerPayload)) return workerPayload

        runtime.input.ctx.trackDocxPreview({
          docId,
          previewPath: workerPayload.previewPath
        })
        const operation: AiFileArtifactOperation = existsBefore ? 'updated' : 'created'
        emitFileArtifactEvent({
          ctx: runtime.input.ctx,
          runId: runtime.input.runId,
          taskId: runtime.input.taskId,
          capability: 'docx',
          artifactPath: workerPayload.previewPath,
          operation,
          artifactRole: 'preview',
          draftSnapshotId: docId,
          summary: `docx preview generated (${workerPayload.renderer})`
        })

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `preview generated (${workerPayload.format})`,
          format: workerPayload.format,
          previewPath: workerPayload.previewPath,
          renderer: workerPayload.renderer
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: out,
          draftDocId: docId
        })
        return out
    },
  })

  const docxSaveTool = createDocxTool({
    runtime,
    name: 'docx_save',
    description: 'Save doc snapshot to a workspace docx path with overwrite approval guard.',
    schema: saveSchema,
    execute: async ({ args, toolName, toolCallId }) => {
        const sourcePath = runtime.state.sourcePathByDocId.get(args.docId)
        const cwd = sourcePath ? path.dirname(sourcePath) : runtime.workspaceRootPath
        const outPath = runtime.resolveDocxPath({
          cwd,
          rawPath: args.outPath
        })
        if (!outPath) {
          return runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'invalid_input',
            error: 'outPath must be a workspace-bound .docx path'
          })
        }

        const existsBefore = fs.existsSync(outPath)
        if (existsBefore && !args.overwrite) {
          return runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'invalid_input',
            error: 'outPath already exists, pass overwrite=true or use another path'
          })
        }

        if (existsBefore) {
          const decision = await runtime.input.ctx.requestApproval({
            runId: runtime.input.runId,
            taskId: runtime.input.taskId,
            command: `docx overwrite ${outPath}`,
            riskLevel: 'medium',
            reason: 'docx save may overwrite an existing file'
          })
          if (!decision.approved) {
            return runtime.emitFailure({
              toolName,
              toolCallId,
              code: 'approval_denied',
              error: decision.reason || 'approval denied for overwrite'
            })
          }
        }

        const workerPayload = await callExpectedWorkerAction({
          runtime,
          toolName,
          toolCallId,
          expectedAction: 'save',
          request: {
            action: 'save',
            payload: {
              docId: args.docId,
              outPath
            }
          }
        })
        if (isDocxToolFailure(workerPayload)) return workerPayload

        const operation: AiFileArtifactOperation = existsBefore ? 'updated' : 'created'
        emitFileArtifactEvent({
          ctx: runtime.input.ctx,
          runId: runtime.input.runId,
          taskId: runtime.input.taskId,
          capability: 'docx',
          artifactPath: outPath,
          operation,
          artifactRole: 'committed',
          draftSnapshotId: args.docId,
          summary: `docx saved (${operation})`
        })

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `doc saved: ${path.basename(outPath)}`,
          outPath,
          checksum: workerPayload.checksum,
          operation,
          byteSize: workerPayload.byteSize
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: out,
          draftDocId: args.docId
        })
        return out
    },
  })

  const docxValidateTool = createDocxTool({
    runtime,
    name: 'docx_validate',
    description: 'Validate current doc snapshot structure and relationship consistency.',
    schema: validateSchema,
    execute: async ({ args, toolName, toolCallId }) => {
        const docId = runtime.getRequiredDocId({
          toolName,
          toolCallId,
          docId: args.docId
        })
        if (!docId) return runtime.toFailure({
          code: 'invalid_input',
          error: `docId is required before ${toolName}; open a document first`
        })

        const workerPayload = await callExpectedWorkerAction({
          runtime,
          toolName,
          toolCallId,
          expectedAction: 'validate',
          request: {
            action: 'validate',
            payload: {
              docId
            }
          }
        })
        if (isDocxToolFailure(workerPayload)) return workerPayload
        const out = {
          ok: true,
          code: 'ok' as const,
          summary:
            workerPayload.problems.length === 0
              ? 'docx validate ok'
              : `docx validate with ${workerPayload.problems.length} problems`,
          problems: workerPayload.problems
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: {
            ok: out.ok,
            code: out.code,
            summary: out.summary,
            problemsPreview: clipText(JSON.stringify(out.problems), runtime.input.safePreviewChars)
          },
          draftDocId: docId
        })
        return out
    }
  })

  return [docxRenderPreviewTool, docxSaveTool, docxValidateTool]
}
