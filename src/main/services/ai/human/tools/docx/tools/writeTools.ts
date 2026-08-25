import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  DocxBlockInput,
  DocxChangedBlock,
  DocxCreatedBlock,
  DocxCreateBlock,
  DocxCreateBreakNode,
  DocxCreateParagraphNode,
  DocxCreateRunNode,
  DocxCreateTabNode,
  DocxCreateTableCellNode,
  DocxCreateTableNode,
  DocxCreateTableRowNode,
  DocxCreateTextNode,
  DocxDetailedBlock,
  DocxEditAction,
  DocxOp,
  DocxOpenStats,
  DocxOutlineBlock
} from '../types'
import type { DocxToolRuntime } from '../runtime'
import { DOCX_EDIT_TOOL_SPEC } from '../toolSpecs'
import { createDocxTool, finalizeDocxToolFailure, finalizeDocxToolSuccess } from './workerTool'
import type { DocxToolFailure } from '../runtime'
import { createDocxFile } from '../utils/createDocxFile'
import {
  isLegacyDocPath,
  LEGACY_DOC_EDIT_ERROR
} from '../legacyDocPolicy'

const fetchOutlineBlocks = async (
  runtime: DocxToolRuntime,
  docId: string
): Promise<DocxOutlineBlock[]> => {
  const response = await runtime.callWorker({
    action: 'outline',
    payload: {
      docId,
      ranges: [{ fromBlockIndex: 0, toBlockIndex: Number.MAX_SAFE_INTEGER }],
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
  return response.payload.blocks
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

const summarizePositionedBlockText = (block: DocxDetailedBlock): string | undefined => {
  const normalized = block.text.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) return undefined
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized
}

const buildPositionedDiagnostic = (block: DocxDetailedBlock): string => {
  const targetText = summarizePositionedBlockText(block)
  const target = targetText ? `：包含“${targetText}”的区域` : ''
  return `当前命中复杂定位排版区域${target}，暂不支持自动编辑，以避免预览修订和版式叠加导致错位；该区域需要用户手动处理，其他非定位区域可继续自动编辑。`
}

const documentExists = async (sourcePath: string): Promise<boolean> => {
  try {
    await fs.access(sourcePath)
    return true
  } catch {
    return false
  }
}

const buildCreateTargetTempPaths = async (
  sourcePath: string
): Promise<{
  baselinePath: string
  workingPath: string
}> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-docx-create-'))
  const baseName = path.basename(sourcePath)
  return {
    baselinePath: path.join(tempDir, `baseline-${baseName}`),
    workingPath: path.join(tempDir, `working-${baseName}`)
  }
}

const failIfPositionedBlock = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentRevisionRef: string
  docId: string
  blockId: string
}): Promise<DocxToolFailure | null> => {
  let block: DocxDetailedBlock
  try {
    block = await fetchDetailedBlock(input.runtime, input.docId, input.blockId)
  } catch (error) {
    return input.runtime.emitFailure({
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      reason: 'invalid_input',
      error: error instanceof Error ? error.message : String(error),
      draftDocId: input.docId,
      resourceContext: input.runtime.buildResourceContext({
        sourcePath: input.sourcePath,
        effectKind: 'mutated',
        currentRevisionRef: input.currentRevisionRef
      })
    })
  }
  if (block.layoutMode !== 'positioned') {
    return null
  }
  const error = buildPositionedDiagnostic(block)
  return input.runtime.emitFailure({
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    reason: 'invalid_input',
    error,
    draftDocId: input.docId,
    resourceContext: input.runtime.buildResourceContext({
      sourcePath: input.sourcePath,
      effectKind: 'mutated',
      currentRevisionRef: input.currentRevisionRef
    })
  })
}

