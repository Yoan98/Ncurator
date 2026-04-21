import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  DocxChangedBlock,
  DocxCreatedBlock,
  DocxDetailedBlock,
  DocxOp,
  DocxParagraphSpec,
  DocxTableSpec,
  DocxTextStyle
} from '../types'
import type { DocxToolRuntime } from '../runtime'
import {
  DOCX_HEADING_EDIT_TOOL_SPEC,
  DOCX_PARAGRAPH_EDIT_TOOL_SPEC,
  DOCX_ROLLBACK_TOOL_SPEC,
  DOCX_TABLE_EDIT_TOOL_SPEC,
  DOCX_TEXT_EDIT_TOOL_SPEC,
  DOCX_TEXT_STYLE_EDIT_TOOL_SPEC
} from '../toolSpecs'
import {
  createDocxTool,
  finalizeDocxToolFailure,
  finalizeDocxToolSuccess
} from './workerTool'
import type { DocxToolFailure } from '../runtime'

const paragraphSpecFromText = (text: string, style?: string): DocxParagraphSpec => ({
  kind: 'paragraph',
  style,
  runs: [{ text }]
})

const tableSpecFromRows = (rows: string[][]): DocxTableSpec => ({
  kind: 'table',
  rows: rows.map((row) =>
    row.map((cellText) => ({
      paragraphs: [paragraphSpecFromText(cellText)]
    }))
  )
})

const headingStyle = (level: number): string => `Heading${String(level)}`

const buildEditSummary = (input: {
  toolName: string
  actionLabel: string
  changedBlocks: DocxChangedBlock[]
  warnings: string[]
}): string => {
  const base = `${input.actionLabel} 完成`
  const changed = input.changedBlocks.length > 0 ? `，共 ${String(input.changedBlocks.length)} 处变更` : ''
  const warnings = input.warnings.length > 0 ? `，${String(input.warnings.length)} 条警告` : ''
  return `${base}${changed}${warnings}`
}

const fetchOutlineBlockIds = async (runtime: DocxToolRuntime, docId: string): Promise<string[]> => {
  const response = await runtime.callWorker({
    action: 'outline',
    payload: {
      docId,
      maxBlocks: 5000,
      includeTables: true,
      includeCells: true
    }
  })
  if (!response.ok) {
    throw new Error(response.error)
  }
  if (response.payload.action !== 'outline') {
    throw new Error('worker protocol mismatch (outline)')
  }
  return response.payload.blocks.map((block) => block.blockId)
}

const fetchDetailedBlock = async (
  runtime: DocxToolRuntime,
  docId: string,
  blockId: string
): Promise<DocxDetailedBlock> => {
  const response = await runtime.callWorker({
    action: 'get_block',
    payload: {
      docId,
      blockId
    }
  })
  if (!response.ok) {
    throw new Error(response.error)
  }
  if (response.payload.action !== 'get_block') {
    throw new Error('worker protocol mismatch (get_block)')
  }
  return response.payload.block
}

const createdBlocksFromDiff = async (input: {
  runtime: DocxToolRuntime
  previousDocId: string
  nextDocId: string
}): Promise<DocxCreatedBlock[]> => {
  const before = new Set(await fetchOutlineBlockIds(input.runtime, input.previousDocId))
  const afterResponse = await input.runtime.callWorker({
    action: 'outline',
    payload: {
      docId: input.nextDocId,
      maxBlocks: 5000,
      includeTables: true,
      includeCells: true
    }
  })
  if (!afterResponse.ok) {
    throw new Error(afterResponse.error)
  }
  if (afterResponse.payload.action !== 'outline') {
    throw new Error('worker protocol mismatch (outline)')
  }
  return afterResponse.payload.blocks
    .filter((block) => !before.has(block.blockId))
    .map((block) => ({
      blockId: block.blockId,
      type: block.type
    }))
}

