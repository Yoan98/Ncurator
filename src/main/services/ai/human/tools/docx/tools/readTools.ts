import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocxToolRuntime } from '../runtime'
import type {
  DocxDetailedBlock,
  DocxDetailedParagraphBlock,
  DocxDetailedTableBlock,
  DocxDetailedTableCell,
  DocxOutlineBlock
} from '../types'
import {
  DOCX_HISTORY_TOOL_SPEC,
  DOCX_OUTLINE_TOOL_SPEC,
  DOCX_READ_TOOL_SPEC
} from '../toolSpecs'
import {
  createDocxTool,
  finalizeDocxToolFailure,
  finalizeDocxToolSuccess
} from './workerTool'

const DEFAULT_OUTLINE_BLOCKS = 200
const MAX_READ_MATCHES = 20

const headingLevelFromStyle = (style: string | undefined): number | undefined => {
  const normalized = String(style || '').trim()
  if (!normalized) return undefined
  const match = normalized.match(/^heading\s*([1-6])$/i) || normalized.match(/^Heading([1-6])$/)
  return match ? Number(match[1]) : undefined
}

const blockPreview = (block: DocxOutlineBlock): string =>
  block.type === 'paragraph' ? block.text : block.type === 'table' ? block.preview : block.text

const buildOutlineBlock = (block: DocxOutlineBlock) => {
  if (block.type === 'paragraph') {
    return {
      blockId: block.blockId,
      type: block.type,
      bodyIndex: block.bodyIndex,
      style: block.style,
      headingLevel: headingLevelFromStyle(block.style),
      preview: block.text
    }
  }
  if (block.type === 'table') {
    return {
      blockId: block.blockId,
      type: block.type,
      bodyIndex: block.bodyIndex,
      rows: block.rows,
      cols: block.cols,
      preview: block.preview
    }
  }
  return {
    blockId: block.blockId,
    type: block.type,
    bodyIndex: block.bodyIndex,
    tableBlockId: block.tableBlockId,
    row: block.row,
    col: block.col,
    preview: block.text
  }
}

const buildContextPreview = (
  outlineById: Map<string, DocxOutlineBlock>,
  blockId: string | undefined
): string | undefined => {
  if (!blockId) return undefined
  const block = outlineById.get(blockId)
  if (!block) return undefined
  const preview = blockPreview(block).trim()
  return preview || undefined
}

const tableRowsFromCells = (cells: DocxDetailedTableCell[]): Array<Array<{ cellBlockId: string; text: string }>> => {
  const grouped = new Map<number, Array<{ cellBlockId: string; text: string }>>()
  cells.forEach((cell) => {
    const row = grouped.get(cell.row) || []
    row.push({
      cellBlockId: cell.blockId,
      text: cell.paragraphs.map((paragraph) => paragraph.text).join('\n')
    })
    grouped.set(cell.row, row)
  })
  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, row]) => row)
}

const buildParagraphMatch = (input: {
  block: DocxDetailedParagraphBlock
  outlineById: Map<string, DocxOutlineBlock>
}) => ({
  blockId: input.block.blockId,
  type: 'paragraph' as const,
  bodyIndex: input.block.bodyIndex,
  text: input.block.text,
  style: input.block.style,
  headingLevel: headingLevelFromStyle(input.block.style),
  contextBefore: buildContextPreview(input.outlineById, input.block.previousBodyBlockId),
  contextAfter: buildContextPreview(input.outlineById, input.block.nextBodyBlockId)
})

const buildTableMatch = (input: {
  block: DocxDetailedTableBlock
  outlineById: Map<string, DocxOutlineBlock>
}) => ({
  blockId: input.block.blockId,
  type: 'table' as const,
  bodyIndex: input.block.bodyIndex,
  rows: tableRowsFromCells(input.block.cells),
  contextBefore: buildContextPreview(input.outlineById, input.block.previousBodyBlockId),
  contextAfter: buildContextPreview(input.outlineById, input.block.nextBodyBlockId)
})

