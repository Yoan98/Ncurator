import type { StructuredToolInterface } from '@langchain/core/tools'
import { getToolContract } from '../../toolCatalog'
import type { DocxChangedBlock, DocxOp } from '../types'
import type { DocxToolRuntime } from '../runtime'
import {
  callExpectedWorkerAction,
  createDocxTool,
  finalizeDocxToolFailure,
  finalizeDocxToolSuccess,
  isDocxToolFailure,
  requireDocxToolDocId,
} from './workerTool'

const DOCX_APPLY_OPS_CONTRACT = getToolContract('docx_apply_ops')
const DOCX_ROLLBACK_CONTRACT = getToolContract('docx_rollback')

if (!DOCX_APPLY_OPS_CONTRACT || !DOCX_ROLLBACK_CONTRACT) {
  throw new Error('missing docx write tool contracts')
}

export const buildDocxWriteTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxApplyOpsTool = createDocxTool({
    runtime,
    name: DOCX_APPLY_OPS_CONTRACT.name,
    description:
      'Apply structured docx operations and return a new immutable docId snapshot with changed blocks.',
    schema: DOCX_APPLY_OPS_CONTRACT.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: 'docx_apply_ops',
        status: 'failed',
        summary: `编辑失败: ${message}`
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const docIdResult = requireDocxToolDocId({
        runtime,
        toolName,
        toolCallId,
        docId: args.docId
      })
      if ('failure' in docIdResult) return docIdResult.failure

      const expandedOps = await runtime.expandOpsForReview(docIdResult.docId, args.ops as DocxOp[])
      runtime.input.emitActivity({
        actionType: 'docx_apply_ops',
        status: 'started',
        summary: `应用操作: ${expandedOps.length} 条`
      })
      let currentDocId = docIdResult.docId
      const collectedChangedBlocks: DocxChangedBlock[] = []
      const collectedWarnings: string[] = []

      for (const op of expandedOps) {
        const workerPayload = await callExpectedWorkerAction({
          runtime,
          toolName,
          toolCallId,
          expectedAction: 'apply_ops',
          draftDocId: currentDocId,
          request: {
            action: 'apply_ops',
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
              actionType: 'docx_apply_ops',
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
          actionType: 'docx_apply_ops',
          buildCompletedSummary: (output) => `编辑完成: ${String(output.changedBlocks.length)} 处变更`
        }
      })
    },
  })

  const docxRollbackTool = createDocxTool({
    runtime,
    name: DOCX_ROLLBACK_CONTRACT.name,
    description:
      'Move back to an ancestor docx snapshot in the current run without writing files. Use before user confirmation.',
    schema: DOCX_ROLLBACK_CONTRACT.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: 'docx_rollback',
        status: 'failed',
        summary: `回滚失败: ${message}`
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const docIdResult = requireDocxToolDocId({
        runtime,
        toolName,
        toolCallId,
        docId: args.docId
      })
      if ('failure' in docIdResult) return docIdResult.failure

      runtime.input.emitActivity({
        actionType: 'docx_rollback',
        status: 'started',
        summary: `准备回滚文档快照: ${docIdResult.docId}`
      })

      const resolved = runtime.resolveRollbackTarget(
        docIdResult.docId,
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
            actionType: 'docx_rollback',
            buildFailedSummary: (failure) => failure.summary
          }
        })
      }

      runtime.state.lastDocId = resolved.targetDocId
      const sourcePath = runtime.state.sourcePathByDocId.get(docIdResult.docId)
      if (sourcePath && !runtime.state.sourcePathByDocId.has(resolved.targetDocId)) {
        runtime.state.sourcePathByDocId.set(resolved.targetDocId, sourcePath)
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `rollback ready (${resolved.stepsApplied} step${resolved.stepsApplied === 1 ? '' : 's'}, not saved)`,
        docId: resolved.targetDocId,
        previousDocId: docIdResult.docId,
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
          actionType: 'docx_rollback',
          buildCompletedSummary: (output) => `已切回草稿快照: ${output.docId}`
        }
      })
    },
  })

  return [docxApplyOpsTool, docxRollbackTool]
}