const resolveReplaceTextTargetBlockIds = async (input: {
  runtime: DocxToolRuntime
  docId: string
  query: string
  blockIds?: string[]
}): Promise<string[]> => {
  if (Array.isArray(input.blockIds) && input.blockIds.length > 0) {
    return [...new Set(input.blockIds)]
  }

  const searchResponse = await input.runtime.callWorker({
    action: 'search',
    payload: {
      docId: input.docId,
      query: input.query,
      mode: 'literal',
      scopeBlockIds: []
    }
  })
  if (!searchResponse.ok) {
    return []
  }
  if (searchResponse.payload.action !== 'search') {
    throw new Error('worker protocol mismatch (replace_text positioned search)')
  }
  return [...new Set(searchResponse.payload.matches.map((match) => match.blockId).filter(Boolean))]
}

const failIfAnyPositionedBlocks = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentRevisionRef: string
  docId: string
  blockIds: string[]
}): Promise<DocxToolFailure | null> => {
  for (const blockId of input.blockIds) {
    const failure = await failIfPositionedBlock({
      runtime: input.runtime,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      sourcePath: input.sourcePath,
      currentRevisionRef: input.currentRevisionRef,
      docId: input.docId,
      blockId
    })
    if (failure) {
      return failure
    }
  }
  return null
}

const bodyBlocksOnly = (blocks: readonly DocxOutlineBlock[]): DocxOutlineBlock[] =>
  blocks.filter((block) => block.type !== 'table_cell')

const compileRunChildren = (
  text: string
): Array<DocxCreateTextNode | DocxCreateTabNode | DocxCreateBreakNode> => {
  const nodes: Array<DocxCreateTextNode | DocxCreateTabNode | DocxCreateBreakNode> = []
  let buffer = ''
  const flush = (): void => {
    if (buffer.length === 0) return
    nodes.push({ type: 'text', text: buffer })
    buffer = ''
  }
  for (const char of text) {
    if (char === '\n') {
      flush()
      nodes.push({ type: 'break', kind: 'line' })
    } else if (char === '\t') {
      flush()
      nodes.push({ type: 'tab' })
    } else {
      buffer += char
    }
  }
  flush()
  return nodes
}

const compileParagraphInput = (input: Extract<DocxBlockInput, { text: string }>): DocxCreateParagraphNode => {
  const runChildren = compileRunChildren(input.text)
  const run: DocxCreateRunNode = {
    type: 'run',
    children: runChildren.length > 0 ? runChildren : [{ type: 'text', text: '' }]
  }
  return {
    type: 'paragraph',
    ...(input.style ? { style: input.style } : {}),
    children: [run]
  }
}

const compileTableInput = (input: Extract<DocxBlockInput, { rows: string[][] }>): DocxCreateTableNode => ({
  type: 'table',
  ...(input.style ? { style: input.style } : {}),
  children: input.rows.map(
    (row): DocxCreateTableRowNode => ({
      type: 'table_row',
      children: row.map(
        (cellText): DocxCreateTableCellNode => ({
          type: 'table_cell',
          children: [compileParagraphInput({ text: cellText })]
        })
      )
    })
  )
})

const compileBlockInput = (block: DocxBlockInput): DocxCreateBlock =>
  'text' in block ? compileParagraphInput(block) : compileTableInput(block)

type WriteToolResult = {
  sourcePath: string
  changedBlocks: DocxChangedBlock[]
  createdBlocks: DocxCreatedBlock[]
  createdBlockIds: string[]
  msg: string
}

const actionLabel = (action: DocxEditAction): string => {
  if (action.type === 'insert_blocks')
    return `${action.type}.${action.blockId ? action.position || 'after' : 'append'}.${String(action.blocks.length)}`
  if (action.type === 'delete_blocks') return `${action.type}.${String(action.blockIds.length)}`
  return action.type
}

type CompiledSerialAction = {
  action: DocxEditAction
}

type CompiledSerialEdit = {
  actions: CompiledSerialAction[]
  summary: string
}

type SerialActionOpRecord = {
  op: DocxOp
  beforeDocId: string
  nextDocId: string
  createdBlocks: DocxCreatedBlock[]
}

