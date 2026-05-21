import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  DocxChangedBlock,
  DocxCreatedBlock,
  DocxDetailedBlock,
  DocxOp,
  DocxOutlineBlock,
  DocxParagraphSpec,
  DocxTableSpec,
  DocxPostWriteReadback,
  DocxTextStyle,
  DocxWriteReadbackAction
} from '../types'
import type { DocxToolRuntime } from '../runtime'
import { DOCX_POST_WRITE_READBACK_WINDOW_POLICY } from '../writeReadbackPolicy'
import {
  DOCX_CREATE_TOOL_SPEC,
  DOCX_DELETE_TOOL_SPEC,
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

const resolveWriteReadbackAction = (input: {
  toolName: string
  action: string
}): DocxWriteReadbackAction => {
  if (input.toolName === 'docx_create') return 'create_document'
  if (input.toolName === 'docx_text_edit') return 'replace_text'
  if (input.toolName === 'docx_text_style_edit') return 'style_text'
  if (input.action === 'delete') return 'delete_block'
  if (input.action === 'update_cell') return 'update_table_cell'
  if (input.action === 'replace_text') return 'replace_block'
  return input.action as DocxWriteReadbackAction
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
  action: DocxWriteReadbackAction
  currentDocId: string
  previousDocId?: string
  targetBlockIds: string[]
}): Promise<DocxPostWriteReadback> => {
  const policy = DOCX_POST_WRITE_READBACK_WINDOW_POLICY[input.action]
  const currentOutlineBlocks = await fetchOutlineBlocks(input.runtime, input.currentDocId)

  let regions: Array<{ startBlockId: string; endBlockId: string }> = []
  if (input.action === 'create_document') {
    if (currentOutlineBlocks.length > 0) {
      const endIndex = Math.min(
        currentOutlineBlocks.length - 1,
        Math.max(0, policy.afterBlockCount)
      )
      const region = toRangeRegion(currentOutlineBlocks, 0, endIndex)
      if (region) regions = [region]
    }
  } else if (input.action === 'delete_block') {
    const previousDocId = input.previousDocId
    if (previousDocId) {
      const previousOutlineBlocks = await fetchOutlineBlocks(input.runtime, previousDocId)
      regions = buildDeletedReadbackRegions({
        previousOutlineBlocks,
        currentOutlineBlocks,
        targetBlockIds: input.targetBlockIds,
        beforeBlockCount: policy.beforeBlockCount,
        afterBlockCount: policy.afterBlockCount
      })
    }
  } else {
    regions = buildCurrentOutlineReadbackRegions({
      outlineBlocks: currentOutlineBlocks,
      targetBlockIds: input.targetBlockIds,
      beforeBlockCount: policy.beforeBlockCount,
      afterBlockCount: policy.afterBlockCount
    })
  }

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
    code: 'invalid_input',
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

const resolveCreatedBlocksForOp = async (input: {
  runtime: DocxToolRuntime
  previousDocId: string
  nextDocId: string
  op: DocxOp
}): Promise<DocxCreatedBlock[]> => {
  if (input.op.type !== 'insert_before' && input.op.type !== 'insert_after') {
    return []
  }
  const op = input.op

  const beforeBlocks = await fetchOutlineBlocks(input.runtime, input.previousDocId)
  const afterBlocks = await fetchOutlineBlocks(input.runtime, input.nextDocId)
  const anchor = beforeBlocks.find((block) => block.blockId === op.anchorBlockId)
  if (!anchor) {
    return []
  }

  const insertedBodyCount = op.content.length
  if (insertedBodyCount <= 0) {
    return []
  }

  const startBlockIndex =
    op.type === 'insert_before' ? anchor.blockIndex : anchor.blockIndex + 1
  const endBlockIndex = startBlockIndex + insertedBodyCount - 1

  return afterBlocks
    .filter(
      (block) =>
        block.blockIndex >= startBlockIndex && block.blockIndex <= endBlockIndex
    )
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

type WriteToolResult = {
  ok: true
  code: 'ok'
  summary: string
  sourcePath: string
  previousRevisionRef?: string
  currentRevisionRef: string
  created?: true
  changedBlocks: DocxChangedBlock[]
  createdBlocks?: DocxCreatedBlock[]
  warnings: string[]
  postWriteReadback: DocxPostWriteReadback
  resourceContext: ReturnType<DocxToolRuntime['buildResourceContext']>
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
    ? await resolveCreatedBlocksForOp({
        runtime: input.runtime,
        previousDocId: input.currentDocId,
        nextDocId: workerResponse.payload.newDocId,
        op: input.ops[0]
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

const buildWriteToolResult = async (input: {
  runtime: DocxToolRuntime
  action: DocxWriteReadbackAction
  sourcePath: string
  previousRevisionRef: string
  currentRevisionRef: string
  nextDocId: string
  summary: string
  created?: true
  changedBlocks: DocxChangedBlock[]
  createdBlocks: DocxCreatedBlock[]
  warnings: string[]
  targetBlockIds: string[]
  previousDocId?: string
}): Promise<WriteToolResult> => {
  const postWriteReadback = await buildPostWriteReadback({
    runtime: input.runtime,
    action: input.action,
    currentDocId: input.nextDocId,
    previousDocId: input.previousDocId,
    targetBlockIds: input.targetBlockIds
  })

  return {
    ok: true,
    code: 'ok',
    summary: input.summary,
    sourcePath: input.sourcePath,
    previousRevisionRef: input.previousRevisionRef,
    currentRevisionRef: input.currentRevisionRef,
    created: input.created,
    changedBlocks: input.changedBlocks,
    createdBlocks: input.createdBlocks,
    warnings: input.warnings,
    postWriteReadback,
    resourceContext: input.runtime.buildResourceContext({
      sourcePath: input.sourcePath,
      effectKind: 'mutated',
      previousRevisionRef: input.previousRevisionRef,
      currentRevisionRef: input.currentRevisionRef
    })
  }
}

export const buildDocxWriteTools = (runtime: DocxToolRuntime): StructuredToolInterface[] => {
  const docxCreateTool = createDocxTool({
    runtime,
    name: DOCX_CREATE_TOOL_SPEC.name,
    description: DOCX_CREATE_TOOL_SPEC.description,
    schema: DOCX_CREATE_TOOL_SPEC.inputSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
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
            code: 'invalid_input',
            error: 'sourcePath must be a workspace-bound .docx path'
          }),
          activity: {
            actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!
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
            code: 'invalid_input',
            error: `docx_create will not overwrite an existing file: ${requestedSourcePath}`,
            resourceContext: runtime.buildResourceContext({
              sourcePath: requestedSourcePath,
              effectKind: 'mutated'
            })
          }),
          activity: {
            actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!
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
          blocks: args.blocks || []
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
              actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!
            }
          })
        }
        if (baselineOpen.payload.action !== 'open') {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              code: 'failed',
              error: 'worker protocol mismatch (baseline open)',
              resourceContext: runtime.buildResourceContext({
                sourcePath: requestedSourcePath,
                effectKind: 'mutated'
              })
            }),
            activity: {
              actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!
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
              actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!
            }
          })
        }
        if (workingOpen.payload.action !== 'open') {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              code: 'failed',
              error: 'worker protocol mismatch (working open)',
              resourceContext: runtime.buildResourceContext({
                sourcePath: requestedSourcePath,
                effectKind: 'mutated'
              })
            }),
            activity: {
              actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!
            }
          })
        }
        const workingDocId = workingOpen.payload.docId

        const registered = await runtime.registerCreatedDocument({
          sourcePath: requestedSourcePath,
          baselineDocId: baselineDocId,
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
          action: 'create_document',
          sourcePath: registered.session.sourcePath,
          previousRevisionRef: registered.previousRevisionRef,
          currentRevisionRef: registered.currentRevisionRef,
          nextDocId: workingDocId,
          summary: buildCreateSummary(registered.session.sourcePath),
          created: true,
          changedBlocks: registered.changedBlocks || [],
          createdBlocks: registered.createdBlocks || [],
          warnings: [],
          targetBlockIds: []
        })

        return finalizeDocxToolSuccess({
          runtime,
          toolName,
          toolCallId,
          result,
          outputPreview: {
            ok: true,
            code: 'ok',
            sourcePath: result.sourcePath,
            currentRevisionRef: result.currentRevisionRef,
            created: true
          },
          activity: {
            actionType: DOCX_CREATE_TOOL_SPEC.activityActionType!,
            startedSummary: `创建 docx: ${args.sourcePath}`,
            buildCompletedSummary: (output: typeof result) => output.summary
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
  })

  const docxParagraphEditTool = createDocxTool({
    runtime,
    name: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.name,
    description: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.description,
    schema: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.inputSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureReplaySession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const failure = await failIfPositionedBlock({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentRevisionRef: sessionResult.currentRevisionRef,
        docId: sessionResult.docId,
        blockId: args.anchorBlockId!
      })
      if (failure) {
        return finalizeDocxToolFailure({
          runtime,
          failure,
          activity: {
            actionType: DOCX_PARAGRAPH_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }
      const op: DocxOp = {
        type: args.action,
        anchorBlockId: args.anchorBlockId!,
        content: args.paragraphs.map((text) => paragraphSpecFromText(text))
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
        createdBlocks: true
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

      const result = await buildWriteToolResult({
        runtime,
        action: resolveWriteReadbackAction({
          toolName,
          action: args.action
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        nextDocId: applied.nextDocId,
        summary: buildEditSummary({
          toolName,
          actionLabel: `段落${args.action}`,
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        targetBlockIds: [args.anchorBlockId!],
        previousDocId: sessionResult.docId
      })
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
          createdBlocks: result.createdBlocks,
          postWriteReadback: result.postWriteReadback
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
    schema: DOCX_HEADING_EDIT_TOOL_SPEC.inputSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_HEADING_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureReplaySession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const failure = await failIfPositionedBlock({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentRevisionRef: sessionResult.currentRevisionRef,
        docId: sessionResult.docId,
        blockId: args.anchorBlockId!
      })
      if (failure) {
        return finalizeDocxToolFailure({
          runtime,
          failure,
          activity: {
            actionType: DOCX_HEADING_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }
      const op: DocxOp = {
        type: args.action,
        anchorBlockId: args.anchorBlockId!,
        content: args.headings.map((heading) => ({
          kind: 'paragraph',
          style: headingStyle(heading.level),
          runs: [{ text: heading.text }]
        }))
      }

      const applied = await applySingleEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: [op],
        summary: `heading.${args.action}.${String(args.headings.length)}_heading(s)`,
        createdBlocks: true
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

      const result = await buildWriteToolResult({
        runtime,
        action: resolveWriteReadbackAction({
          toolName,
          action: args.action
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        nextDocId: applied.nextDocId,
        summary: buildEditSummary({
          toolName,
          actionLabel: `标题${args.action}.${String(args.headings.length)}项`,
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        targetBlockIds: [args.anchorBlockId!],
        previousDocId: sessionResult.docId
      })
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
          createdBlocks: result.createdBlocks,
          postWriteReadback: result.postWriteReadback
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
    schema: DOCX_TABLE_EDIT_TOOL_SPEC.inputSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_TABLE_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureReplaySession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      let op: DocxOp
      if (args.action === 'update_cell') {
        const failure = await failIfPositionedBlock({
          runtime,
          toolName,
          toolCallId,
          sourcePath: sessionResult.sourcePath,
          currentRevisionRef: sessionResult.currentRevisionRef,
          docId: sessionResult.docId,
          blockId: args.cellBlockId!
        })
        if (failure) {
          return finalizeDocxToolFailure({
            runtime,
            failure,
            activity: {
              actionType: DOCX_TABLE_EDIT_TOOL_SPEC.activityActionType!
            }
          })
        }
        op = {
          type: 'update_table_cell',
          blockId: args.cellBlockId!,
          content: [paragraphSpecFromText(args.text!)]
        }
      } else {
        const failure = await failIfPositionedBlock({
          runtime,
          toolName,
          toolCallId,
          sourcePath: sessionResult.sourcePath,
          currentRevisionRef: sessionResult.currentRevisionRef,
          docId: sessionResult.docId,
          blockId: args.anchorBlockId!
        })
        if (failure) {
          return finalizeDocxToolFailure({
            runtime,
            failure,
            activity: {
              actionType: DOCX_TABLE_EDIT_TOOL_SPEC.activityActionType!
            }
          })
        }
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

      const result = await buildWriteToolResult({
        runtime,
        action: resolveWriteReadbackAction({
          toolName,
          action: args.action
        }),
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        nextDocId: applied.nextDocId,
        summary: buildEditSummary({
          toolName,
          actionLabel: `表格${args.action}`,
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        targetBlockIds:
          args.action === 'update_cell'
            ? [args.cellBlockId!]
            : [args.anchorBlockId!],
        previousDocId: sessionResult.docId
      })
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
          createdBlocks: result.createdBlocks,
          postWriteReadback: result.postWriteReadback
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
    schema: DOCX_TEXT_EDIT_TOOL_SPEC.inputSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_TEXT_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureReplaySession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const targetBlockIds = await resolveReplaceTextTargetBlockIds({
        runtime,
        docId: sessionResult.docId,
        query: args.query,
        blockIds: args.blockIds
      })
      const failure = await failIfAnyPositionedBlocks({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentRevisionRef: sessionResult.currentRevisionRef,
        docId: sessionResult.docId,
        blockIds: targetBlockIds
      })
      if (failure) {
        return finalizeDocxToolFailure({
          runtime,
          failure,
          activity: {
            actionType: DOCX_TEXT_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

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

      const result = await buildWriteToolResult({
        runtime,
        action: 'replace_text',
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        nextDocId: applied.nextDocId,
        summary: buildEditSummary({
          toolName,
          actionLabel: '文本替换',
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        targetBlockIds,
        previousDocId: sessionResult.docId
      })
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
          postWriteReadback: result.postWriteReadback
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
    schema: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.inputSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureReplaySession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const failure = await failIfPositionedBlock({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentRevisionRef: sessionResult.currentRevisionRef,
        docId: sessionResult.docId,
        blockId: args.blockId
      })
      if (failure) {
        return finalizeDocxToolFailure({
          runtime,
          failure,
          activity: {
            actionType: DOCX_TEXT_STYLE_EDIT_TOOL_SPEC.activityActionType!
          }
        })
      }

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

      const result = await buildWriteToolResult({
        runtime,
        action: 'style_text',
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        nextDocId: applied.nextDocId,
        summary: buildEditSummary({
          toolName,
          actionLabel: '文本样式编辑',
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        targetBlockIds: [args.blockId],
        previousDocId: sessionResult.docId
      })
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
          postWriteReadback: result.postWriteReadback
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

  const docxDeleteTool = createDocxTool({
    runtime,
    name: DOCX_DELETE_TOOL_SPEC.name,
    description: DOCX_DELETE_TOOL_SPEC.description,
    schema: DOCX_DELETE_TOOL_SPEC.inputSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: DOCX_DELETE_TOOL_SPEC.activityActionType!,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      const sessionResult = await runtime.ensureReplaySession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const failure = await failIfAnyPositionedBlocks({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentRevisionRef: sessionResult.currentRevisionRef,
        docId: sessionResult.docId,
        blockIds: args.blockIds
      })
      if (failure) {
        return finalizeDocxToolFailure({
          runtime,
          failure,
          activity: {
            actionType: DOCX_DELETE_TOOL_SPEC.activityActionType!
          }
        })
      }

      const applied = await applySingleEdit({
        runtime,
        toolName,
        toolCallId,
        sourcePath: sessionResult.sourcePath,
        currentDocId: sessionResult.docId,
        currentRevisionRef: sessionResult.currentRevisionRef,
        ops: args.blockIds.map((blockId) => ({
          type: 'delete_block',
          blockId
        })),
        summary: `delete:${args.blockIds.length}`,
        createdBlocks: false
      })
      if ('failure' in applied) {
        return finalizeDocxToolFailure({
          runtime,
          failure: applied.failure,
          activity: {
            actionType: DOCX_DELETE_TOOL_SPEC.activityActionType!
          }
        })
      }

      const result = await buildWriteToolResult({
        runtime,
        action: 'delete_block',
        sourcePath: sessionResult.sourcePath,
        previousRevisionRef: applied.previousRevisionRef,
        currentRevisionRef: applied.currentRevisionRef,
        nextDocId: applied.nextDocId,
        summary: buildEditSummary({
          toolName,
          actionLabel: '删除 block',
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }),
        changedBlocks: applied.changedBlocks,
        createdBlocks: applied.createdBlocks,
        warnings: applied.warnings,
        targetBlockIds: args.blockIds,
        previousDocId: sessionResult.docId
      })
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
          createdBlocks: result.createdBlocks,
          postWriteReadback: result.postWriteReadback
        },
        draftDocId: applied.nextDocId,
        activity: {
          actionType: DOCX_DELETE_TOOL_SPEC.activityActionType!,
          startedSummary: `执行删除: ${String(args.blockIds.length)} 个 block`,
          buildCompletedSummary: (output) => output.summary
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
    docxCreateTool,
    docxParagraphEditTool,
    docxHeadingEditTool,
    docxTableEditTool,
    docxTextEditTool,
    docxTextStyleEditTool,
    docxDeleteTool,
    docxRollbackTool
  ]
}
