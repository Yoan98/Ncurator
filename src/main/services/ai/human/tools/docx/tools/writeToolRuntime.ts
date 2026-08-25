import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { z } from 'zod/v4'
import type {
  DocxChangedNode,
  DocxCommentsRevisionsRequest,
  DocxContentEditRequest,
  DocxCreatedNode,
  DocxCreateRootNode,
  DocxCreateBreakNode,
  DocxCreateParagraphNode,
  DocxCreateRunNode,
  DocxCreateTabNode,
  DocxCreateTableCellNode,
  DocxCreateTableNode,
  DocxCreateTableRowNode,
  DocxCreateTextNode,
  DocxDetailedNode,
  DocxFormatRequest,
  DocxMediaEditRequest,
  DocxOperation,
  DocxOpenStats,
  DocxOutlineNode,
  DocxTableEditRequest
} from '../types'
import type { DocxToolRuntime } from '../runtime'
import { createDocxTool, finalizeDocxToolFailure, finalizeDocxToolSuccess } from './workerTool'
import type { DocxToolFailure } from '../runtime'
import { createDocxFile } from '../utils/createDocxFile'
import { projectDocxReadNode } from '../publicReadTree'
import { isLegacyDocPath, LEGACY_DOC_EDIT_ERROR } from '../legacyDocPolicy'

