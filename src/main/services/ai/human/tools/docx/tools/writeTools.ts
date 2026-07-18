import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  DocxChangedBlock,
  DocxCreatedBlock,
  DocxCreateBlock,
  DocxDetailedBlock,
  DocxEditAction,
  DocxOp,
  DocxOutlineBlock,
  DocxParagraphSpec,
  DocxTableSpec,
  DocxPostWriteReadback
} from '../types'
import type { DocxToolRuntime } from '../runtime'
import { DOCX_POST_WRITE_READBACK_WINDOW_POLICY } from '../writeReadbackPolicy'
import { DOCX_EDIT_TOOL_SPEC } from '../toolSpecs'
import { createDocxTool, finalizeDocxToolFailure, finalizeDocxToolSuccess } from './workerTool'
import type { DocxToolFailure } from '../runtime'
import { createDocxFile } from '../utils/createDocxFile'

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

const blockSpecFromCreateBlock = (block: DocxCreateBlock): DocxParagraphSpec | DocxTableSpec => {
  if (block.type === 'table') return tableSpecFromRows(block.rows)
  if (block.type === 'heading')
    return paragraphSpecFromText(block.text, headingStyle(block.level || 1))
  return paragraphSpecFromText(block.text)
}

const buildEditSummary = (input: {
  toolName: string
  actionLabel: string
  changedBlocks: DocxChangedBlock[]
  warnings: string[]
}): string => {
  const base = `${input.actionLabel} 完成`
  const changed =
    input.changedBlocks.length > 0 ? `，共 ${String(input.changedBlocks.length)} 处变更` : ''
  const warnings = input.warnings.length > 0 ? `，${String(input.warnings.length)} 条警告` : ''
  return `${base}${changed}${warnings}`
}

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

const buildCreateSummary = (sourcePath: string): string => `已建立新的 docx 草稿会话：${sourcePath}`

const summarizePositionedBlockText = (block: DocxDetailedBlock): string | undefined => {
  const normalized = block.text.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) return undefined
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized
}

const buildPositionedDiagnostic = (block: DocxDetailedBlock): string => {
  const targetText = summarizePositionedBlockText(block)
  const target = targetText ? `：包含“${targetText}”的区域` : ''
  return `当前命中复杂定位排版区域${target}，暂不支持自动编辑，以避免预览修订和版式叠加导致错位；你可以手动按建议内容调整该处。`
}

const getOutlineBlockIndex = (blocks: readonly DocxOutlineBlock[], blockId: string): number =>
  blocks.findIndex((block) => block.blockId === blockId)

const toRangeRegion = (
  blocks: readonly DocxOutlineBlock[],
  startIndex: number,
  endIndex: number
): { startBlockId: string; endBlockId: string } | null => {
  if (blocks.length === 0) return null
  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) return null
  const startBlockId = blocks[startIndex]?.blockId
  const endBlockId = blocks[endIndex]?.blockId
  if (!startBlockId || !endBlockId) return null
  return {
    startBlockId,
    endBlockId
  }
}

const mergeReadbackRegions = (
  blocks: readonly DocxOutlineBlock[],
  regions: Array<{ startBlockId: string; endBlockId: string }>
): Array<{ startBlockId: string; endBlockId: string }> => {
  const indexByBlockId = new Map(blocks.map((block, index) => [block.blockId, index] as const))
  const orderedRanges = regions
    .map((region) => {
      const fromIndex = indexByBlockId.get(region.startBlockId)
      const toIndex = indexByBlockId.get(region.endBlockId)
      if (typeof fromIndex !== 'number' || typeof toIndex !== 'number' || fromIndex > toIndex) {
        return null
      }
      return {
        startBlockId: region.startBlockId,
        endBlockId: region.endBlockId,
        fromIndex,
        toIndex
      }
    })
    .filter(
      (
        region
      ): region is {
        startBlockId: string
        endBlockId: string
        fromIndex: number
        toIndex: number
      } => Boolean(region)
    )
    .sort((left, right) => left.fromIndex - right.fromIndex)

  const merged: Array<{ fromIndex: number; toIndex: number }> = []
  for (const region of orderedRanges) {
    const last = merged[merged.length - 1]
    if (!last || region.fromIndex > last.toIndex + 1) {
      merged.push({
        fromIndex: region.fromIndex,
        toIndex: region.toIndex
      })
      continue
    }
    last.toIndex = Math.max(last.toIndex, region.toIndex)
  }

  return merged
    .map((region) => toRangeRegion(blocks, region.fromIndex, region.toIndex))
    .filter((region): region is { startBlockId: string; endBlockId: string } => Boolean(region))
}

