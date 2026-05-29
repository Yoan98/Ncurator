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
import {
  DOCX_EDIT_TOOL_SPEC,
  DOCX_ROLLBACK_TOOL_SPEC,
} from '../toolSpecs'
import {
  createDocxTool,
  finalizeDocxToolFailure,
  finalizeDocxToolSuccess
} from './workerTool'
import type { DocxToolFailure } from '../runtime'
import { DOCX_POSITIONED_LAYOUT_PROTECTION_MESSAGE } from '../constants'
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
  if (block.type === 'heading') return paragraphSpecFromText(block.text, headingStyle(block.level || 1))
  return paragraphSpecFromText(block.text)
}

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

const buildPositionedReadOnlyMessage = (): string => DOCX_POSITIONED_LAYOUT_PROTECTION_MESSAGE

const buildCreateSummary = (sourcePath: string): string => `已建立新的 docx 草稿会话：${sourcePath}`

const resolveCurrentSnapshotBlockIds = (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
  blockIds: string[]
  allowDeleted?: boolean
}): string[] | DocxToolFailure => {
  const resolved = input.runtime.resolveCurrentBlockIdsFromSnapshot({
    sourcePath: input.sourcePath,
    field: input.field,
    blockIds: input.blockIds,
    allowDeleted: input.allowDeleted
  })
  if (!resolved.ok) {
    return input.runtime.emitFailure({
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      reason: 'invalid_input',
      error: resolved.error,
      resourceContext: input.runtime.buildResourceContext({
        sourcePath: input.sourcePath,
        effectKind: 'mutated'
      })
    })
  }
  return resolved.blockIds
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
    const endIndex = Math.min(input.previousOutlineBlocks.length - 1, targetIndex + input.afterBlockCount)
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
      regions.push(...buildDeletedReadbackRegions({
        previousOutlineBlocks,
        currentOutlineBlocks,
        targetBlockIds: target.targetBlockIds,
        beforeBlockCount: policy.beforeBlockCount,
        afterBlockCount: policy.afterBlockCount
      }))
      continue
    }
    regions.push(...buildCurrentOutlineReadbackRegions({
      outlineBlocks: currentOutlineBlocks,
      targetBlockIds: target.targetBlockIds,
      beforeBlockCount: policy.beforeBlockCount,
      afterBlockCount: policy.afterBlockCount
    }))
  }
  regions = mergeReadbackRegions(currentOutlineBlocks, regions)

  const indexByBlockId = new Map(currentOutlineBlocks.map((block, index) => [block.blockId, index] as const))
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