type ApplySerialEditResult =
  | {
      failure: DocxToolFailure
    }
  | {
      previousRevisionRef: string
      currentRevisionRef: string
      changedBlocks: DocxChangedBlock[]
      nextDocId: string
      nextStats: DocxOpenStats
      createdBlocks: DocxCreatedBlock[]
    }

const compileSerialEditActions = (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  actions: DocxEditAction[]
}): CompiledSerialEdit | { failure: DocxToolFailure } => {
  const actions: CompiledSerialAction[] = []

  for (const [actionIndex, action] of input.actions.entries()) {
    if (
      action.type === 'insert_blocks' ||
      action.type === 'replace_block' ||
      action.type === 'replace_text' ||
      action.type === 'delete_blocks' ||
      action.type === 'update_table_cell' ||
      action.type === 'style_text' ||
      action.type === 'style_paragraph' ||
      action.type === 'style_table' ||
      action.type === 'style_row' ||
      action.type === 'style_cell'
    ) {
      actions.push({ action })
      continue
    }

    return {
      failure: input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        reason: 'invalid_input',
        error: `unsupported docx_edit action at index ${String(actionIndex)}`,
        resourceContext: input.runtime.buildResourceContext({
          sourcePath: input.sourcePath,
          effectKind: 'mutated'
        })
      })
    }
  }

  return {
    actions,
    summary: `edit.serial:${input.actions.map(actionLabel).join(',')}`
  }
}

const buildSerialActionOps = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentDocId: string
  currentRevisionRef: string
  action: CompiledSerialAction
}): Promise<
  | {
      ops: DocxOp[]
      positionedCheckBlockIds: string[]
    }
  | { failure: DocxToolFailure }
> => {
  const action = input.action.action

  if (action.type === 'insert_blocks') {
    const bodyBlocks = action.blockId
      ? []
      : bodyBlocksOnly(await fetchOutlineBlocks(input.runtime, input.currentDocId))
    const anchorBlockId = action.blockId || bodyBlocks.at(-1)?.blockId
    if (!anchorBlockId) {
      throw new Error('DOCX 中没有可用于插入内容的正文位置')
    }
    const position = action.position || 'after'
    const op: DocxOp = {
      type: position === 'before' ? 'insert_before' : 'insert_after',
      anchorBlockId,
      content: action.blocks.map(compileBlockInput)
    }
    return {
      ops: [op],
      positionedCheckBlockIds: [anchorBlockId]
    }
  }

  if (action.type === 'replace_block') {
    const blockId = action.blockId
    return {
      ops: [
        {
          type: 'replace_block',
          blockId,
          content: compileBlockInput(action.block),
          allowVisualLoss: action.allowVisualLoss
        }
      ],
      positionedCheckBlockIds: [blockId]
    }
  }

  if (action.type === 'replace_text') {
    const blockIds = action.blockIds
    const targetBlockIds = await resolveReplaceTextTargetBlockIds({
      runtime: input.runtime,
      docId: input.currentDocId,
      query: action.query,
      blockIds
    })
    return {
      ops: [
        {
          type: 'replace_text',
          query: action.query,
          replace: action.replace,
          blockIds
        }
      ],
      positionedCheckBlockIds: targetBlockIds
    }
  }

  if (action.type === 'style_text') {
    const targetBlockIds = await resolveReplaceTextTargetBlockIds({
      runtime: input.runtime,
      docId: input.currentDocId,
      query: action.query,
      blockIds: action.blockIds
    })
    return {
      ops: [
        {
          type: 'style',
          target: {
            type: 'text_match',
            query: action.query,
            ...(action.blockIds ? { blockIds: action.blockIds } : {})
          },
          patch: { kind: 'run', ...action.style }
        }
      ],
      positionedCheckBlockIds: targetBlockIds
    }
  }

  if (action.type === 'style_paragraph') {
    return {
      ops: [
        {
          type: 'style',
          target: { type: 'id', id: action.id },
          patch: { kind: 'paragraph', ...action.style }
        }
      ],
      positionedCheckBlockIds: []
    }
  }

  if (action.type === 'style_table') {
    return {
      ops: [
        {
          type: 'style',
          target: { type: 'id', id: action.id },
          patch: { kind: 'table', ...action.style }
        }
      ],
      positionedCheckBlockIds: [action.id]
    }
  }

  if (action.type === 'style_row') {
    return {
      ops: [
        {
          type: 'style',
          target: { type: 'id', id: action.id },
          patch: { kind: 'table_row', ...action.style }
        }
      ],
      positionedCheckBlockIds: []
    }
  }

  if (action.type === 'style_cell') {
    return {
      ops: [
        {
          type: 'style',
          target: { type: 'id', id: action.id },
          patch: { kind: 'table_cell', ...action.style }
        }
      ],
      positionedCheckBlockIds: [action.id]
    }
  }

  if (action.type === 'update_table_cell') {
    const cellBlockId = action.cellBlockId
    return {
      ops: [
        {
          type: 'update_table_cell',
          blockId: cellBlockId,
          content: action.blocks.map(compileBlockInput),
          allowVisualLoss: action.allowVisualLoss
        }
      ],
      positionedCheckBlockIds: [cellBlockId]
    }
  }

  const blockIds = action.blockIds

  const outlineBlocks = await fetchOutlineBlocks(input.runtime, input.currentDocId)
  const rankByBlockId = new Map(
    bodyBlocksOnly(outlineBlocks).map((block, index) => [block.blockId, index] as const)
  )
  const orderedBlockIds = blockIds
    .slice()
    .sort((left, right) => (rankByBlockId.get(right) ?? -1) - (rankByBlockId.get(left) ?? -1))
  return {
    ops: orderedBlockIds.map((blockId) => ({
      type: 'delete_block' as const,
      blockId,
      allowVisualLoss: action.allowVisualLoss
    })),
    positionedCheckBlockIds: blockIds
  }
}