type ApplySingleEditResult =
  | {
      failure: DocxToolFailure
    }
  | {
      previousRevisionRef: string
      currentRevisionRef: string
      changedBlocks: DocxChangedBlock[]
      warnings: string[]
      nextDocId: string
      createdBlocks: DocxCreatedBlock[]
    }

const applySingleEdit = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentDocId: string
  currentRevisionRef: string
  ops: DocxOp[]
  summary: string
  createdBlocks?: boolean
}): Promise<ApplySingleEditResult> => {
  const workerResponse = await input.runtime.callWorker({
    action: 'apply_ops',
    payload: {
      docId: input.currentDocId,
      ops: input.ops
    }
  })
  if (!workerResponse.ok) {
    return {
      failure: input.runtime.emitWorkerFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        response: workerResponse,
        draftDocId: input.currentDocId
      })
    }
  }
  if (workerResponse.payload.action !== 'apply_ops') {
    return {
      failure: input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        code: 'failed',
        error: 'worker protocol mismatch (apply_ops)',
        draftDocId: input.currentDocId
      })
    }
  }

  const createdBlocks = input.createdBlocks
    ? await createdBlocksFromDiff({
        runtime: input.runtime,
        previousDocId: input.currentDocId,
        nextDocId: workerResponse.payload.newDocId
      })
    : []
  const reviewOps = await input.runtime.expandOpsForReview(input.currentDocId, input.ops)

  const revisionUpdate = await input.runtime.registerRevision({
    sourcePath: input.sourcePath,
    previousDocId: input.currentDocId,
    nextDocId: workerResponse.payload.newDocId,
    ops: reviewOps,
    createdBlocks,
    changedBlocks: workerResponse.payload.changedBlocks,
    summary: input.summary
  })
  input.runtime.input.ctx.trackDocxChanges({
    previousDocId: input.currentDocId,
    nextDocId: workerResponse.payload.newDocId,
    op: input.ops[0],
    changedBlocks: workerResponse.payload.changedBlocks,
    createdBlocks,
    replaySession: input.runtime.getReplaySession(input.sourcePath)
  })
  return {
    previousRevisionRef: revisionUpdate.previousRevisionRef,
    currentRevisionRef: revisionUpdate.currentRevisionRef,
    changedBlocks: workerResponse.payload.changedBlocks,
    warnings: workerResponse.payload.warnings,
    nextDocId: workerResponse.payload.newDocId,
    createdBlocks
  }
}