const buildCurrentOutlineReadbackRegions = (input: {
  outlineBlocks: DocxOutlineBlock[]
  targetBlockIds: string[]
  beforeBlockCount: number
  afterBlockCount: number
}): Array<{ startBlockId: string; endBlockId: string }> => {
  const regions: Array<{ startBlockId: string; endBlockId: string }> = []
  const uniqueTargetBlockIds = [...new Set(input.targetBlockIds)]
  for (const targetBlockId of uniqueTargetBlockIds) {
    const targetIndex = getOutlineBlockIndex(input.outlineBlocks, targetBlockId)
    if (targetIndex < 0) continue
    const startIndex = Math.max(0, targetIndex - input.beforeBlockCount)
    const endIndex = Math.min(input.outlineBlocks.length - 1, targetIndex + input.afterBlockCount)
    const region = toRangeRegion(input.outlineBlocks, startIndex, endIndex)
    if (region) regions.push(region)
  }
  return mergeReadbackRegions(input.outlineBlocks, regions)
}

const buildDeletedReadbackRegions = (input: {
  previousOutlineBlocks: DocxOutlineBlock[]
  currentOutlineBlocks: DocxOutlineBlock[]
  targetBlockIds: string[]
  beforeBlockCount: number
  afterBlockCount: number
}): Array<{ startBlockId: string; endBlockId: string }> => {
  const currentBlockIdSet = new Set(input.currentOutlineBlocks.map((block) => block.blockId))
  const regions: Array<{ startBlockId: string; endBlockId: string }> = []
  const uniqueTargetBlockIds = [...new Set(input.targetBlockIds)]

  for (const targetBlockId of uniqueTargetBlockIds) {
    const targetIndex = getOutlineBlockIndex(input.previousOutlineBlocks, targetBlockId)
    if (targetIndex < 0) continue
    const startIndex = Math.max(0, targetIndex - input.beforeBlockCount)
    const endIndex = Math.min(
      input.previousOutlineBlocks.length - 1,
      targetIndex + input.afterBlockCount
    )
    const candidateBlockIds = input.previousOutlineBlocks
      .slice(startIndex, endIndex + 1)
      .map((block) => block.blockId)
      .filter((blockId) => blockId !== targetBlockId && currentBlockIdSet.has(blockId))
    if (candidateBlockIds.length === 0) continue
    regions.push({
      startBlockId: candidateBlockIds[0],
      endBlockId: candidateBlockIds[candidateBlockIds.length - 1]
    })
  }

  return mergeReadbackRegions(input.currentOutlineBlocks, regions)
}