const resolveCreatedBlocksForSingleAction = async (input: {
  runtime: DocxToolRuntime
  previousDocId: string
  nextDocId: string
  ops: DocxOp[]
}): Promise<DocxCreatedBlock[][]> => {
  const createdBlocksByOp = input.ops.map((): DocxCreatedBlock[] => [])
  const insertOpIndex = input.ops.findIndex(
    (op) => op.type === 'insert_after' || op.type === 'insert_before'
  )
  if (insertOpIndex < 0) return createdBlocksByOp
  const insertOp = input.ops[insertOpIndex]
  if (insertOp.type !== 'insert_after' && insertOp.type !== 'insert_before')
    return createdBlocksByOp

  const beforeBlocks = await fetchOutlineBlocks(input.runtime, input.previousDocId)
  const afterBlocks = await fetchOutlineBlocks(input.runtime, input.nextDocId)
  const beforeBodyBlocks = bodyBlocksOnly(beforeBlocks)
  const afterBodyBlocks = bodyBlocksOnly(afterBlocks)
  const anchorIndex = beforeBodyBlocks.findIndex(
    (block) => block.blockId === insertOp.anchorBlockId
  )
  if (anchorIndex < 0) return createdBlocksByOp

  const startIndex = insertOp.type === 'insert_before' ? anchorIndex : anchorIndex + 1
  const createdBodyBlockIds = new Set(
    afterBodyBlocks
      .slice(startIndex, startIndex + insertOp.content.length)
      .map((block) => block.blockId)
  )
  createdBlocksByOp[insertOpIndex] = afterBlocks
    .filter((block) => {
      if (createdBodyBlockIds.has(block.blockId)) return true
      return block.type === 'table_cell' && createdBodyBlockIds.has(block.tableBlockId)
    })
    .map((block) => ({
      blockId: block.blockId,
      type: block.type
    }))

  return createdBlocksByOp
}

