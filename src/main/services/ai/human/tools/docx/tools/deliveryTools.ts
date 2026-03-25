import fs from 'node:fs'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiFileArtifactOperation } from '../../../../../../../shared/types'
import { emitFileArtifactEvent } from '../../../../events/fileArtifacts'
import { clipText } from '../../../../utils/text'
import type { DocxToolRuntime } from '../runtime'
import {
  DOCX_RENDER_PREVIEW_TOOL_SPEC,
  DOCX_SAVE_TOOL_SPEC,
  DOCX_VALIDATE_TOOL_SPEC
} from '../toolSpecs'
import {
  createDocxTool,
  runDocxWorkerToolAction
} from './workerTool'

export const buildDocxDeliveryTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxRenderPreviewTool = createDocxTool({
    runtime,
    name: DOCX_RENDER_PREVIEW_TOOL_SPEC.name,
    description: DOCX_RENDER_PREVIEW_TOOL_SPEC.description,
    schema: DOCX_RENDER_PREVIEW_TOOL_SPEC.schema,
    getRequiredDocId: (args) => args.docId,
    execute: async ({ args, toolName, toolCallId, docId }) => {
      const previewDir = path.join(runtime.workspaceRootPath, '.ncurator', 'docx-previews')
      const previewPath = path.join(
        previewDir,
        `${runtime.input.runId}-${docId}-${Date.now().toString(36)}.docx`
      )
      const existsBefore = fs.existsSync(previewPath)

      return await runDocxWorkerToolAction({
        runtime,
        toolName,
        toolCallId,
        expectedAction: DOCX_RENDER_PREVIEW_TOOL_SPEC.workerAction!,
        request: {
          action: DOCX_RENDER_PREVIEW_TOOL_SPEC.workerAction!,
          payload: {
            docId,
            format: args.format,
            previewPath
          }
        },
        buildSuccess: (workerPayload) => {
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
            draftDocId: docId
          }
        }
      })
    },
  })

  const docxSaveTool = createDocxTool({
    runtime,
    name: DOCX_SAVE_TOOL_SPEC.name,
    description: DOCX_SAVE_TOOL_SPEC.description,
    schema: DOCX_SAVE_TOOL_SPEC.schema,
    getRequiredDocId: (args) => args.docId,
    execute: async ({ args, toolName, toolCallId, docId }) => {
      const sourcePath = runtime.state.sourcePathByDocId.get(docId)
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
        expectedAction: DOCX_SAVE_TOOL_SPEC.workerAction!,
        request: {
          action: DOCX_SAVE_TOOL_SPEC.workerAction!,
          payload: {
            docId,
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
            draftSnapshotId: docId,
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
            draftDocId: docId
          }
        }
      })
    },
  })

  const docxValidateTool = createDocxTool({
    runtime,
    name: DOCX_VALIDATE_TOOL_SPEC.name,
    description: DOCX_VALIDATE_TOOL_SPEC.description,
    schema: DOCX_VALIDATE_TOOL_SPEC.schema,
    getRequiredDocId: (args) => args.docId,
    execute: async ({ args, toolName, toolCallId, docId }) => {
      return await runDocxWorkerToolAction({
        runtime,
        toolName,
        toolCallId,
        expectedAction: DOCX_VALIDATE_TOOL_SPEC.workerAction!,
        request: {
          action: DOCX_VALIDATE_TOOL_SPEC.workerAction!,
          payload: {
            docId
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
            draftDocId: docId
          }
        }
      })
    }
  })

  return [docxRenderPreviewTool, docxSaveTool, docxValidateTool]
}
