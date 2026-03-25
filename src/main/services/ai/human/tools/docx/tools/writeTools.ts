import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxChangedBlock, DocxOp } from '../types'
import type { DocxToolRuntime } from '../runtime'
import { DOCX_APPLY_OPS_TOOL_SPEC, DOCX_ROLLBACK_TOOL_SPEC } from '../toolSpecs'
import {
  callExpectedWorkerAction,
  createDocxTool,
  finalizeDocxToolFailure,
  finalizeDocxToolSuccess,
  isDocxToolFailure
} from './workerTool'

export const buildDocxWriteTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxApplyOpsTool = createDocxTool({
    runtime,
    name: DOCX_APPLY_OPS_TOOL_SPEC.name,
    description: DOCX_APPLY_OPS_TOOL_SPEC.description,
    schema: DOCX_APPLY_OPS_TOOL_SPEC.schema,
    getRequiredDocId: (args) => args.docId,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_APPLY_OPS_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: `编辑失败: ${message}`
      })
    },
    execute: async ({ args, toolName, toolCallId, docId }) => {
      const expandedOps = await runtime.expandOpsForReview(docId, args.ops as DocxOp[])
      runtime.input.emitActivity({
        actionType: DOCX_APPLY_OPS_TOOL_SPEC.activityActionType!,
        status: 'started',
        summary: `应用操作: ${expandedOps.length} 条`
      })
      let currentDocId = docId
      const collectedChangedBlocks: DocxChangedBlock[] = []
      const collectedWarnings: string[] = []

      for (const op of expandedOps) {
        const workerPayload = await callExpectedWorkerAction({
          runtime,
          toolName,
          toolCallId,
          expectedAction: DOCX_APPLY_OPS_TOOL_SPEC.workerAction!,
          draftDocId: currentDocId,
          request: {
            action: DOCX_APPLY_OPS_TOOL_SPEC.workerAction!,
            payload: {
              docId: currentDocId,
              ops: [op]
            }
          }
        })
        if (isDocxToolFailure(workerPayload)) {
          return finalizeDocxToolFailure({
            runtime,
            failure: workerPayload,
            activity: {
              actionType: DOCX_APPLY_OPS_TOOL_SPEC.activityActionType!,
              buildFailedSummary: (failure) => failure.summary
            }
          })
        }

        const nextDocId = workerPayload.newDocId
        const sourcePath = runtime.state.sourcePathByDocId.get(currentDocId)
        if (sourcePath) runtime.state.sourcePathByDocId.set(nextDocId, sourcePath)
        runtime.registerSnapshot(nextDocId, currentDocId)
        runtime.input.ctx.trackDocxChanges({
          previousDocId: currentDocId,
          nextDocId,
          op,
          changedBlocks: workerPayload.changedBlocks
        })
        collectedChangedBlocks.push(...workerPayload.changedBlocks)
        collectedWarnings.push(...workerPayload.warnings)
        currentDocId = nextDocId
      }

      runtime.state.lastDocId = currentDocId
      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `ops applied (${collectedChangedBlocks.length} changes)`,
        newDocId: currentDocId,
        changedBlocks: collectedChangedBlocks,
        warnings: collectedWarnings
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: result.ok,
          code: result.code,
          summary: result.summary,
          newDocId: result.newDocId,
          changedCount: result.changedBlocks.length,
          warnings: result.warnings
        },
        draftDocId: currentDocId,
        activity: {
          actionType: DOCX_APPLY_OPS_TOOL_SPEC.activityActionType!,
          buildCompletedSummary: (output) => `编辑完成: ${String(output.changedBlocks.length)} 处变更`
        }
      })
    },
  })

  const docxRollbackTool = createDocxTool({
    runtime,
    name: DOCX_ROLLBACK_TOOL_SPEC.name,
    description: DOCX_ROLLBACK_TOOL_SPEC.description,
    schema: DOCX_ROLLBACK_TOOL_SPEC.schema,
    getRequiredDocId: (args) => args.docId,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_ROLLBACK_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: `回滚失败: ${message}`
      })
    },
    execute: async ({ args, toolName, toolCallId, docId }) => {
      runtime.input.emitActivity({
        actionType: DOCX_ROLLBACK_TOOL_SPEC.activityActionType!,
        status: 'started',
        summary: `准备回滚文档快照: ${docId}`
      })

      const resolved = runtime.resolveRollbackTarget(
        docId,
        args.targetDocId,
        args.steps
      )
      if (!resolved.ok) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'invalid_input',
            error: resolved.error
          }),
          activity: {
            actionType: DOCX_ROLLBACK_TOOL_SPEC.activityActionType!,
            buildFailedSummary: (failure) => failure.summary
          }
        })
      }

      runtime.state.lastDocId = resolved.targetDocId
      const sourcePath = runtime.state.sourcePathByDocId.get(docId)
      if (sourcePath && !runtime.state.sourcePathByDocId.has(resolved.targetDocId)) {
        runtime.state.sourcePathByDocId.set(resolved.targetDocId, sourcePath)
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `rollback ready (${resolved.stepsApplied} step${resolved.stepsApplied === 1 ? '' : 's'}, not saved)`,
        docId: resolved.targetDocId,
        previousDocId: docId,
        stepsApplied: resolved.stepsApplied
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: result,
        draftDocId: resolved.targetDocId,
        activity: {
          actionType: DOCX_ROLLBACK_TOOL_SPEC.activityActionType!,
          buildCompletedSummary: (output) => `已切回草稿快照: ${output.docId}`
        }
      })
    },
  })

  return [docxApplyOpsTool, docxRollbackTool]
}