const expandSerialOpRecordsForReview = async (input: {
  runtime: DocxToolRuntime
  records: SerialActionOpRecord[]
}): Promise<{
  ops: DocxOp[]
  createdBlocksByOp: DocxCreatedBlock[][]
  opNextDocIds: string[]
}> => {
  const ops: DocxOp[] = []
  const createdBlocksByOp: DocxCreatedBlock[][] = []
  const opNextDocIds: string[] = []

  for (const record of input.records) {
    const expanded = await input.runtime.expandOpsForReview(record.beforeDocId, [record.op])
    expanded.forEach((op, index) => {
      ops.push(op)
      createdBlocksByOp.push(index === 0 ? record.createdBlocks : [])
      opNextDocIds.push(record.nextDocId)
    })
  }

  return {
    ops,
    createdBlocksByOp,
    opNextDocIds
  }
}

const applySerialEdit = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentDocId: string
  currentRevisionRef: string
  compiled: CompiledSerialEdit
}): Promise<ApplySerialEditResult> => {
  const cloned = input.runtime.cloneActiveReplaySession(input.sourcePath)
  if (!cloned.ok) {
    return {
      failure: input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        reason: 'failed',
        error: cloned.error,
        resourceContext: input.runtime.buildResourceContext({
          sourcePath: input.sourcePath,
          effectKind: 'mutated',
          currentRevisionRef: input.currentRevisionRef
        })
      })
    }
  }

  const tempSession = cloned.session
  let currentDocId = input.currentDocId
  const opRecords: SerialActionOpRecord[] = []
  const changedBlocks: DocxChangedBlock[] = []
  let nextStats: DocxOpenStats | undefined

  for (const [actionIndex, action] of input.compiled.actions.entries()) {
    const actionOps = await buildSerialActionOps({
      runtime: input.runtime,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      sourcePath: input.sourcePath,
      currentDocId,
      currentRevisionRef: input.currentRevisionRef,
      action
    })
    if ('failure' in actionOps) return { failure: actionOps.failure }

    const positionedFailure = await failIfAnyPositionedBlocks({
      runtime: input.runtime,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      sourcePath: input.sourcePath,
      currentRevisionRef: input.currentRevisionRef,
      docId: currentDocId,
      blockIds: [...new Set(actionOps.positionedCheckBlockIds)]
    })
    if (positionedFailure) return { failure: positionedFailure }

    const workerResponse = await input.runtime.callWorker({
      action: 'apply_ops',
      payload: {
        docId: currentDocId,
        ops: actionOps.ops
      }
    })
    if (!workerResponse.ok) {
      return {
        failure: input.runtime.emitWorkerFailure({
          toolName: input.toolName,
          toolCallId: input.toolCallId,
          response: workerResponse,
          draftDocId: currentDocId
        })
      }
    }
    if (workerResponse.payload.action !== 'apply_ops') {
      return {
        failure: input.runtime.emitFailure({
          toolName: input.toolName,
          toolCallId: input.toolCallId,
          reason: 'failed',
          error: 'worker protocol mismatch (apply_ops)',
          draftDocId: currentDocId
        })
      }
    }
    const appliedPayload = workerResponse.payload
    nextStats = appliedPayload.stats

    const createdBlocksByOp = await resolveCreatedBlocksForSingleAction({
      runtime: input.runtime,
      previousDocId: currentDocId,
      nextDocId: appliedPayload.newDocId,
      ops: actionOps.ops
    })

    for (const [opIndex, op] of actionOps.ops.entries()) {
      const record = {
        op,
        beforeDocId: currentDocId,
        nextDocId: appliedPayload.newDocId,
        createdBlocks: createdBlocksByOp[opIndex] || []
      }
      opRecords.push(record)
      const reviewOps = await input.runtime.expandOpsForReview(record.beforeDocId, [record.op])
      for (const reviewOp of reviewOps) {
        await input.runtime.applyTempRevisionToReplaySession({
          session: tempSession,
          revisionRef: `serial-temp-${String(actionIndex + 1)}`,
          op: reviewOp,
          createdBlocks: record.createdBlocks,
          nextDocId: record.nextDocId
        })
      }
    }

    changedBlocks.push(...appliedPayload.changedBlocks)
    currentDocId = appliedPayload.newDocId
  }

  const review = await expandSerialOpRecordsForReview({
    runtime: input.runtime,
    records: opRecords
  })
  const createdBlocks = review.createdBlocksByOp.flat()
  let persistedStats: Awaited<ReturnType<DocxToolRuntime['persistDocId']>>
  try {
    persistedStats = await input.runtime.persistDocId({
      sourcePath: input.sourcePath,
      docId: currentDocId
    })
  } catch (error) {
    return {
      failure: input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        reason: 'failed',
        error: `docx post-write persistence failed: ${error instanceof Error ? error.message : String(error)}`,
        resourceContext: input.runtime.buildResourceContext({
          sourcePath: input.sourcePath,
          effectKind: 'mutated',
          currentRevisionRef: input.currentRevisionRef
        })
      })
    }
  }

  let revisionUpdate: { currentRevisionRef: string; previousRevisionRef: string }
  try {
    revisionUpdate = await input.runtime.registerRevision({
      sourcePath: input.sourcePath,
      previousDocId: input.currentDocId,
      nextDocId: currentDocId,
      ops: review.ops,
      createdBlocks,
      createdBlocksByOp: review.createdBlocksByOp,
      opNextDocIds: review.opNextDocIds,
      changedBlocks,
      persistedStats,
      stats: nextStats,
      summary: input.compiled.summary
    })
  } catch (error) {
    await input.runtime
      .persistDocId({ sourcePath: input.sourcePath, docId: input.currentDocId })
      .catch(() => undefined)
    return {
      failure: input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        reason: 'failed',
        error: `docx session commit failed: ${error instanceof Error ? error.message : String(error)}`,
        resourceContext: input.runtime.buildResourceContext({
          sourcePath: input.sourcePath,
          effectKind: 'mutated',
          currentRevisionRef: input.currentRevisionRef
        })
      })
    }
  }
  input.runtime.input.ctx.trackDocxBatchChanges({
    previousDocId: input.currentDocId,
    nextDocId: currentDocId,
    ops: review.ops,
    changedBlocks,
    createdBlocks,
    replaySession: input.runtime.getReplaySession(input.sourcePath)
  })
  return {
    previousRevisionRef: revisionUpdate.previousRevisionRef,
    currentRevisionRef: revisionUpdate.currentRevisionRef,
    changedBlocks,
    nextDocId: currentDocId,
    nextStats: nextStats!,
    createdBlocks
  }
}