const buildCellMatch = (input: {
  block: Extract<DocxDetailedBlock, { type: 'table_cell' }>
  outlineById: Map<string, DocxOutlineBlock>
}) => ({
  blockId: input.block.blockId,
  type: 'table_cell' as const,
  bodyIndex: input.block.bodyIndex,
  tableBlockId: input.block.tableBlockId,
  row: input.block.row,
  col: input.block.col,
  text: input.block.text,
  contextBefore: buildContextPreview(input.outlineById, input.block.previousBodyBlockId),
  contextAfter: buildContextPreview(input.outlineById, input.block.nextBodyBlockId)
})

const buildReadMatch = (input: {
  block: DocxDetailedBlock
  outlineById: Map<string, DocxOutlineBlock>
}) => {
  if (input.block.type === 'paragraph') {
    return buildParagraphMatch({
      block: input.block,
      outlineById: input.outlineById
    })
  }
  if (input.block.type === 'table') {
    return buildTableMatch({
      block: input.block,
      outlineById: input.outlineById
    })
  }
  return buildCellMatch({
    block: input.block,
    outlineById: input.outlineById
  })
}

const fetchOutline = async (runtime: DocxToolRuntime, docId: string) => {
  const outlineResponse = await runtime.callWorker({
    action: 'outline',
    payload: {
      docId,
      maxBlocks: 5000,
      includeTables: true,
      includeCells: true
    }
  })
  if (!outlineResponse.ok) {
    throw new Error(outlineResponse.error)
  }
  if (outlineResponse.payload.action !== 'outline') {
    throw new Error('worker protocol mismatch (outline)')
  }
  return outlineResponse.payload.blocks
}

const fetchBlock = async (runtime: DocxToolRuntime, docId: string, blockId: string) => {
  const blockResponse = await runtime.callWorker({
    action: 'get_block',
    payload: {
      docId,
      blockId
    }
  })
  if (!blockResponse.ok) {
    throw new Error(blockResponse.error)
  }
  if (blockResponse.payload.action !== 'get_block') {
    throw new Error('worker protocol mismatch (get_block)')
  }
  return blockResponse.payload.block
}