const fetchOutlineNodes = async (
  runtime: DocxToolRuntime,
  docId: string
): Promise<DocxOutlineNode[]> => {
  const response = await runtime.callWorker({
    action: 'outline',
    payload: {
      docId,
      ranges: [{ fromNodeIndex: 0, toNodeIndex: Number.MAX_SAFE_INTEGER }],
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
  return response.payload.nodes
}

const fetchDetailedNode = async (
  runtime: DocxToolRuntime,
  docId: string,
  nodeId: string
): Promise<DocxDetailedNode> => {
  const response = await runtime.callWorker({
    action: 'get_node',
    payload: {
      docId,
      nodeId
    }
  })
  if (!response.ok) {
    throw new Error(response.error)
  }
  if (response.payload.action !== 'get_node') {
    throw new Error('worker protocol mismatch (get_node)')
  }
  return response.payload.node
}

const summarizePositionedNodeText = (node: DocxDetailedNode): string | undefined => {
  const normalized = node.text.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) return undefined
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized
}

const buildPositionedDiagnostic = (node: DocxDetailedNode): string => {
  const targetText = summarizePositionedNodeText(node)
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

const failIfPositionedNode = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentRevisionRef: string
  docId: string
  nodeId: string
}): Promise<DocxToolFailure | null> => {
  let node: DocxDetailedNode
  try {
    node = await fetchDetailedNode(input.runtime, input.docId, input.nodeId)
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
  if (node.layoutMode !== 'positioned') {
    return null
  }
  const error = buildPositionedDiagnostic(node)
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

const failIfAnyPositionedNodes = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentRevisionRef: string
  docId: string
  nodeIds: string[]
}): Promise<DocxToolFailure | null> => {
  for (const nodeId of input.nodeIds) {
    const failure = await failIfPositionedNode({
      runtime: input.runtime,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      sourcePath: input.sourcePath,
      currentRevisionRef: input.currentRevisionRef,
      docId: input.docId,
      nodeId
    })
    if (failure) {
      return failure
    }
  }
  return null
}

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

const compileParagraphDraft = (input: {
  text: string
  styleId?: string
}): DocxCreateParagraphNode => {
  const runChildren = compileRunChildren(input.text)
  const run: DocxCreateRunNode = {
    type: 'run',
    children: runChildren.length > 0 ? runChildren : [{ type: 'text', text: '' }]
  }
  return {
    type: 'paragraph',
    ...(input.styleId ? { style: { styleName: input.styleId } } : {}),
    children: [run]
  }
}

const compileTableDraft = (rows: string[][]): DocxCreateTableNode => ({
  type: 'table',
  children: rows.map(
    (row): DocxCreateTableRowNode => ({
      type: 'table_row',
      children: row.map(
        (cellText): DocxCreateTableCellNode => ({
          type: 'table_cell',
          children: [compileParagraphDraft({ text: cellText })]
        })
      )
    })
  )
})

type DocxWriteRequest =
  | DocxContentEditRequest
  | DocxFormatRequest
  | DocxTableEditRequest
  | DocxMediaEditRequest
  | DocxCommentsRevisionsRequest

export const compileDocxOperation = (request: DocxWriteRequest): DocxOperation => {
  const { sourcePath, ...operation } = request
  void sourcePath
  return operation
}

type WriteToolResult = {
  changes: Array<
    | { kind: 'created' | 'updated'; node: ReturnType<typeof projectDocxReadNode> }
    | { kind: 'deleted'; nodeId: string }
    | { kind: 'style_created' | 'style_updated' | 'style_deleted'; styleId: string }
    | {
        kind: 'comment_created' | 'comment_updated'
        comment: { commentId: string; text: string; author: string; parentCommentId?: string }
      }
    | { kind: 'comment_deleted'; commentId: string }
    | { kind: 'track_changes_updated'; enabled: boolean }
    | { kind: 'revisions_updated'; action: 'accept' | 'reject'; revisionId?: string }
  >
}

type CompiledEdit = {
  operation: DocxOperation
  summary: string
}

type OperationRecord = {
  op: DocxOperation
  beforeDocId: string
  nextDocId: string
  createdNodes: DocxCreatedNode[]
}

type ApplyEditResult =
  | {
      failure: DocxToolFailure
    }
  | {
      previousRevisionRef: string
      currentRevisionRef: string
      changedNodes: DocxChangedNode[]
      nextDocId: string
      nextStats: DocxOpenStats
      createdNodes: DocxCreatedNode[]
    }

const compileEdit = (operation: DocxOperation): CompiledEdit => ({
  operation,
  summary: `edit:${operation.type}`
})

const positionedNodeIds = (operation: DocxOperation): string[] => {
  const ids: string[] = []
  if ('nodeId' in operation && typeof operation.nodeId === 'string') ids.push(operation.nodeId)
  if ('anchorNodeId' in operation) ids.push(operation.anchorNodeId)
  if ('tableNodeId' in operation) ids.push(operation.tableNodeId)
  if ('rowNodeId' in operation && operation.rowNodeId) ids.push(operation.rowNodeId)
  if ('cellNodeId' in operation) ids.push(operation.cellNodeId)
  return [...new Set(ids)]
}

const resolveCreatedNodes = async (input: {
  runtime: DocxToolRuntime
  previousDocId: string
  nextDocId: string
  operation: DocxOperation
}): Promise<DocxCreatedNode[]> => {
  if (
    input.operation.type !== 'insert_nodes' &&
    input.operation.type !== 'create_table' &&
    input.operation.type !== 'insert_image'
  ) {
    return []
  }
  const beforeNodes = await fetchOutlineNodes(input.runtime, input.previousDocId)
  const afterNodes = await fetchOutlineNodes(input.runtime, input.nextDocId)
  const previousIds = new Set(beforeNodes.map((node) => node.nodeId))
  return afterNodes
    .filter((node) => !previousIds.has(node.nodeId))
    .map((node) => ({ nodeId: node.nodeId, type: node.type }))
}

const expandOperationForReview = async (input: {
  runtime: DocxToolRuntime
  record: OperationRecord
}): Promise<{
  ops: DocxOperation[]
  createdNodesByOperation: DocxCreatedNode[][]
  opNextDocIds: string[]
}> => {
  const ops = await input.runtime.expandOpsForReview(input.record.beforeDocId, [input.record.op])
  return {
    ops,
    createdNodesByOperation: ops.map((_, index) => (index === 0 ? input.record.createdNodes : [])),
    opNextDocIds: ops.map(() => input.record.nextDocId)
  }
}

const applyEdit = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentDocId: string
  currentRevisionRef: string
  compiled: CompiledEdit
}): Promise<ApplyEditResult> => {
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
  const operation = input.compiled.operation
  const positionedFailure = await failIfAnyPositionedNodes({
    runtime: input.runtime,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    sourcePath: input.sourcePath,
    currentRevisionRef: input.currentRevisionRef,
    docId: input.currentDocId,
    nodeIds: positionedNodeIds(operation)
  })
  if (positionedFailure) return { failure: positionedFailure }

  const workerResponse = await input.runtime.callWorker({
    action: 'apply_operation',
    payload: { docId: input.currentDocId, operation }
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
  if (workerResponse.payload.action !== 'apply_operation') {
    return {
      failure: input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        reason: 'failed',
        error: 'worker protocol mismatch (apply_operation)',
        draftDocId: input.currentDocId
      })
    }
  }
  const appliedPayload = workerResponse.payload
  const createdNodes = await resolveCreatedNodes({
    runtime: input.runtime,
    previousDocId: input.currentDocId,
    nextDocId: appliedPayload.newDocId,
    operation
  })
  const record: OperationRecord = {
    op: operation,
    beforeDocId: input.currentDocId,
    nextDocId: appliedPayload.newDocId,
    createdNodes
  }
  const review = await expandOperationForReview({ runtime: input.runtime, record })
  for (const reviewOp of review.ops) {
    await input.runtime.applyTempRevisionToReplaySession({
      session: tempSession,
      revisionRef: 'write-temp',
      op: reviewOp,
      createdNodes,
      nextDocId: appliedPayload.newDocId
    })
  }
  let persistedStats: Awaited<ReturnType<DocxToolRuntime['persistDocId']>>
  try {
    persistedStats = await input.runtime.persistDocId({
      sourcePath: input.sourcePath,
      docId: appliedPayload.newDocId
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
      nextDocId: appliedPayload.newDocId,
      ops: review.ops,
      createdNodes,
      createdNodesByOperation: review.createdNodesByOperation,
      opNextDocIds: review.opNextDocIds,
      changedNodes: appliedPayload.changedNodes,
      persistedStats,
      stats: appliedPayload.stats,
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
  input.runtime.input.ctx.trackDocxChanges({
    previousDocId: input.currentDocId,
    nextDocId: appliedPayload.newDocId,
    op: operation,
    changedNodes: appliedPayload.changedNodes,
    createdNodes,
    replaySession: input.runtime.getReplaySession(input.sourcePath)
  })
  return {
    previousRevisionRef: revisionUpdate.previousRevisionRef,
    currentRevisionRef: revisionUpdate.currentRevisionRef,
    changedNodes: appliedPayload.changedNodes,
    nextDocId: appliedPayload.newDocId,
    nextStats: appliedPayload.stats,
    createdNodes
  }
}

const buildWriteToolResult = async (input: {
  runtime: DocxToolRuntime
  docId: string
  changedNodes: DocxChangedNode[]
  createdNodes: DocxCreatedNode[]
  operation: DocxOperation
}): Promise<WriteToolResult> => {
  const operation = input.operation
  if (
    operation.type === 'create_named_style' ||
    operation.type === 'update_named_style' ||
    operation.type === 'delete_named_style'
  ) {
    const kind =
      operation.type === 'create_named_style'
        ? 'style_created'
        : operation.type === 'update_named_style'
          ? 'style_updated'
          : 'style_deleted'
    return { changes: [{ kind, styleId: operation.styleId }] }
  }
  if (operation.type === 'delete_comment') {
    return { changes: [{ kind: 'comment_deleted', commentId: operation.commentId }] }
  }
  if (operation.type === 'enable_track_changes' || operation.type === 'disable_track_changes') {
    return {
      changes: [
        { kind: 'track_changes_updated', enabled: operation.type === 'enable_track_changes' }
      ]
    }
  }
  if (
    operation.type === 'accept_revision' ||
    operation.type === 'reject_revision' ||
    operation.type === 'accept_all_revisions' ||
    operation.type === 'reject_all_revisions'
  ) {
    const accepting =
      operation.type === 'accept_revision' || operation.type === 'accept_all_revisions'
    return {
      changes: [
        {
          kind: 'revisions_updated',
          action: accepting ? 'accept' : 'reject',
          ...('revisionId' in operation ? { revisionId: operation.revisionId } : {})
        }
      ]
    }
  }
  if (
    operation.type === 'add_comment' ||
    operation.type === 'update_comment' ||
    operation.type === 'reply_comment'
  ) {
    const response = await input.runtime.callWorker({
      action: 'get_annotations',
      payload: { docId: input.docId }
    })
    if (!response.ok) throw new Error(response.error)
    if (response.payload.action !== 'get_annotations') {
      throw new Error('worker protocol mismatch (get_annotations)')
    }
    const comment =
      operation.type === 'add_comment'
        ? [...response.payload.comments]
            .reverse()
            .find((candidate) => candidate.text === operation.comment)
        : operation.type === 'reply_comment'
          ? [...response.payload.comments]
              .reverse()
              .find(
                (candidate) =>
                  candidate.parentCommentId === operation.commentId &&
                  candidate.text === operation.comment
              )
          : response.payload.comments.find(
              (candidate) => candidate.commentId === operation.commentId
            )
    if (!comment) throw new Error('written comment could not be read back')
    return {
      changes: [
        {
          kind:
            operation.type === 'add_comment' || operation.type === 'reply_comment'
              ? 'comment_created'
              : 'comment_updated',
          comment
        }
      ]
    }
  }
  const createdIds = new Set(input.createdNodes.map((node) => node.nodeId))
  const changes: WriteToolResult['changes'] = []
  for (const created of input.createdNodes) {
    const detail = await fetchDetailedNode(input.runtime, input.docId, created.nodeId)
    changes.push({ kind: 'created', node: projectDocxReadNode(detail) })
  }
  for (const changed of input.changedNodes) {
    if (createdIds.has(changed.nodeId)) continue
    if (changed.action === 'delete_node') {
      changes.push({ kind: 'deleted', nodeId: changed.nodeId })
      continue
    }
    const detail = await fetchDetailedNode(input.runtime, input.docId, changed.nodeId)
    changes.push({ kind: 'updated', node: projectDocxReadNode(detail) })
  }
  return {
    changes
  }
}

export const createDocxWriteTool = <TSchema extends z.ZodType<{ sourcePath: string }>>(input: {
  runtime: DocxToolRuntime
  spec: {
    name: string
    promptSpec: { description: string }
    inputSchema: TSchema
    activityActionType: string
  }
  compile: (args: z.infer<TSchema>) => DocxOperation
}): StructuredToolInterface => {
  const runtime = input.runtime
  return createDocxTool({
    runtime,
    name: input.spec.name,
    description: input.spec.promptSpec.description,
    schema: input.spec.inputSchema,
    onError: ({ message }) => {
      runtime.input.emitActivity({
        actionType: input.spec.activityActionType,
        status: 'failed',
        summary: message
      })
    },
    execute: async ({ args, toolName, toolCallId }) => {
      let operation: DocxOperation
      try {
        operation = input.compile(args)
      } catch (error) {
        return finalizeDocxToolFailure({
          runtime,
          failure: runtime.emitFailure({
            toolName,
            toolCallId,
            reason: 'invalid_input',
            error: error instanceof Error ? error.message : String(error)
          }),
          activity: { actionType: input.spec.activityActionType }
        })
      }
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
            actionType: input.spec.activityActionType
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
            actionType: input.spec.activityActionType
          }
        })
      }

      const sourceExists = Boolean(
        runtime.getReadSession(requestedSourcePath) ||
        runtime.getReplaySession(requestedSourcePath) ||
        (await documentExists(requestedSourcePath))
      )
      if (!sourceExists) {
        const canCreate =
          (operation.type === 'insert_nodes' &&
            operation.position === 'document_end' &&
            operation.nodes.every((node) => node.type === 'paragraph')) ||
          (operation.type === 'create_table' && operation.position === 'document_end')
        if (!canCreate) {
          return finalizeDocxToolFailure({
            runtime,
            failure: runtime.emitFailure({
              toolName,
              toolCallId,
              reason: 'invalid_input',
              error: '新建 DOCX 时只能在 document_end 插入段落或创建表格；其他操作需要已有文档内容',
              resourceContext: runtime.buildResourceContext({
                sourcePath: requestedSourcePath,
                effectKind: 'mutated'
              })
            }),
            activity: {
              actionType: input.spec.activityActionType
            }
          })
        }

        const createNodes: DocxCreateRootNode[] =
          operation.type === 'create_table'
            ? [compileTableDraft(operation.rows)]
            : operation.type === 'insert_nodes'
              ? operation.nodes
                  .filter(
                    (node): node is Extract<typeof node, { type: 'paragraph' }> =>
                      node.type === 'paragraph'
                  )
                  .map((node) => compileParagraphDraft({ text: node.text, styleId: node.styleId }))
              : []

        const tempPaths = await buildCreateTargetTempPaths(requestedSourcePath)

        try {
          await createDocxFile({
            filePath: tempPaths.baselinePath,
            nodes: []
          })
          await createDocxFile({
            filePath: tempPaths.workingPath,
            nodes: createNodes
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
                actionType: input.spec.activityActionType
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
                actionType: input.spec.activityActionType
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
                actionType: input.spec.activityActionType
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
                actionType: input.spec.activityActionType
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
              activity: { actionType: input.spec.activityActionType }
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
              summary: operation.type
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
              activity: { actionType: input.spec.activityActionType }
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
            changedNodes: registered.changedNodes || [],
            createdNodes: registered.createdNodes || [],
            replaySession: registered.session
          })

          const result = await buildWriteToolResult({
            runtime,
            docId: workingDocId,
            changedNodes: registered.changedNodes || [],
            createdNodes: registered.createdNodes || [],
            operation
          })

          return finalizeDocxToolSuccess({
            runtime,
            toolName,
            toolCallId,
            result,
            outputPreview: {
              changes: result.changes
            },
            activity: {
              actionType: input.spec.activityActionType,
              startedSummary: '执行 docx_content_edit: insert_nodes',
              buildCompletedSummary: () => 'docx_content_edit 完成: insert_nodes'
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

      const compiled = compileEdit(operation)

      const applied = await applyEdit({
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
          activity: { actionType: input.spec.activityActionType }
        })
      }

      const result = await buildWriteToolResult({
        runtime,
        docId: applied.nextDocId,
        changedNodes: applied.changedNodes,
        createdNodes: applied.createdNodes,
        operation
      })
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        draftDocId: applied.nextDocId,
        activity: {
          actionType: input.spec.activityActionType,
          startedSummary: `执行 ${toolName}: ${operation.type}`,
          buildCompletedSummary: () => `${toolName} 完成`
        }
      })
    }
  })
}