const buildPostWriteReadback = async (input: {
  runtime: DocxToolRuntime
  currentDocId: string
  previousDocId?: string
  targets: Array<{
    action: keyof typeof DOCX_POST_WRITE_READBACK_WINDOW_POLICY
    targetBlockIds: string[]
  }>
}): Promise<DocxPostWriteReadback> => {
  const currentOutlineBlocks = await fetchOutlineBlocks(input.runtime, input.currentDocId)

  let regions: Array<{ startBlockId: string; endBlockId: string }> = []
  const previousOutlineBlocks =
    input.previousDocId && input.targets.some((target) => target.action === 'delete_block')
      ? await fetchOutlineBlocks(input.runtime, input.previousDocId)
      : []

  for (const target of input.targets) {
    const policy = DOCX_POST_WRITE_READBACK_WINDOW_POLICY[target.action]
    if (target.action === 'create_document') {
      if (currentOutlineBlocks.length > 0) {
        const endIndex = Math.min(
          currentOutlineBlocks.length - 1,
          Math.max(0, policy.afterBlockCount)
        )
        const region = toRangeRegion(currentOutlineBlocks, 0, endIndex)
        if (region) regions.push(region)
      }
      continue
    }
    if (target.action === 'delete_block') {
      regions.push(
        ...buildDeletedReadbackRegions({
          previousOutlineBlocks,
          currentOutlineBlocks,
          targetBlockIds: target.targetBlockIds,
          beforeBlockCount: policy.beforeBlockCount,
          afterBlockCount: policy.afterBlockCount
        })
      )
      continue
    }
    regions.push(
      ...buildCurrentOutlineReadbackRegions({
        outlineBlocks: currentOutlineBlocks,
        targetBlockIds: target.targetBlockIds,
        beforeBlockCount: policy.beforeBlockCount,
        afterBlockCount: policy.afterBlockCount
      })
    )
  }
  regions = mergeReadbackRegions(currentOutlineBlocks, regions)

  const indexByBlockId = new Map(
    currentOutlineBlocks.map((block, index) => [block.blockId, index] as const)
  )
  const indexRegions = regions
    .map((region) => {
      const fromBlockIndex = indexByBlockId.get(region.startBlockId)
      const toBlockIndex = indexByBlockId.get(region.endBlockId)
      if (typeof fromBlockIndex !== 'number' || typeof toBlockIndex !== 'number') {
        return null
      }
      return {
        fromBlockIndex,
        toBlockIndex
      }
    })
    .filter((region): region is { fromBlockIndex: number; toBlockIndex: number } => Boolean(region))

  return input.runtime.buildPostWriteReadback({
    docId: input.currentDocId,
    regions: indexRegions
  })
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
    decisionHint: {
      code: 'hand_docx_positioned_write_blocked',
      detail: {
        toolName: 'docx_edit',
        sourcePath: input.sourcePath,
        error
      }
    },
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

type BatchReadbackTarget = {
  action: keyof typeof DOCX_POST_WRITE_READBACK_WINDOW_POLICY
  targetBlockIds: string[]
}

type WriteToolResult = {
  sourcePath: string
  changedBlocks: DocxChangedBlock[]
  createdBlocks?: DocxCreatedBlock[]
  warnings: string[]
  postWriteReadback: DocxPostWriteReadback
}

const actionLabel = (action: DocxEditAction): string => {
  if (action.type === 'insert_blocks')
    return `${action.type}.${action.position}.${String(action.blocks.length)}`
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
      warnings: string[]
      nextDocId: string
      createdBlocks: DocxCreatedBlock[]
      readbackTargets: BatchReadbackTarget[]
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
    if (action.type === 'create_document') {
      return {
        failure: input.runtime.emitFailure({
          toolName: input.toolName,
          toolCallId: input.toolCallId,
          reason: 'invalid_input',
          error: 'docx_edit(create_document) must be the only action in a call',
          resourceContext: input.runtime.buildResourceContext({
            sourcePath: input.sourcePath,
            effectKind: 'mutated'
          })
        })
      }
    }

    if (
      action.type === 'insert_blocks' ||
      action.type === 'replace_block' ||
      action.type === 'replace_text' ||
      action.type === 'style_text' ||
      action.type === 'update_table_cell' ||
      action.type === 'delete_blocks'
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
      readbackTarget: BatchReadbackTarget
      positionedCheckBlockIds: string[]
    }
  | { failure: DocxToolFailure }
> => {
  const action = input.action.action

  if (action.type === 'insert_blocks') {
    const anchorBlockId = action.anchorBlockId
    const op: DocxOp = {
      type: action.position === 'before' ? 'insert_before' : 'insert_after',
      anchorBlockId,
      content: action.blocks.map((block) => blockSpecFromCreateBlock(block))
    }
    return {
      ops: [op],
      readbackTarget: {
        action: op.type,
        targetBlockIds: [anchorBlockId]
      },
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
          content: blockSpecFromCreateBlock(action.block)
        }
      ],
      readbackTarget: {
        action: 'replace_block',
        targetBlockIds: [blockId]
      },
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
          replaceAll: true,
          blockIds
        }
      ],
      readbackTarget: {
        action: 'replace_text',
        targetBlockIds
      },
      positionedCheckBlockIds: targetBlockIds
    }
  }

  if (action.type === 'style_text') {
    const blockId = action.blockId
    return {
      ops: [
        {
          type: 'style_text',
          blockId,
          query: action.query,
          style: action.style
        }
      ],
      readbackTarget: {
        action: 'style_text',
        targetBlockIds: [blockId]
      },
      positionedCheckBlockIds: [blockId]
    }
  }

  if (action.type === 'update_table_cell') {
    const cellBlockId = action.cellBlockId
    return {
      ops: [
        {
          type: 'update_table_cell',
          blockId: cellBlockId,
          content: [paragraphSpecFromText(action.text)]
        }
      ],
      readbackTarget: {
        action: 'update_table_cell',
        targetBlockIds: [cellBlockId]
      },
      positionedCheckBlockIds: [cellBlockId]
    }
  }

  if (action.type !== 'delete_blocks') {
    return {
      failure: input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        reason: 'invalid_input',
        error: `unsupported serial docx action: ${action.type}`,
        resourceContext: input.runtime.buildResourceContext({
          sourcePath: input.sourcePath,
          effectKind: 'mutated'
        })
      })
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
      blockId
    })),
    readbackTarget: {
      action: 'delete_block',
      targetBlockIds: blockIds
    },
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
  const warnings: string[] = []
  const readbackTargets: BatchReadbackTarget[] = []

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
    warnings.push(...appliedPayload.warnings)
    readbackTargets.push(actionOps.readbackTarget)
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
    warnings,
    nextDocId: currentDocId,
    createdBlocks,
    readbackTargets
  }
}

