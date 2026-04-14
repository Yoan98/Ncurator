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
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_APPLY_OPS_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: `编辑失败: ${message}`
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = runtime.requireDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure
      const expandedOps = await runtime.expandOpsForReview(sessionResult.docId, args.ops as DocxOp[])
      runtime.input.emitActivity({
        actionType: DOCX_APPLY_OPS_TOOL_SPEC.activityActionType!,
        status: 'started',
        summary: `应用操作: ${expandedOps.length} 条`
      })
      let currentDocId = sessionResult.docId
      let previousVersionRef = sessionResult.currentVersionRef
      let currentVersionRef = sessionResult.currentVersionRef
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
        const versionUpdate = runtime.registerDerivedVersion({
          sourcePath: sessionResult.sourcePath,
          previousDocId: currentDocId,
          nextDocId
        })
        runtime.input.ctx.trackDocxChanges({
          previousDocId: currentDocId,
          nextDocId,
          op,
          changedBlocks: workerPayload.changedBlocks
        })
        collectedChangedBlocks.push(...workerPayload.changedBlocks)
        collectedWarnings.push(...workerPayload.warnings)
        currentDocId = nextDocId
        previousVersionRef = versionUpdate.previousVersionRef
        currentVersionRef = versionUpdate.currentVersionRef
      }

      const resourceContext = runtime.buildResourceContext({
        sourcePath: sessionResult.sourcePath,
        effectKind: 'mutated',
        previousVersionRef,
        currentVersionRef
      })
      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `ops applied (${collectedChangedBlocks.length} changes)`,
        sourcePath: sessionResult.sourcePath,
        previousVersionRef,
        currentVersionRef,
        changedBlocks: collectedChangedBlocks,
        warnings: collectedWarnings,
        resourceContext
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
          sourcePath: result.sourcePath,
          previousVersionRef: result.previousVersionRef,
          currentVersionRef: result.currentVersionRef,
          changedCount: result.changedBlocks.length,
          warnings: result.warnings
        },
        draftDocId: currentDocId,
        activity: {
          actionType: DOCX_APPLY_OPS_TOOL_SPEC.activityActionType!,
          buildCompletedSummary: (output) => `编辑完成: ${String(output.changedBlocks.length)} 处变更`
        }
      })
    }
  })

  const docxRollbackTool = createDocxTool({
    runtime,
    name: DOCX_ROLLBACK_TOOL_SPEC.name,
    description: DOCX_ROLLBACK_TOOL_SPEC.description,
    schema: DOCX_ROLLBACK_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_ROLLBACK_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: `回滚失败: ${message}`
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      runtime.input.emitActivity({
        actionType: DOCX_ROLLBACK_TOOL_SPEC.activityActionType!,
        status: 'started',
        summary: `准备回滚文档版本: ${args.sourcePath}`
      })

      const resolved = runtime.resolveRollbackTarget(args.sourcePath, args.targetVersionRef, args.steps)
      if (!resolved.ok) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'invalid_input',
            error: resolved.error,
            resourceContext: runtime.buildResourceContext({
              sourcePath: args.sourcePath,
              effectKind: 'rolled_back'
            })
          }),
          activity: {
            actionType: DOCX_ROLLBACK_TOOL_SPEC.activityActionType!,
            buildFailedSummary: (failure) => failure.summary
          }
        })
      }

      const versionState = runtime.activateVersion({
        sourcePath: args.sourcePath,
        targetDocId: resolved.targetDocId,
        targetVersionRef: resolved.targetVersionRef
      })
      const resourceContext = runtime.buildResourceContext({
        sourcePath: args.sourcePath,
        effectKind: 'rolled_back',
        previousVersionRef: versionState.previousVersionRef,
        currentVersionRef: versionState.currentVersionRef
      })
      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `rollback ready (${resolved.stepsApplied} step${resolved.stepsApplied === 1 ? '' : 's'}, not saved)`,
        sourcePath: args.sourcePath,
        previousVersionRef: versionState.previousVersionRef,
        currentVersionRef: versionState.currentVersionRef,
        stepsApplied: resolved.stepsApplied,
        resourceContext
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
          buildCompletedSummary: (output) => `已切回草稿版本: ${output.currentVersionRef}`
        }
      })
    }
  })

  return [docxApplyOpsTool, docxRollbackTool]
}