const buildWriteToolResult = async (input: {
  sourcePath: string
  changedBlocks: DocxChangedBlock[]
  createdBlocks: DocxCreatedBlock[]
}): Promise<WriteToolResult> => {
  return {
    sourcePath: input.sourcePath,
    changedBlocks: input.changedBlocks,
    createdBlocks: input.createdBlocks,
    createdBlockIds: input.createdBlocks.map((block) => block.blockId),
    msg: 'docx编辑成功'
  }
}

export const buildDocxWriteTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxEditTool = createDocxTool({
    runtime,
    name: DOCX_EDIT_TOOL_SPEC.name,
    description: DOCX_EDIT_TOOL_SPEC.promptSpec.description,
    schema: DOCX_EDIT_TOOL_SPEC.inputSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      if (isLegacyDocPath(args.sourcePath)) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            reason: 'invalid_input',
            error: LEGACY_DOC_EDIT_ERROR,
            resourceContext: runtime.buildResourceContext({
              sourcePath: args.sourcePath,
              effectKind: 'mutated'
            })
          }),
          activity: {
            actionType: DOCX_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }
      const requestedSourcePath = runtime.resolveDocxPath(args.sourcePath)
      if (!requestedSourcePath) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            reason: 'invalid_input',
            error: 'sourcePath must be a .docx path'
          }),
          activity: {
            actionType: DOCX_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

      const sourceExists = Boolean(
        runtime.getReadSession(requestedSourcePath) ||
        runtime.getReplaySession(requestedSourcePath) ||
        (await documentExists(requestedSourcePath))
      )
      if (!sourceExists) {
        const invalidCreateAction = args.actions.find((action) => action.type !== 'insert_blocks')
        if (invalidCreateAction) {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              reason: 'invalid_input',
              error: '新建 DOCX 时只能使用 insert_blocks；其他操作需要已有文档内容',
              resourceContext: runtime.buildResourceContext({
                sourcePath: requestedSourcePath,
                effectKind: 'mutated'
              })
            }),
            activity: {
              actionType: DOCX_EDIT_TOOL_SPEC.activityActionType!
            }
          })
        }

        const createBlocks = args.actions.reduce<DocxCreateBlock[]>((blocks, action) => {
          if (action.type !== 'insert_blocks') return blocks
          return [...blocks, ...action.blocks.map(compileBlockInput)]
        }, [])

        const tempPaths = await buildCreateTargetTempPaths(requestedSourcePath)

        try {
          await createDocxFile({
            filePath: tempPaths.baselinePath,
            blocks: []
          })
          await createDocxFile({
            filePath: tempPaths.workingPath,
            blocks: createBlocks
          })

          const baselineOpen = await runtime.callWorker({
            action: 'open',
            payload: {
              sourcePath: tempPaths.baselinePath
            }
          })
          if (!baselineOpen.ok) {
            return finalizeDocxToolFailure({
              runtime,
              failure: runtime.emitWorkerFailure({
                toolName,
                toolCallId,
                response: baselineOpen,
                resourceContext: runtime.buildResourceContext({
                  sourcePath: requestedSourcePath,
                  effectKind: 'mutated'
                })
              }),
              activity: {
                actionType: DOCX_EDIT_TOOL_SPEC.activityActionType!
              }
            })
          }
          if (baselineOpen.payload.action !== 'open') {
            return finalizeDocxToolFailure({
              runtime,
              failure: runtime.emitFailure({
                toolName,
                toolCallId,
                reason: 'failed',
                error: 'worker protocol mismatch (baseline open)',
                resourceContext: runtime.buildResourceContext({
                  sourcePath: requestedSourcePath,
                  effectKind: 'mutated'
                })
              }),
              activity: {
                actionType: DOCX_EDIT_TOOL_SPEC.activityActionType!
              }
            })
          }
          const baselineDocId = baselineOpen.payload.docId

          const workingOpen = await runtime.callWorker({
            action: 'open',
            payload: {
              sourcePath: tempPaths.workingPath
            }
          })
          if (!workingOpen.ok) {
            return finalizeDocxToolFailure({
              runtime,
              failure: runtime.emitWorkerFailure({
                toolName,
                toolCallId,
                response: workingOpen,
                resourceContext: runtime.buildResourceContext({
                  sourcePath: requestedSourcePath,
                  effectKind: 'mutated'
                })
              }),
              activity: {
                actionType: DOCX_EDIT_TOOL_SPEC.activityActionType!
              }
            })
          }
          if (workingOpen.payload.action !== 'open') {
            return finalizeDocxToolFailure({
              runtime,
              failure: runtime.emitFailure({
                toolName,
                toolCallId,
                reason: 'failed',
                error: 'worker protocol mismatch (working open)',
                resourceContext: runtime.buildResourceContext({
                  sourcePath: requestedSourcePath,
                  effectKind: 'mutated'
                })
              }),
              activity: {
                actionType: DOCX_EDIT_TOOL_SPEC.activityActionType!
              }
            })
          }
          const workingDocId = workingOpen.payload.docId

          let persistedStats: Awaited<ReturnType<DocxToolRuntime['persistDocId']>>
          try {
            persistedStats = await runtime.persistDocId({
              sourcePath: requestedSourcePath,
              docId: workingDocId
            })
          } catch (error) {
            return finalizeDocxToolFailure({
              runtime,
              failure: runtime.emitFailure({
                toolName,
                toolCallId,
                reason: 'failed',
                error: `docx create persistence failed: ${error instanceof Error ? error.message : String(error)}`,
                resourceContext: runtime.buildResourceContext({
                  sourcePath: requestedSourcePath,
                  effectKind: 'mutated'
                })
              }),
              activity: { actionType: DOCX_EDIT_TOOL_SPEC.activityActionType! }
            })
          }

          let registered: Awaited<ReturnType<typeof runtime.registerCreatedDocument>>
          try {
            registered = await runtime.registerCreatedDocument({
              sourcePath: requestedSourcePath,
              baselineDocId,
              workingDocId,
              meta: workingOpen.payload.meta,
              stats: workingOpen.payload.stats,
              persistedStats,
              summary: 'insert_blocks'
            })
          } catch (error) {
            await fs.rm(requestedSourcePath, { force: true }).catch(() => undefined)
            return finalizeDocxToolFailure({
              runtime,
              failure: runtime.emitFailure({
                toolName,
                toolCallId,
                reason: 'failed',
                error: `docx create session commit failed: ${error instanceof Error ? error.message : String(error)}`,
                resourceContext: runtime.buildResourceContext({
                  sourcePath: requestedSourcePath,
                  effectKind: 'mutated'
                })
              }),
              activity: { actionType: DOCX_EDIT_TOOL_SPEC.activityActionType! }
            })
          }
          runtime.input.ctx.trackDocxOpen({
            docId: baselineDocId,
            sourcePath: requestedSourcePath,
            replaySession: registered.session
          })
          runtime.input.ctx.trackDocxChanges({
            previousDocId: baselineDocId,
            nextDocId: workingDocId,
            op: { type: 'create_document' },
            changedBlocks: registered.changedBlocks || [],
            createdBlocks: registered.createdBlocks || [],
            replaySession: registered.session
          })

          const result = await buildWriteToolResult({
            sourcePath: registered.session.sourcePath,
            changedBlocks: registered.changedBlocks || [],
            createdBlocks: registered.createdBlocks || []
          })

          return finalizeDocxToolSuccess({
            runtime,
            toolName,
            toolCallId,
            result,
            outputPreview: {
              sourcePath: result.sourcePath
            },
            activity: {
              actionType: DOCX_EDIT_TOOL_SPEC.activityActionType!,
              startedSummary: '执行 docx_edit: insert_blocks',
              buildCompletedSummary: () => 'docx_edit 完成: insert_blocks'
            }
          })
        } finally {
          await Promise.all(
            [
              tempPaths.baselinePath,
              tempPaths.workingPath,
              path.dirname(tempPaths.baselinePath)
            ].map(async (targetPath) => {
              try {
                await fs.rm(targetPath, { recursive: true, force: true })
              } catch {
                return
              }
            })
          )
        }
      }

      const sessionResult = await runtime.ensureReplaySession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const compiled = compileSerialEditActions({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        actions: args.actions
      })
      if ('failure' in compiled) {
        return finalizeDocxToolFailure({
          runtime,
          failure: compiled.failure,
          activity: { actionType: DOCX_EDIT_TOOL_SPEC.activityActionType! }
        })
      }

      const applied = await applySerialEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        compiled
      })
      if ('failure' in applied) {
        return finalizeDocxToolFailure({
          runtime,
          failure: applied.failure,
          activity: { actionType: DOCX_EDIT_TOOL_SPEC.activityActionType! }
        })
      }

      const result = await buildWriteToolResult({
        sourcePath: sessionResult.sourcePath,
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks
      })
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        draftDocId: applied.nextDocId,
        activity: {
          actionType: DOCX_EDIT_TOOL_SPEC.activityActionType!,
          startedSummary: `执行 docx_edit: ${args.actions.map((action) => action.type).join(', ')}`,
          buildCompletedSummary: () =>
            `docx_edit 完成: ${args.actions.map((action) => action.type).join(', ')}`
        }
      })
    }
  })

  return [docxEditTool]
}