export const buildDocxWriteTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxParagraphEditTool = createDocxTool({
    runtime,
    name: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.name,
    description: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.description,
    schema: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      let op: DocxOp
      switch (args.action) {
        case 'insert_before':
        case 'insert_after':
          op = {
            type: args.action,
            anchorBlockId: args.anchorBlockId!,
            content: [paragraphSpecFromText(args.text!)]
          }
          break
        case 'replace_text': {
          const block = await fetchDetailedBlock(runtime, sessionResult.docId, args.blockId!)
          const style = block.type === 'paragraph' ? block.style : undefined
          op = {
            type: 'replace_block',
            blockId: args.blockId!,
            content: paragraphSpecFromText(args.text!, style)
          }
          break
        }
        case 'delete':
          op = {
            type: 'delete_block',
            blockId: args.blockId!
          }
          break
      }

      const applied = await applySingleEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: [op],
        summary: `paragraph.${args.action}`,
        createdBlocks: args.action === 'insert_before' || args.action === 'insert_after'
      })
      if ('failure' in applied) {
        return finalizeDocxToolFailure({
          runtime,
          failure: applied.failure,
          activity: {
            actionType: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: buildEditSummary({
          toolName,
          actionLabel: `段落${args.action}`,
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'mutated',
          previousRevisionRef: applied.previousRevisionRef,
          currentRevisionRef: applied.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          previousRevisionRef: result.previousRevisionRef,
          currentRevisionRef: result.currentRevisionRef,
          changedCount: result.changedBlocks.length,
          createdBlocks: result.createdBlocks
        },
        draftDocId: applied.nextDocId,
        activity: {
          actionType: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.activityActionType!,
          startedSummary: `执行段落编辑: ${args.action}`,
          buildCompletedSummary: (output) => output.summary
        }
      })
    }
  })

  const docxHeadingEditTool = createDocxTool({
    runtime,
    name: DOCX_HEADING_EDIT_TOOL_SPEC.name,
    description: DOCX_HEADING_EDIT_TOOL_SPEC.description,
    schema: DOCX_HEADING_EDIT_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_HEADING_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const spec = paragraphSpecFromText(args.text, headingStyle(args.level))
      let op: DocxOp
      if (args.action === 'replace_text') {
        op = {
          type: 'replace_block',
          blockId: args.blockId!,
          content: spec
        }
      } else {
        op = {
          type: args.action,
          anchorBlockId: args.anchorBlockId!,
          content: [spec]
        }
      }

      const applied = await applySingleEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: [op],
        summary: `heading.${args.action}.level_${String(args.level)}`,
        createdBlocks: args.action !== 'replace_text'
      })
      if ('failure' in applied) {
        return finalizeDocxToolFailure({
          runtime,
          failure: applied.failure,
          activity: {
            actionType: DOCX_HEADING_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: buildEditSummary({
          toolName,
          actionLabel: `标题${args.action}`,
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'mutated',
          previousRevisionRef: applied.previousRevisionRef,
          currentRevisionRef: applied.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          previousRevisionRef: result.previousRevisionRef,
          currentRevisionRef: result.currentRevisionRef,
          changedCount: result.changedBlocks.length,
          createdBlocks: result.createdBlocks
        },
        draftDocId: applied.nextDocId,
        activity: {
          actionType: DOCX_HEADING_EDIT_TOOL_SPEC.activityActionType!,
          startedSummary: `执行标题编辑: ${args.action}`,
          buildCompletedSummary: (output) => output.summary
        }
      })
    }
  })

  const docxTableEditTool = createDocxTool({
    runtime,
    name: DOCX_TABLE_EDIT_TOOL_SPEC.name,
    description: DOCX_TABLE_EDIT_TOOL_SPEC.description,
    schema: DOCX_TABLE_EDIT_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_TABLE_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      let op: DocxOp
      if (args.action === 'update_cell') {
        op = {
          type: 'update_table_cell',
          blockId: args.cellBlockId!,
          content: [paragraphSpecFromText(args.text!)]
        }
      } else {
        op = {
          type: args.action,
          anchorBlockId: args.anchorBlockId!,
          content: [tableSpecFromRows(args.rows!)]
        }
      }

      const applied = await applySingleEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: [op],
        summary: `table.${args.action}`,
        createdBlocks: args.action !== 'update_cell'
      })
      if ('failure' in applied) {
        return finalizeDocxToolFailure({
          runtime,
          failure: applied.failure,
          activity: {
            actionType: DOCX_TABLE_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: buildEditSummary({
          toolName,
          actionLabel: `表格${args.action}`,
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'mutated',
          previousRevisionRef: applied.previousRevisionRef,
          currentRevisionRef: applied.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          previousRevisionRef: result.previousRevisionRef,
          currentRevisionRef: result.currentRevisionRef,
          changedCount: result.changedBlocks.length,
          createdBlocks: result.createdBlocks
        },
        draftDocId: applied.nextDocId,
        activity: {
          actionType: DOCX_TABLE_EDIT_TOOL_SPEC.activityActionType!,
          startedSummary: `执行表格编辑: ${args.action}`,
          buildCompletedSummary: (output) => output.summary
        }
      })
    }
  })

  const docxTextEditTool = createDocxTool({
    runtime,
    name: DOCX_TEXT_EDIT_TOOL_SPEC.name,
    description: DOCX_TEXT_EDIT_TOOL_SPEC.description,
    schema: DOCX_TEXT_EDIT_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_TEXT_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const applied = await applySingleEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: [
          {
            type: 'replace_text',
            query: args.query,
            replace: args.replace,
            replaceAll: true,
            blockIds: args.blockIds
          }
        ],
        summary: `text.replace:${args.query}`
      })
      if ('failure' in applied) {
        return finalizeDocxToolFailure({
          runtime,
          failure: applied.failure,
          activity: {
            actionType: DOCX_TEXT_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: buildEditSummary({
          toolName,
          actionLabel: '文本替换',
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        changedBlocks: applied.changedBlocks,
        warnings: applied.warnings,
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'mutated',
          previousRevisionRef: applied.previousRevisionRef,
          currentRevisionRef: applied.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          previousRevisionRef: result.previousRevisionRef,
          currentRevisionRef: result.currentRevisionRef,
          changedCount: result.changedBlocks.length
        },
        draftDocId: applied.nextDocId,
        activity: {
          actionType: DOCX_TEXT_EDIT_TOOL_SPEC.activityActionType!,
          startedSummary: `执行文本替换: ${args.query}`,
          buildCompletedSummary: (output) => output.summary
        }
      })
    }
  })

  const docxTextStyleEditTool = createDocxTool({
    runtime,
    name: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.name,
    description: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.description,
    schema: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const applied = await applySingleEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: [
          {
            type: 'style_text',
            blockId: args.blockId,
            query: args.query,
            style: args.style as DocxTextStyle
          }
        ],
        summary: `text_style:${args.query}`
      })
      if ('failure' in applied) {
        return finalizeDocxToolFailure({
          runtime,
          failure: applied.failure,
          activity: {
            actionType: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const result = {
        ok: true,
        code: 'ok' as const,
        summary: buildEditSummary({
          toolName,
          actionLabel: '文本样式编辑',
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        changedBlocks: applied.changedBlocks,
        warnings: applied.warnings,
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'mutated',
          previousRevisionRef: applied.previousRevisionRef,
          currentRevisionRef: applied.currentRevisionRef
        })
      }
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        outputPreview: {
          ok: true,
          code: 'ok',
          sourcePath: result.sourcePath,
          previousRevisionRef: result.previousRevisionRef,
          currentRevisionRef: result.currentRevisionRef,
          changedCount: result.changedBlocks.length
        },
        draftDocId: applied.nextDocId,
        activity: {
          actionType: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.activityActionType!,
          startedSummary: `执行文本样式编辑: ${args.query}`,
          buildCompletedSummary: (output) => output.summary
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
        summary: `回退失败: ${message}`
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const resolved = runtime.resolveRevisionRollbackTarget(
        sessionResult.sourcePath,
        args.revisionRef,
        undefined
      )
      if (!resolved.ok) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'invalid_input',
            error: resolved.error,
            resourceContext: runtime.buildResourceContext({
              sourcePath: sessionResult.sourcePath,
              effectKind: 'rolled_back',
              currentRevisionRef: sessionResult.currentRevisionRef
            })
          }),
          activity: {
            actionType: DOCX_ROLLBACK_TOOL_SPEC.activityActionType!
          }
        })
      }

      const revisionState = await runtime.activateRevision({
        sourcePath: sessionResult.sourcePath,
        targetDocId: resolved.targetDocId,
        targetRevisionRef: resolved.targetRevisionRef
      })
      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `已切回修订 ${resolved.targetRevisionRef}`,
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: revisionState.previousRevisionRef,
        currentRevisionRef: revisionState.currentRevisionRef,
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'rolled_back',
          previousRevisionRef: revisionState.previousRevisionRef,
          currentRevisionRef: revisionState.currentRevisionRef
        })
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
          startedSummary: `准备回退到 ${args.revisionRef}`,
          buildCompletedSummary: (output) => output.summary
        }
      })
    }
  })

  return [
    docxParagraphEditTool,
    docxHeadingEditTool,
    docxTableEditTool,
    docxTextEditTool,
    docxTextStyleEditTool,
    docxRollbackTool
  ]
}