const buildWriteToolResult = async (input: {
  runtime: DocxToolRuntime
  sourcePath: string
  previousRevisionRef: string
  currentRevisionRef: string
  nextDocId: string
  summary: string
  changedBlocks: DocxChangedBlock[]
  createdBlocks: DocxCreatedBlock[]
  warnings: string[]
  readbackTargets: BatchReadbackTarget[]
  previousDocId?: string
}): Promise<WriteToolResult> => {
  const postWriteReadback = await buildPostWriteReadback({
    runtime: input.runtime,
    currentDocId: input.nextDocId,
    previousDocId: input.previousDocId,
    targets: input.readbackTargets
  })

  return {
    sourcePath: input.sourcePath,
    changedBlocks: input.changedBlocks,
    createdBlocks: input.createdBlocks,
    warnings: input.warnings,
    postWriteReadback
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
      const createAction = args.actions.find((action) => action.type === 'create_document')
      if (createAction) {
        if (args.actions.length !== 1) {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              reason: 'invalid_input',
              error: 'docx_edit create_document must be the only action in a call',
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

        const requestedSourcePath = runtime.resolveDocxPath({
          cwd: runtime.workspaceRootPath,
          rawPath: args.sourcePath
        })
        if (!requestedSourcePath) {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              reason: 'invalid_input',
              error: 'sourcePath must be a workspace-bound .docx path'
            }),
            activity: {
              actionType: DOCX_EDIT_TOOL_SPEC.activityActionType!
            }
          })
        }

        if (
          runtime.getReadSession(requestedSourcePath) ||
          runtime.getReplaySession(requestedSourcePath) ||
          (await documentExists(requestedSourcePath))
        ) {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              reason: 'invalid_input',
              error: `docx_edit(create_document) will not overwrite an existing file: ${requestedSourcePath}`,
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

        const tempPaths = await buildCreateTargetTempPaths(requestedSourcePath)

        try {
          await createDocxFile({
            filePath: tempPaths.baselinePath,
            blocks: []
          })
          await createDocxFile({
            filePath: tempPaths.workingPath,
            blocks: createAction.blocks || []
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
              summary: 'create_document'
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
            runtime,
            sourcePath: registered.session.sourcePath,
            previousRevisionRef: registered.previousRevisionRef,
            currentRevisionRef: registered.currentRevisionRef,
            nextDocId: workingDocId,
            summary: buildCreateSummary(registered.session.sourcePath),
            changedBlocks: registered.changedBlocks || [],
            createdBlocks: registered.createdBlocks || [],
            warnings: [],
            readbackTargets: [{ action: 'create_document', targetBlockIds: [] }]
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
              startedSummary: '执行 docx_edit: create_document',
              buildCompletedSummary: () => 'docx_edit 完成: create_document'
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
        runtime,
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        nextDocId: applied.nextDocId,
        summary: buildEditSummary({
          toolName,
          actionLabel: `串行编辑 ${String(args.actions.length)} 个 action`,
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        readbackTargets: applied.readbackTargets,
        previousDocId: sessionResult.docId
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
