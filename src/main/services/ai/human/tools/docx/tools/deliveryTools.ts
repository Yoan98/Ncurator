import fs from 'node:fs'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiFileArtifactOperation } from '../../../../../../../shared/types'
import { emitFileArtifactEvent } from '../../../../events/fileArtifacts'
import { clipText } from '../../../../utils/text'
import { getToolContract } from '../../toolCatalog'
import type { DocxToolRuntime } from '../runtime'
import {
  createDocxTool,
  requireDocxToolDocId,
  runDocxWorkerToolAction
} from './workerTool'

const DOCX_RENDER_PREVIEW_CONTRACT = getToolContract('docx_render_preview')
const DOCX_SAVE_CONTRACT = getToolContract('docx_save')
const DOCX_VALIDATE_CONTRACT = getToolContract('docx_validate')

if (!DOCX_RENDER_PREVIEW_CONTRACT || !DOCX_SAVE_CONTRACT || !DOCX_VALIDATE_CONTRACT) {
  throw new Error('missing docx delivery tool contracts')
}

export const buildDocxDeliveryTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxRenderPreviewTool = createDocxTool({
    runtime,
    name: DOCX_RENDER_PREVIEW_CONTRACT.name,
    description:
      'Render preview artifact for the current doc snapshot. html returns a preview docx artifact path for renderer.',
    schema: DOCX_RENDER_PREVIEW_CONTRACT.schema,
    execute: async ({ args, toolName, toolCallId }) => {
      const docIdResult = requireDocxToolDocId({
        runtime,
        toolName,
        toolCallId,
        docId: args.docId
      })
      if ('failure' in docIdResult) return docIdResult.failure

      const previewDir = path.join(runtime.workspaceRootPath, '.ncurator', 'docx-previews')
      const previewPath = path.join(
        previewDir,
        `${runtime.input.runId}-${docIdResult.docId}-${Date.now().toString(36)}.docx`
      )
      const existsBefore = fs.existsSync(previewPath)

      return await runDocxWorkerToolAction({
        runtime,
        toolName,
        toolCallId,
        expectedAction: 'render_preview',
        request: {
          action: 'render_preview',
          payload: {
            docId: docIdResult.docId,
            format: args.format,
            previewPath
          }
        },
        buildSuccess: (workerPayload) => {
          runtime.input.ctx.trackDocxPreview({
            docId: docIdResult.docId,
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
            draftSnapshotId: docIdResult.docId,
            summary: `docx preview generated (${workerPayload.renderer})`
          })

          const result = {
            ok: true,
            code: 'ok' as const,
            summary: `preview generated (${workerPayload.format})`,
            format: workerPayload.format,
            previewPath: workerPayload.previewPath,
            renderer: workerPayload.renderer
          }
          return {
            result,
            outputPreview: result,
            draftDocId: docIdResult.docId
          }
        }
      })
    },
  })

  const docxSaveTool = createDocxTool({
    runtime,
    name: DOCX_SAVE_CONTRACT.name,
    description: 'Save doc snapshot to a workspace docx path with overwrite approval guard.',
    schema: DOCX_SAVE_CONTRACT.schema,
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

      return await runDocxWorkerToolAction({
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
        },
        buildSuccess: (workerPayload) => {
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

          const result = {
            ok: true,
            code: 'ok' as const,
            summary: `doc saved: ${path.basename(outPath)}`,
            outPath,
            checksum: workerPayload.checksum,
            operation,
            byteSize: workerPayload.byteSize
          }
          return {
            result,
            outputPreview: result,
            draftDocId: args.docId
          }
        }
      })
    },
  })

  const docxValidateTool = createDocxTool({
    runtime,
    name: DOCX_VALIDATE_CONTRACT.name,
    description: 'Validate current doc snapshot structure and relationship consistency.',
    schema: DOCX_VALIDATE_CONTRACT.schema,
    execute: async ({ args, toolName, toolCallId }) => {
      const docIdResult = requireDocxToolDocId({
        runtime,
        toolName,
        toolCallId,
        docId: args.docId
      })
      if ('failure' in docIdResult) return docIdResult.failure

      return await runDocxWorkerToolAction({
        runtime,
        toolName,
        toolCallId,
        expectedAction: 'validate',
        request: {
          action: 'validate',
          payload: {
            docId: docIdResult.docId
          }
        },
        buildSuccess: (workerPayload) => {
          const result = {
            ok: true,
            code: 'ok' as const,
            summary:
              workerPayload.problems.length === 0
                ? 'docx validate ok'
                : `docx validate with ${workerPayload.problems.length} problems`,
            problems: workerPayload.problems
          }
          return {
            result,
            outputPreview: {
              ok: result.ok,
              code: result.code,
              summary: result.summary,
              problemsPreview: clipText(
                JSON.stringify(result.problems),
                runtime.input.safePreviewChars
              )
            },
            draftDocId: docIdResult.docId
          }
        }
      })
    }
  })

  return [docxRenderPreviewTool, docxSaveTool, docxValidateTool]
}