const buildCreateTargetTempPaths = async (sourcePath: string): Promise<{
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
  const block = await fetchDetailedBlock(input.runtime, input.docId, input.blockId)
  if (block.layoutMode !== 'positioned') {
    return null
  }
  return input.runtime.emitFailure({
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    reason: 'invalid_input',
    error: buildPositionedReadOnlyMessage(),
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

type SimulatedBodySlot =
  | {
      type: 'existing'
      blockId: string
    }
  | {
      type: 'created'
      opIndex: number
      contentIndex: number
    }

const isStructuralOp = (
  op: DocxOp
): op is Extract<
  DocxOp,
  { type: 'insert_after' | 'insert_before' | 'replace_block' | 'delete_block' | 'update_table_cell' }
> =>
  op.type === 'insert_after' ||
  op.type === 'insert_before' ||
  op.type === 'replace_block' ||
  op.type === 'delete_block' ||
  op.type === 'update_table_cell'

const bodyBlocksOnly = (blocks: readonly DocxOutlineBlock[]): DocxOutlineBlock[] =>
  blocks.filter((block) => block.type !== 'table_cell')

const structuralOpTargetRank = (
  rankByBlockId: ReadonlyMap<string, number>,
  op: Extract<
    DocxOp,
    { type: 'insert_after' | 'insert_before' | 'replace_block' | 'delete_block' | 'update_table_cell' }
  >
): number => {
  const blockId = op.type === 'insert_after' || op.type === 'insert_before' ? op.anchorBlockId : op.blockId
  return rankByBlockId.get(blockId) ?? -1
}

const orderedOpsForWorkerStructuralSegments = (
  ops: readonly DocxOp[],
  rankByBlockId: ReadonlyMap<string, number>
): Array<{ op: DocxOp; opIndex: number }> => {
  const ordered: Array<{ op: DocxOp; opIndex: number }> = []
  let segment: Array<{
    op: Extract<
      DocxOp,
      { type: 'insert_after' | 'insert_before' | 'replace_block' | 'delete_block' | 'update_table_cell' }
    >
    opIndex: number
  }> = []

  const flushStructuralSegment = () => {
    if (segment.length === 0) return
    segment
      .slice()
      .sort((left, right) => {
        const leftRank = structuralOpTargetRank(rankByBlockId, left.op)
        const rightRank = structuralOpTargetRank(rankByBlockId, right.op)
        if (leftRank !== rightRank) return rightRank - leftRank
        return left.opIndex - right.opIndex
      })
      .forEach((entry) => ordered.push(entry))
    segment = []
  }

  ops.forEach((op, opIndex) => {
    if (isStructuralOp(op)) {
      segment.push({ op, opIndex })
      return
    }
    flushStructuralSegment()
    ordered.push({ op, opIndex })
  })
  flushStructuralSegment()
  return ordered
}

const applySequenceChangingOp = (
  slots: SimulatedBodySlot[],
  entry: { op: DocxOp; opIndex: number }
): void => {
  const { op, opIndex } = entry
  if (op.type === 'insert_before' || op.type === 'insert_after') {
    const anchorIndex = slots.findIndex((slot) => slot.type === 'existing' && slot.blockId === op.anchorBlockId)
    if (anchorIndex < 0) return
    const createdSlots: SimulatedBodySlot[] = op.content.map((_, contentIndex) => ({
      type: 'created',
      opIndex,
      contentIndex
    }))
    slots.splice(op.type === 'insert_before' ? anchorIndex : anchorIndex + 1, 0, ...createdSlots)
    return
  }

  if (op.type === 'delete_block') {
    const targetIndex = slots.findIndex((slot) => slot.type === 'existing' && slot.blockId === op.blockId)
    if (targetIndex >= 0) slots.splice(targetIndex, 1)
  }
}

const resolveCreatedBlocksForBatch = async (input: {
  runtime: DocxToolRuntime
  previousDocId: string
  nextDocId: string
  ops: DocxOp[]
  createdBlockOps: boolean[]
}): Promise<DocxCreatedBlock[][]> => {
  const createdBlocksByOp = input.ops.map((): DocxCreatedBlock[] => [])
  if (!input.createdBlockOps.some(Boolean)) return createdBlocksByOp

  const beforeBlocks = await fetchOutlineBlocks(input.runtime, input.previousDocId)
  const afterBlocks = await fetchOutlineBlocks(input.runtime, input.nextDocId)
  const beforeBodyBlocks = bodyBlocksOnly(beforeBlocks)
  const afterBodyBlocks = bodyBlocksOnly(afterBlocks)
  const rankByBlockId = new Map(beforeBodyBlocks.map((block, index) => [block.blockId, index] as const))
  const slots: SimulatedBodySlot[] = beforeBodyBlocks.map((block) => ({
    type: 'existing',
    blockId: block.blockId
  }))

  for (const entry of orderedOpsForWorkerStructuralSegments(input.ops, rankByBlockId)) {
    applySequenceChangingOp(slots, entry)
  }

  const createdBodyBlockIdsByOp = new Map<number, Set<string>>()
  slots.forEach((slot, index) => {
    if (slot.type !== 'created') return
    const afterBlock = afterBodyBlocks[index]
    if (!afterBlock || !input.createdBlockOps[slot.opIndex]) return
    const blockIds = createdBodyBlockIdsByOp.get(slot.opIndex) || new Set<string>()
    blockIds.add(afterBlock.blockId)
    createdBodyBlockIdsByOp.set(slot.opIndex, blockIds)
  })

  for (const [opIndex, bodyBlockIds] of createdBodyBlockIdsByOp) {
    createdBlocksByOp[opIndex] = afterBlocks
      .filter((block) => {
        if (bodyBlockIds.has(block.blockId)) return true
        return block.type === 'table_cell' && bodyBlockIds.has(block.tableBlockId)
      })
      .map((block) => ({
        blockId: block.blockId,
        type: block.type
      }))
  }

  return createdBlocksByOp
}

type BatchReadbackTarget = {
  action: keyof typeof DOCX_POST_WRITE_READBACK_WINDOW_POLICY
  targetBlockIds: string[]
}

type CompiledBatchEdit = {
  ops: DocxOp[]
  readbackTargets: BatchReadbackTarget[]
  createdBlockOps: boolean[]
  summary: string
}

type ApplyBatchEditResult =
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
      createdBlocksByOp: DocxCreatedBlock[][]
    }

type WriteToolResult = {
  sourcePath: string
  previousRevisionRef?: string
  currentRevisionRef: string
  changedBlocks: DocxChangedBlock[]
  createdBlocks?: DocxCreatedBlock[]
  warnings: string[]
  postWriteReadback: DocxPostWriteReadback
}

const actionLabel = (action: DocxEditAction): string => {
  if (action.type === 'insert_blocks') return `${action.type}.${action.position}.${String(action.blocks.length)}`
  if (action.type === 'delete_blocks') return `${action.type}.${String(action.blockIds.length)}`
  return action.type
}

const validateBatchConflicts = (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  structuralTargetKeys: string[]
  deletedBlockIds: string[]
  mutatedBlockIds: string[]
}): DocxToolFailure | null => {
  const seenTargets = new Set<string>()
  for (const key of input.structuralTargetKeys) {
    if (seenTargets.has(key)) {
      return input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        reason: 'invalid_input',
        error: `docx_edit batch has conflicting actions for the same target: ${key}`,
        resourceContext: input.runtime.buildResourceContext({
          sourcePath: input.sourcePath,
          effectKind: 'mutated'
        })
      })
    }
    seenTargets.add(key)
  }

  const deleted = new Set(input.deletedBlockIds)
  const conflictingMutation = input.mutatedBlockIds.find((blockId) => deleted.has(blockId))
  if (conflictingMutation) {
    return input.runtime.emitFailure({
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      reason: 'invalid_input',
      error: `docx_edit batch cannot delete and modify the same block: ${conflictingMutation}`,
      resourceContext: input.runtime.buildResourceContext({
        sourcePath: input.sourcePath,
        effectKind: 'mutated'
      })
    })
  }
  return null
}

