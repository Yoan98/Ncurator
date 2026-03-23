import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxChangedBlock, DocxOp } from '../types'
import type { DocxToolRuntime } from '../runtime'
import { applyOpsSchema, rollbackSchema } from '../schemas'

export const buildDocxWriteTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxApplyOpsTool = tool(
    async (args) => {
      const toolName = 'docx_apply_ops'
      const toolCallId = runtime.toolEvents.emitStarted(toolName, args)
      try {
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
          const workerResponse = await runtime.callWorker({
            action: 'apply_ops',
            payload: {
              docId: currentDocId,
              ops: [op]
            }
          })

          if (!workerResponse.ok) {
            const out = runtime.emitWorkerFailure({
              toolName,
              toolCallId,
              response: workerResponse,
              draftDocId: currentDocId
            })
            runtime.input.emitActivity({
              actionType: 'docx_apply_ops',
              status: 'failed',
              summary: out.summary
            })
            return out
          }

          if (workerResponse.payload.action !== 'apply_ops') {
            return runtime.emitFailure({
              toolName,
              toolCallId,
              code: 'failed',
              error: 'worker protocol mismatch (apply_ops)',
              draftDocId: currentDocId
            })
          }

          const nextDocId = workerResponse.payload.newDocId
          const sourcePath = runtime.state.sourcePathByDocId.get(currentDocId)
          if (sourcePath) runtime.state.sourcePathByDocId.set(nextDocId, sourcePath)
          runtime.registerSnapshot(nextDocId, currentDocId)
          runtime.input.ctx.trackDocxChanges({
            previousDocId: currentDocId,
            nextDocId,
            op,
            changedBlocks: workerResponse.payload.changedBlocks
          })
          collectedChangedBlocks.push(...workerResponse.payload.changedBlocks)
          collectedWarnings.push(...workerResponse.payload.warnings)
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
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'failed',
          error: msg
        })
        runtime.input.emitActivity({
          actionType: 'docx_apply_ops',
          status: 'failed',
          summary: `编辑失败: ${msg}`
        })
        throw error
      }
    },
    {
      name: 'docx_apply_ops',
      description:
        'Apply structured docx operations and return a new immutable docId snapshot with changed blocks.',
      schema: applyOpsSchema
    }
  )

  const docxRollbackTool = tool(
    async (args) => {
      const toolName = 'docx_rollback'
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
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        runtime.emitFailure({
          toolName,
          toolCallId,
          code: 'failed',
          error: msg
        })
        runtime.input.emitActivity({
          actionType: 'docx_rollback',
          status: 'failed',
          summary: `回滚失败: ${msg}`
        })
        throw error
      }
    },
    {
      name: 'docx_rollback',
      description:
        'Move back to an ancestor docx snapshot in the current run without writing files. Use before user confirmation.',
      schema: rollbackSchema
    }
  )

  return [docxApplyOpsTool, docxRollbackTool]
}
