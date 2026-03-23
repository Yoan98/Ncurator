import fs from 'node:fs'
import path from 'node:path'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiFileArtifactOperation } from '../../../../../../../shared/types'
import { emitFileArtifactEvent } from '../../../../events/fileArtifacts'
import { clipText } from '../../../../utils/text'
import type { DocxToolRuntime } from '../runtime'
import { renderPreviewSchema, saveSchema, validateSchema } from '../schemas'

export const buildDocxDeliveryTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxRenderPreviewTool = tool(
    async (args) => {
      const toolName = 'docx_render_preview'
      const toolCallId = runtime.toolEvents.emitStarted(toolName, args)
      try {
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
        const workerResponse = await runtime.callWorker({
          action: 'render_preview',
          payload: {
            docId,
            format: args.format,
            previewPath
          }
        })
        if (!workerResponse.ok) {
          return runtime.emitWorkerFailure({
            toolName,
            toolCallId,
            response: workerResponse
          })
        }
        if (workerResponse.payload.action !== 'render_preview') {
          return runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
            error: 'worker protocol mismatch (render_preview)'
          })
        }

        runtime.input.ctx.trackDocxPreview({
          docId,
          previewPath: workerResponse.payload.previewPath
        })
        const operation: AiFileArtifactOperation = existsBefore ? 'updated' : 'created'
        emitFileArtifactEvent({
          ctx: runtime.input.ctx,
          runId: runtime.input.runId,
          taskId: runtime.input.taskId,
          capability: 'docx',
          artifactPath: workerResponse.payload.previewPath,
          operation,
          artifactRole: 'preview',
          draftSnapshotId: docId,
          summary: `docx preview generated (${workerResponse.payload.renderer})`
        })

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `preview generated (${workerResponse.payload.format})`,
          format: workerResponse.payload.format,
          previewPath: workerResponse.payload.previewPath,
          renderer: workerResponse.payload.renderer
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: out,
          draftDocId: docId
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'failed',
          error: msg
        })
        throw error
      }
    },
    {
      name: 'docx_render_preview',
      description:
        'Render preview artifact for the current doc snapshot. html returns a preview docx artifact path for renderer.',
      schema: renderPreviewSchema
    }
  )

  const docxSaveTool = tool(
    async (args) => {
      const toolName = 'docx_save'
      const toolCallId = runtime.toolEvents.emitStarted(toolName, args)
      try {
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

        const workerResponse = await runtime.callWorker({
          action: 'save',
          payload: {
            docId: args.docId,
            outPath
          }
        })
        if (!workerResponse.ok) {
          return runtime.emitWorkerFailure({
            toolName,
            toolCallId,
            response: workerResponse
          })
        }
        if (workerResponse.payload.action !== 'save') {
          return runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
            error: 'worker protocol mismatch (save)'
          })
        }

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
          checksum: workerResponse.payload.checksum,
          operation,
          byteSize: workerResponse.payload.byteSize
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: out,
          draftDocId: args.docId
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'failed',
          error: msg
        })
        throw error
      }
    },
    {
      name: 'docx_save',
      description: 'Save doc snapshot to a workspace docx path with overwrite approval guard.',
      schema: saveSchema
    }
  )

  const docxValidateTool = tool(
    async (args) => {
      const toolName = 'docx_validate'
      const toolCallId = runtime.toolEvents.emitStarted(toolName, args)
      try {
        const docId = runtime.getRequiredDocId({
          toolName,
          toolCallId,
          docId: args.docId
        })
        if (!docId) return runtime.toFailure({
          code: 'invalid_input',
          error: `docId is required before ${toolName}; open a document first`
        })

        const workerResponse = await runtime.callWorker({
          action: 'validate',
          payload: {
            docId
          }
        })
        if (!workerResponse.ok) {
          return runtime.emitWorkerFailure({
            toolName,
            toolCallId,
            response: workerResponse
          })
        }
        if (workerResponse.payload.action !== 'validate') {
          return runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
            error: 'worker protocol mismatch (validate)'
          })
        }
        const out = {
          ok: true,
          code: 'ok' as const,
          summary:
            workerResponse.payload.problems.length === 0
              ? 'docx validate ok'
              : `docx validate with ${workerResponse.payload.problems.length} problems`,
          problems: workerResponse.payload.problems
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
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'failed',
          error: msg
        })
        throw error
      }
    },
    {
      name: 'docx_validate',
      description: 'Validate current doc snapshot structure and relationship consistency.',
      schema: validateSchema
    }
  )

  return [docxRenderPreviewTool, docxSaveTool, docxValidateTool]
}