const compileBatchEditActions = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  docId: string
  currentRevisionRef: string
  actions: DocxEditAction[]
}): Promise<CompiledBatchEdit | { failure: DocxToolFailure }> => {
  const ops: DocxOp[] = []
  const readbackTargets: BatchReadbackTarget[] = []
  const createdBlockOps: boolean[] = []
  const positionedCheckBlockIds: string[] = []
  const structuralTargetKeys: string[] = []
  const deletedBlockIds: string[] = []
  const mutatedBlockIds: string[] = []

  for (const action of input.actions) {
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

    if (action.type === 'insert_blocks') {
      const resolvedAnchor = resolveCurrentSnapshotBlockIds({
        runtime: input.runtime,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        sourcePath: input.sourcePath,
        field: 'anchorBlockId',
        blockIds: [action.anchorBlockId]
      })
      if (!Array.isArray(resolvedAnchor)) return { failure: resolvedAnchor }
      const anchorBlockId = resolvedAnchor[0]
      positionedCheckBlockIds.push(anchorBlockId)
      structuralTargetKeys.push(`insert:${action.position}:${anchorBlockId}`)
      const op: DocxOp = {
        type: action.position === 'before' ? 'insert_before' : 'insert_after',
        anchorBlockId,
        content: action.blocks.map((block) => blockSpecFromCreateBlock(block))
      }
      ops.push(op)
      createdBlockOps.push(true)
      readbackTargets.push({
        action: op.type,
        targetBlockIds: [anchorBlockId]
      })
      continue
    }

    if (action.type === 'replace_block') {
      const resolvedBlockIds = resolveCurrentSnapshotBlockIds({
        runtime: input.runtime,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        sourcePath: input.sourcePath,
        field: 'blockId',
        blockIds: [action.blockId]
      })
      if (!Array.isArray(resolvedBlockIds)) return { failure: resolvedBlockIds }
      const blockId = resolvedBlockIds[0]
      positionedCheckBlockIds.push(blockId)
      structuralTargetKeys.push(`replace:${blockId}`)
      mutatedBlockIds.push(blockId)
      ops.push({
        type: 'replace_block',
        blockId,
        content: blockSpecFromCreateBlock(action.block)
      })
      createdBlockOps.push(false)
      readbackTargets.push({
        action: 'replace_block',
        targetBlockIds: [blockId]
      })
      continue
    }

    if (action.type === 'replace_text') {
      const blockIds = action.blockIds
        ? resolveCurrentSnapshotBlockIds({
            runtime: input.runtime,
            toolName: input.toolName,
            toolCallId: input.toolCallId,
            sourcePath: input.sourcePath,
            field: 'blockIds',
            blockIds: action.blockIds
          })
        : undefined
      if (blockIds && !Array.isArray(blockIds)) return { failure: blockIds }
      const targetBlockIds = await resolveReplaceTextTargetBlockIds({
        runtime: input.runtime,
        docId: input.docId,
        query: action.query,
        blockIds
      })
      positionedCheckBlockIds.push(...targetBlockIds)
      mutatedBlockIds.push(...targetBlockIds)
      ops.push({
        type: 'replace_text',
        query: action.query,
        replace: action.replace,
        replaceAll: true,
        blockIds
      })
      createdBlockOps.push(false)
      readbackTargets.push({
        action: 'replace_text',
        targetBlockIds
      })
      continue
    }

    if (action.type === 'style_text') {
      const resolvedBlockIds = resolveCurrentSnapshotBlockIds({
        runtime: input.runtime,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        sourcePath: input.sourcePath,
        field: 'blockId',
        blockIds: [action.blockId]
      })
      if (!Array.isArray(resolvedBlockIds)) return { failure: resolvedBlockIds }
      const blockId = resolvedBlockIds[0]
      positionedCheckBlockIds.push(blockId)
      mutatedBlockIds.push(blockId)
      ops.push({
        type: 'style_text',
        blockId,
        query: action.query,
        style: action.style
      })
      createdBlockOps.push(false)
      readbackTargets.push({
        action: 'style_text',
        targetBlockIds: [blockId]
      })
      continue
    }

    if (action.type === 'update_table_cell') {
      const resolvedCellIds = resolveCurrentSnapshotBlockIds({
        runtime: input.runtime,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        sourcePath: input.sourcePath,
        field: 'cellBlockId',
        blockIds: [action.cellBlockId]
      })
      if (!Array.isArray(resolvedCellIds)) return { failure: resolvedCellIds }
      const cellBlockId = resolvedCellIds[0]
      positionedCheckBlockIds.push(cellBlockId)
      structuralTargetKeys.push(`update_table_cell:${cellBlockId}`)
      mutatedBlockIds.push(cellBlockId)
      ops.push({
        type: 'update_table_cell',
        blockId: cellBlockId,
        content: [paragraphSpecFromText(action.text)]
      })
      createdBlockOps.push(false)
      readbackTargets.push({
        action: 'update_table_cell',
        targetBlockIds: [cellBlockId]
      })
      continue
    }

    const resolvedBlockIds = resolveCurrentSnapshotBlockIds({
      runtime: input.runtime,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      sourcePath: input.sourcePath,
      field: 'blockIds',
      blockIds: action.blockIds,
      allowDeleted: false
    })
    if (!Array.isArray(resolvedBlockIds)) return { failure: resolvedBlockIds }
    positionedCheckBlockIds.push(...resolvedBlockIds)
    structuralTargetKeys.push(...resolvedBlockIds.map((blockId) => `delete:${blockId}`))
    deletedBlockIds.push(...resolvedBlockIds)
    ops.push(...resolvedBlockIds.map((blockId) => ({
      type: 'delete_block' as const,
      blockId
    })))
    createdBlockOps.push(...resolvedBlockIds.map(() => false))
    readbackTargets.push({
      action: 'delete_block',
      targetBlockIds: resolvedBlockIds
    })
  }

  const conflict = validateBatchConflicts({
    runtime: input.runtime,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    sourcePath: input.sourcePath,
    structuralTargetKeys,
    deletedBlockIds,
    mutatedBlockIds
  })
  if (conflict) return { failure: conflict }

  const positionedFailure = await failIfAnyPositionedBlocks({
    runtime: input.runtime,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    sourcePath: input.sourcePath,
    currentRevisionRef: input.currentRevisionRef,
    docId: input.docId,
    blockIds: [...new Set(positionedCheckBlockIds)]
  })
  if (positionedFailure) return { failure: positionedFailure }

  return {
    ops,
    readbackTargets,
    createdBlockOps,
    summary: `edit.batch:${input.actions.map(actionLabel).join(',')}`
  }
}