export const buildDocxReadTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxOutlineTool = createDocxTool({
    runtime,
    name: DOCX_OUTLINE_TOOL_SPEC.name,
    description: DOCX_OUTLINE_TOOL_SPEC.description,
    schema: DOCX_OUTLINE_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      runtime.input.ctx.checkCancelled()
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const workerResponse = await runtime.callWorker({
        action: 'outline',
        payload: {
          docId: sessionResult.docId,
          maxBlocks: Number(args.maxBlocks || DEFAULT_OUTLINE_BLOCKS),
          includeTables: true,
          includeCells: true
        }
      })
      if (!workerResponse.ok) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitWorkerFailure({
            toolName,
            toolCallId,
            response: workerResponse,
            draftDocId: sessionResult.docId
          }),
          activity: {
            actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!
          }
        })
      }
      if (workerResponse.payload.action !== 'outline') {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            code: 'failed',
            error: 'worker protocol mismatch (outline)',
            draftDocId: sessionResult.docId
          }),
          activity: {
            actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!
          }
        })
      }

      const allBlocks = await fetchOutline(runtime, sessionResult.docId)
      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `返回 ${String(workerResponse.payload.blocks.length)} 个结构块`,
        sourcePath: sessionResult.sourcePath,
        currentVersionRef: sessionResult.currentVersionRef,
        returnedBlockCount: workerResponse.payload.blocks.length,
        totalBlockCount: allBlocks.length,
        truncated: workerResponse.payload.truncated,
        blocks: workerResponse.payload.blocks.map(buildOutlineBlock),
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'read',
          currentVersionRef: sessionResult.currentVersionRef
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
          currentVersionRef: result.currentVersionRef,
          returnedBlockCount: result.returnedBlockCount,
          totalBlockCount: result.totalBlockCount,
          truncated: result.truncated
        },
        draftDocId: sessionResult.docId,
        activity: {
          actionType: DOCX_OUTLINE_TOOL_SPEC.activityActionType!,
          startedSummary: `提取结构: ${sessionResult.sourcePath}`,
          buildCompletedSummary: (output) => `结构提取完成：${String(output.returnedBlockCount)} 个块`
        }
      })
    }
  })

  const docxReadTool = createDocxTool({
    runtime,
    name: DOCX_READ_TOOL_SPEC.name,
    description: DOCX_READ_TOOL_SPEC.description,
    schema: DOCX_READ_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_READ_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      runtime.input.ctx.checkCancelled()
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const outline = await fetchOutline(runtime, sessionResult.docId)
      const outlineById = new Map(outline.map((block) => [block.blockId, block]))
      const blockIds: string[] = []
      let totalMatchCount = 0

      if (typeof args.blockId === 'string' && args.blockId.trim()) {
        blockIds.push(args.blockId.trim())
        totalMatchCount = 1
      } else {
        const searchResponse = await runtime.callWorker({
          action: 'search',
          payload: {
            docId: sessionResult.docId,
            query: args.query!,
            mode: 'literal',
            scopeBlockIds: []
          }
        })
        if (!searchResponse.ok) {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitWorkerFailure({
              toolName,
              toolCallId,
              response: searchResponse,
              draftDocId: sessionResult.docId
            }),
            activity: {
              actionType: DOCX_READ_TOOL_SPEC.activityActionType!
            }
          })
        }
        if (searchResponse.payload.action !== 'search') {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              code: 'failed',
              error: 'worker protocol mismatch (search)',
              draftDocId: sessionResult.docId
            }),
            activity: {
              actionType: DOCX_READ_TOOL_SPEC.activityActionType!
            }
          })
        }
        totalMatchCount = searchResponse.payload.matches.length
        blockIds.push(...searchResponse.payload.matches.slice(0, MAX_READ_MATCHES).map((match) => match.blockId))
      }

      const blocks = await Promise.all(blockIds.map((blockId) => fetchBlock(runtime, sessionResult.docId, blockId)))
      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `返回 ${String(blocks.length)} 个命中片段`,
        sourcePath: sessionResult.sourcePath,
        currentVersionRef: sessionResult.currentVersionRef,
        truncated: totalMatchCount > blocks.length,
        totalMatchCount,
        matches: blocks.map((block) =>
          buildReadMatch({
            block,
            outlineById
          })
        ),
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'read',
          currentVersionRef: sessionResult.currentVersionRef
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
          currentVersionRef: result.currentVersionRef,
          matchCount: result.matches.length,
          truncated: result.truncated
        },
        draftDocId: sessionResult.docId,
        activity: {
          actionType: DOCX_READ_TOOL_SPEC.activityActionType!,
          startedSummary: `读取文档片段: ${sessionResult.sourcePath}`,
          buildCompletedSummary: (output) => `文档片段读取完成：${String(output.matches.length)} 个命中`
        }
      })
    }
  })

  const docxHistoryTool = createDocxTool({
    runtime,
    name: DOCX_HISTORY_TOOL_SPEC.name,
    description: DOCX_HISTORY_TOOL_SPEC.description,
    schema: DOCX_HISTORY_TOOL_SPEC.schema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_HISTORY_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      runtime.input.ctx.checkCancelled()
      const sessionResult = await runtime.ensureDocumentSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const versions = runtime.buildVersionHistory(
        sessionResult.sourcePath,
        Math.max(1, Number(args.limit || 10))
      )
      const result = {
        ok: true,
        code: 'ok' as const,
        summary: `返回 ${String(versions.length)} 个版本`,
        sourcePath: sessionResult.sourcePath,
        currentVersionRef: sessionResult.currentVersionRef,
        versions: versions.map((version) => ({
          versionRef: version.versionRef,
          parentVersionRef: version.parentVersionRef,
          createdAt: version.createdAt,
          isCurrent: version.isCurrent,
          summary: version.summary || '',
          changedBlocks: version.changedBlocks || []
        })),
        resourceContext: runtime.buildResourceContext({
          sourcePath: sessionResult.sourcePath,
          effectKind: 'history',
          currentVersionRef: sessionResult.currentVersionRef
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
          currentVersionRef: result.currentVersionRef,
          versionCount: result.versions.length
        },
        draftDocId: sessionResult.docId,
        activity: {
          actionType: DOCX_HISTORY_TOOL_SPEC.activityActionType!,
          startedSummary: `查看版本历史: ${sessionResult.sourcePath}`,
          buildCompletedSummary: (output) => `版本历史返回 ${String(output.versions.length)} 项`
        }
      })
    }
  })

  return [docxOutlineTool, docxReadTool, docxHistoryTool]
}
