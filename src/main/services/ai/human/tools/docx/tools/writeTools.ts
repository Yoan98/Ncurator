import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxChangedBlock, DocxOp } from '../types'
import type { DocxToolRuntime } from '../runtime'
import { applyOpsSchema, rollbackSchema } from '../schemas'
import { callExpectedWorkerAction, createDocxTool, isDocxToolFailure } from './workerTool'

export const buildDocxWriteTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxApplyOpsTool = createDocxTool({
    runtime,
    name: 'docx_apply_ops',
    description:
      'Apply structured docx operations and return a new immutable docId snapshot with changed blocks.',
    schema: applyOpsSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: 'docx_apply_ops',
        status: 'failed',
        summary: `编辑失败: ${message}`
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
        const initialDocId = runtime.getRequiredDocId({
          toolName,
          toolCallId,
          docId: args.docId
        })
        if (!initialDocId) return runtime.toFailure({
          code: 'invalid_input',
          error: `docId is required before ${toolName}; open a document first`
        })

        const expandedOps = await runtime.expandOpsForReview(initialDocId, args.ops as DocxOp[])
        runtime.input.emitActivity({
          actionType: 'docx_apply_ops',
          status: 'started',
          summary: `应用操作: ${expandedOps.length} 条`
        })
        let currentDocId = initialDocId
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
            runtime.input.emitActivity({
              actionType: 'docx_apply_ops',
              status: 'failed',
              summary: workerPayload.summary
            })
            return workerPayload
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
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `ops applied (${collectedChangedBlocks.length} changes)`,
          newDocId: currentDocId,
          changedBlocks: collectedChangedBlocks,
          warnings: collectedWarnings
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: {
            ok: out.ok,
            code: out.code,
            summary: out.summary,
            newDocId: out.newDocId,
            changedCount: out.changedBlocks.length,
            warnings: out.warnings
          },
          draftDocId: currentDocId
        })
        runtime.input.emitActivity({
          actionType: 'docx_apply_ops',
          status: 'completed',
          summary: `编辑完成: ${out.changedBlocks.length} 处变更`
        })
        return out
    },
  })

  const docxRollbackTool = createDocxTool({
    runtime,
    name: 'docx_rollback',
    description:
      'Move back to an ancestor docx snapshot in the current run without writing files. Use before user confirmation.',
    schema: rollbackSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: 'docx_rollback',
        status: 'failed',
        summary: `回滚失败: ${message}`
      })
    },
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

        runtime.input.emitActivity({
          actionType: 'docx_rollback',
          status: 'started',
          summary: `准备回滚文档快照: ${docId}`
        })

        const resolved = runtime.resolveRollbackTarget(docId, args.targetDocId, args.steps)
        if (!resolved.ok) {
          const out = runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'invalid_input',
            error: resolved.error
          })
          runtime.input.emitActivity({
            actionType: 'docx_rollback',
            status: 'failed',
            summary: out.summary
          })
          return out
        }

        runtime.state.lastDocId = resolved.targetDocId
        const sourcePath = runtime.state.sourcePathByDocId.get(docId)
        if (sourcePath && !runtime.state.sourcePathByDocId.has(resolved.targetDocId)) {
          runtime.state.sourcePathByDocId.set(resolved.targetDocId, sourcePath)
        }

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `rollback ready (${resolved.stepsApplied} step${resolved.stepsApplied === 1 ? '' : 's'}, not saved)`,
          docId: resolved.targetDocId,
          previousDocId: docId,
          stepsApplied: resolved.stepsApplied
        }
        runtime.toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: out,
          draftDocId: resolved.targetDocId
        })
        runtime.input.emitActivity({
          actionType: 'docx_rollback',
          status: 'completed',
          summary: `已切回草稿快照: ${resolved.targetDocId}`
        })
        return out
    },
  })

  return [docxApplyOpsTool, docxRollbackTool]
}