const applyBatchEdit = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentDocId: string
  currentRevisionRef: string
  ops: DocxOp[]
  summary: string
  createdBlockOps: boolean[]
}): Promise<ApplyBatchEditResult> => {
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
        reason: 'failed',
        error: 'worker protocol mismatch (apply_ops)',
        draftDocId: input.currentDocId
      })
    }
  }
  const appliedPayload = workerResponse.payload

  const createdBlocksByOp = await resolveCreatedBlocksForBatch({
    runtime: input.runtime,
    previousDocId: input.currentDocId,
    nextDocId: appliedPayload.newDocId,
    ops: input.ops,
    createdBlockOps: input.createdBlockOps
  })
  const createdBlocks = createdBlocksByOp.flat()
  const reviewOps = await input.runtime.expandOpsForReview(input.currentDocId, input.ops)
  const reviewCreatedBlocksByOp: DocxCreatedBlock[][] = []
  for (const reviewOp of reviewOps) {
    const originalIndex = input.ops.indexOf(reviewOp)
    reviewCreatedBlocksByOp.push(originalIndex >= 0 ? createdBlocksByOp[originalIndex] || [] : [])
  }

  const revisionUpdate = await input.runtime.registerRevision({
    sourcePath: input.sourcePath,
    previousDocId: input.currentDocId,
    nextDocId: appliedPayload.newDocId,
    ops: reviewOps,
    createdBlocks,
    createdBlocksByOp: reviewCreatedBlocksByOp,
    changedBlocks: appliedPayload.changedBlocks,
    summary: input.summary
  })
  input.runtime.input.ctx.trackDocxBatchChanges({
    previousDocId: input.currentDocId,
    nextDocId: appliedPayload.newDocId,
    ops: input.ops,
    changedBlocks: appliedPayload.changedBlocks,
    createdBlocks,
    replaySession: input.runtime.getReplaySession(input.sourcePath)
  })
  return {
    previousRevisionRef: revisionUpdate.previousRevisionRef,
    currentRevisionRef: revisionUpdate.currentRevisionRef,
    changedBlocks: appliedPayload.changedBlocks,
    warnings: appliedPayload.warnings,
    nextDocId: appliedPayload.newDocId,
    createdBlocks,
    createdBlocksByOp
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
    previousRevisionRef: input.previousRevisionRef,
    currentRevisionRef: input.currentRevisionRef,
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
    description: DOCX_EDIT_TOOL_SPEC.description,
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

          const registered = await runtime.registerCreatedDocument({
            sourcePath: requestedSourcePath,
            baselineDocId,
            workingDocId,
            meta: workingOpen.payload.meta,
            stats: workingOpen.payload.stats,
            summary: 'create_document'
          })
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
              sourcePath: result.sourcePath,
              currentRevisionRef: result.currentRevisionRef
            },
            activity: {
              actionType: DOCX_EDIT_TOOL_SPEC.activityActionType!,
              startedSummary: '执行 docx_edit: create_document',
              buildCompletedSummary: () => 'docx_edit 完成: create_document'
            }
          })
        } finally {
          await Promise.all(
            [tempPaths.baselinePath, tempPaths.workingPath, path.dirname(tempPaths.baselinePath)].map(
              async (targetPath) => {
                try {
                  await fs.rm(targetPath, { recursive: true, force: true })
                } catch {
                  return
                }
              }
            )
          )
        }
      }

      const sessionResult = await runtime.ensureReplaySession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const compiled = await compileBatchEditActions({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        docId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        actions: args.actions
      })
      if ('failure' in compiled) {
        return finalizeDocxToolFailure({
          runtime,
          failure: compiled.failure,
          activity: { actionType: DOCX_EDIT_TOOL_SPEC.activityActionType! }
        })
      }

      const applied = await applyBatchEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: compiled.ops,
        summary: compiled.summary,
        createdBlockOps: compiled.createdBlockOps
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
          actionLabel: `批量编辑 ${String(args.actions.length)} 个 action`,
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        readbackTargets: compiled.readbackTargets,
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
          buildCompletedSummary: () => `docx_edit 完成: ${args.actions.map((action) => action.type).join(', ')}`
        }
      })
    }
  })

  const docxRollbackTool = createDocxTool({
    runtime,
    name: DOCX_ROLLBACK_TOOL_SPEC.name,
    description: DOCX_ROLLBACK_TOOL_SPEC.description,
    schema: DOCX_ROLLBACK_TOOL_SPEC.inputSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_ROLLBACK_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: `回退失败: ${message}`
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureReplaySession({
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
            reason: 'invalid_input',
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
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: revisionState.previousRevisionRef,
        currentRevisionRef: revisionState.currentRevisionRef
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
          buildCompletedSummary: () => `已切回修订 ${resolved.targetRevisionRef}`
        }
      })
    }
  })

  return [
    docxEditTool,
    docxRollbackTool
  ]
}
