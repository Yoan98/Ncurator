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
  DocxInternalMediaOperation,
  DocxOperation,
  DocxOpenStats,
  DocxOutlineNode,
  DocxParagraphStyle,
  DocxReadNode,
  DocxRunStyle,
  DocxTableEditRequest
} from '../types'
import type { DocxToolRuntime } from '../runtime'
import { createDocxTool, finalizeDocxToolFailure, finalizeDocxToolSuccess } from './workerTool'
import type { DocxToolFailure } from '../runtime'
import { createDocxFile } from '../utils/createDocxFile'
import { isLegacyDocPath, LEGACY_DOC_EDIT_ERROR } from '../legacyDocPolicy'

const fetchOutlineNodes = async (
  runtime: DocxToolRuntime,
  docId: string
): Promise<DocxOutlineNode[]> => {
  const response = await runtime.callWorker({
    action: 'outline',
    payload: {
      docId,
      fromNodeIndex: 0,
      toNodeIndex: Number.MAX_SAFE_INTEGER,
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

const verifyDetailedNode = async (
  runtime: DocxToolRuntime,
  docId: string,
  nodeId: string
): Promise<void> => {
  await fetchDetailedNode(runtime, docId, nodeId)
}

const collectVisualIds = (nodes: DocxReadNode[]): string[] => {
  const ids: string[] = []
  const visit = (current: DocxReadNode): void => {
    if (current.type === 'visual') ids.push(current.nodeId)
    if ('children' in current && Array.isArray(current.children)) {
      current.children.forEach(visit)
    }
  }
  nodes.forEach(visit)
  return ids
}

const resolveCreatedVisualIds = async (input: {
  runtime: DocxToolRuntime
  previousDocId: string
  nextDocId: string
  changedNodes: DocxChangedNode[]
  operation: DocxOperation
}): Promise<string[]> => {
  if (
    input.operation.type !== 'insert_image' &&
    !(input.operation.type === 'replace_node' && input.operation.node.type === 'visual')
  )
    return []
  const changedNodeIds = [
    ...new Set(
      input.changedNodes.filter((node) => node.action !== 'delete_node').map((node) => node.nodeId)
    )
  ]
  const createdVisualIds = (
    await Promise.all(
      changedNodeIds.map(async (nodeId) => {
        const before = await fetchDetailedNode(input.runtime, input.previousDocId, nodeId)
        const after = await fetchDetailedNode(input.runtime, input.nextDocId, nodeId)
        const previousIds = new Set(collectVisualIds(before.children))
        return collectVisualIds(after.children).filter((nodeId) => !previousIds.has(nodeId))
      })
    )
  ).flat()
  if (createdVisualIds.length === 0 && input.operation.type === 'insert_image') {
    throw new Error('inserted media could not be read back')
  }
  return [...new Set(createdVisualIds)]
}

const summarizePositionedNodeText = (text: string): string | undefined => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) return undefined
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized
}

const buildPositionedDiagnostic = (text: string): string => {
  const targetText = summarizePositionedNodeText(text)
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
  const response = await input.runtime.callWorker({
    action: 'get_node_layout',
    payload: { docId: input.docId, nodeId: input.nodeId }
  })
  if (!response.ok) {
    return input.runtime.emitFailure({
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      reason: 'invalid_input',
      error: response.error,
      draftDocId: input.docId,
      resourceContext: input.runtime.buildResourceContext({
        sourcePath: input.sourcePath,
        effectKind: 'mutated',
        currentRevisionRef: input.currentRevisionRef
      })
    })
  }
  if (response.payload.action !== 'get_node_layout') {
    return input.runtime.emitFailure({
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      reason: 'failed',
      error: 'worker protocol mismatch (get_node_layout)',
      draftDocId: input.docId
    })
  }
  if (response.payload.layoutMode !== 'positioned') {
    return null
  }
  const error = buildPositionedDiagnostic(response.payload.text)
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
  style?: DocxParagraphStyle
  runStyle?: DocxRunStyle
}): DocxCreateParagraphNode => {
  const runChildren = compileRunChildren(input.text)
  const run: DocxCreateRunNode = {
    type: 'run',
    ...(input.runStyle ? { style: input.runStyle } : {}),
    children: runChildren.length > 0 ? runChildren : [{ type: 'text', text: '' }]
  }
  return {
    type: 'paragraph',
    ...(input.style ? { style: input.style } : {}),
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
  | DocxInternalMediaOperation
  | DocxCommentsRevisionsRequest

export const compileDocxOperations = (request: DocxWriteRequest): DocxOperation[] => {
  const { sourcePath, ...operation } = request
  void sourcePath
  if (operation.type === 'replace_text' && operation.format && operation.newText) {
    const { format, ...replace } = operation
    return [replace, { type: 'format_text', nodeId: replace.nodeId, text: replace.newText, format }]
  }
  if (operation.type === 'insert_nodes' && operation.nodes.some((node) => node.type === 'visual')) {
    if (operation.nodes.some((node) => node.type !== 'visual')) {
      throw new Error(
        'Insert visual and text nodes in separate insert_nodes calls to preserve a clear insertion order'
      )
    }
    return operation.nodes.map((node) => {
      if (node.type !== 'visual' || !node.imagePath)
        throw new Error('Inserting a visual requires imagePath')
      return {
        type: 'insert_image',
        nodeId: operation.nodeId,
        position:
          operation.position === 'inside_start'
            ? 'before'
            : operation.position === 'inside_end'
              ? 'after'
              : operation.position,
        imagePath: node.imagePath,
        widthCm: node.widthCm,
        heightCm: node.heightCm,
        altText: node.altText
      }
    })
  }
  if (operation.type === 'format_text') {
    return operation.targets.map((target) => ({
      type: operation.type,
      nodeId: target.nodeId,
      ...(target.text ? { text: target.text } : {}),
      format: operation.format
    }))
  }
  if (
    operation.type === 'format_paragraph' ||
    operation.type === 'format_table' ||
    operation.type === 'format_row' ||
    operation.type === 'format_cell' ||
    operation.type === 'format_section' ||
    operation.type === 'reset_format' ||
    operation.type === 'apply_named_style' ||
    operation.type === 'set_numbering'
  ) {
    const { nodeIds, ...shared } = operation
    return nodeIds.map((nodeId) => ({ ...shared, nodeId }) as DocxOperation)
  }
  return [operation]
}

type WriteToolResult = {
  createdIds?: string[]
}

type CompiledEdit = {
  operations: DocxOperation[]
  summary: string
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
      result: WriteToolResult
    }

const compileEdit = (operations: DocxOperation[]): CompiledEdit => ({
  operations,
  summary: `edit:${operations[0]?.type || 'unknown'}`
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

const positionedNodeIdsForOperations = (operations: DocxOperation[]): string[] => [
  ...new Set(operations.flatMap(positionedNodeIds))
]

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

const applyEdit = async (input: {
  runtime: DocxToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  currentDocId: string
  currentRevisionRef: string
  compiled: CompiledEdit
}): Promise<ApplyEditResult> => {
  const operations = input.compiled.operations
  const positionedFailure = await failIfAnyPositionedNodes({
    runtime: input.runtime,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    sourcePath: input.sourcePath,
    currentRevisionRef: input.currentRevisionRef,
    docId: input.currentDocId,
    nodeIds: positionedNodeIdsForOperations(operations)
  })
  if (positionedFailure) return { failure: positionedFailure }

  const workerResponse = await input.runtime.callWorker({
    action: 'apply_operations',
    payload: { docId: input.currentDocId, operations }
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
  if (workerResponse.payload.action !== 'apply_operations') {
    return {
      failure: input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        reason: 'failed',
        error: 'worker protocol mismatch (apply_operations)',
        draftDocId: input.currentDocId
      })
    }
  }
  const appliedPayload = workerResponse.payload
  const createdNodes = await resolveCreatedNodes({
    runtime: input.runtime,
    previousDocId: input.currentDocId,
    nextDocId: appliedPayload.newDocId,
    operation: operations[0]!
  })
  let result: WriteToolResult
  try {
    result = await buildWriteToolResult({
      runtime: input.runtime,
      previousDocId: input.currentDocId,
      docId: appliedPayload.newDocId,
      changedNodes: appliedPayload.changedNodes,
      createdNodes,
      operation: operations[0]!
    })
  } catch (error) {
    return {
      failure: input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        reason: 'failed',
        error: `docx post-write readback failed: ${error instanceof Error ? error.message : String(error)}`,
        draftDocId: input.currentDocId,
        resourceContext: input.runtime.buildResourceContext({
          sourcePath: input.sourcePath,
          effectKind: 'mutated',
          currentRevisionRef: input.currentRevisionRef
        })
      })
    }
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
      persistedStats,
      stats: appliedPayload.stats
    })
  } catch (error) {
    input.runtime.state.editSessionBySourcePath.delete(input.sourcePath)
    input.runtime.state.readSessionBySourcePath.delete(input.sourcePath)
    return {
      failure: input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        reason: 'failed',
        error: `The document has been written, but the internal session update failed. Read the file again and report the issue: ${error instanceof Error ? error.message : String(error)}`,
        resourceContext: input.runtime.buildResourceContext({
          sourcePath: input.sourcePath,
          effectKind: 'mutated',
          currentRevisionRef: input.currentRevisionRef
        })
      })
    }
  }
  return {
    previousRevisionRef: revisionUpdate.previousRevisionRef,
    currentRevisionRef: revisionUpdate.currentRevisionRef,
    changedNodes: appliedPayload.changedNodes,
    nextDocId: appliedPayload.newDocId,
    nextStats: appliedPayload.stats,
    createdNodes,
    result
  }
}

const buildWriteToolResult = async (input: {
  runtime: DocxToolRuntime
  previousDocId: string
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
    return {}
  }
  if (operation.type === 'delete_comment') {
    return {}
  }
  if (operation.type === 'enable_track_changes' || operation.type === 'disable_track_changes') {
    return {}
  }
  if (
    operation.type === 'accept_revision' ||
    operation.type === 'reject_revision' ||
    operation.type === 'accept_all_revisions' ||
    operation.type === 'reject_all_revisions'
  ) {
    return {}
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
    return operation.type === 'update_comment' ? {} : { createdIds: [comment.commentId] }
  }
  const createdIds = new Set(input.createdNodes.map((node) => node.nodeId))
  const uniqueCreated = [...new Map(input.createdNodes.map((node) => [node.nodeId, node])).values()]
  const uniqueChanged = [
    ...new Map(input.changedNodes.map((node) => [node.nodeId, node])).values()
  ].filter((node) => !createdIds.has(node.nodeId))
  await Promise.all([
    ...uniqueCreated.map((created) =>
      verifyDetailedNode(input.runtime, input.docId, created.nodeId)
    ),
    ...uniqueChanged
      .filter((changed) => changed.action !== 'delete_node')
      .map((changed) => verifyDetailedNode(input.runtime, input.docId, changed.nodeId))
  ])
  const createdVisualIds = await resolveCreatedVisualIds({
    runtime: input.runtime,
    previousDocId: input.previousDocId,
    nextDocId: input.docId,
    changedNodes: input.changedNodes,
    operation
  })
  const resultCreatedIds = [...uniqueCreated.map((created) => created.nodeId), ...createdVisualIds]
  return resultCreatedIds.length > 0 ? { createdIds: resultCreatedIds } : {}
}

export const createDocxWriteTool = <TSchema extends z.ZodType<{ sourcePath: string }>>(input: {
  runtime: DocxToolRuntime
  spec: {
    name: string
    promptSpec: { description: string }
    inputSchema: TSchema
    activityActionType: string
  }
  compile: (args: z.infer<TSchema>) => DocxOperation[]
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
      let operations: DocxOperation[]
      try {
        operations = input.compile(args)
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
        runtime.getEditSession(requestedSourcePath) ||
        (await documentExists(requestedSourcePath))
      )
      if (!sourceExists) {
        const operation = operations[0]!
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
              error:
                'When creating a DOCX, only paragraphs or tables can be inserted at document_end; other operations require existing document content',
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
                  .map((node) =>
                    compileParagraphDraft({
                      text: node.text,
                      style: node.style,
                      runStyle: node.runStyle
                    })
                  )
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

          let preCommitResult: WriteToolResult
          try {
            const createdOutline = (await fetchOutlineNodes(runtime, workingDocId)).filter(
              (node) => node.story.type === 'body' && node.type !== 'table_cell'
            )
            const expectedCreatedCount =
              operation.type === 'insert_nodes' ? operation.nodes.length : 1
            const createdNodes = createdOutline
              .slice(-expectedCreatedCount)
              .map((node) => ({ nodeId: node.nodeId, type: node.type }))
            preCommitResult = await buildWriteToolResult({
              runtime,
              previousDocId: baselineDocId,
              docId: workingDocId,
              changedNodes: [],
              createdNodes,
              operation
            })
          } catch (error) {
            return finalizeDocxToolFailure({
              runtime,
              failure: runtime.emitFailure({
                toolName,
                toolCallId,
                reason: 'failed',
                error: `docx create readback failed: ${error instanceof Error ? error.message : String(error)}`,
                resourceContext: runtime.buildResourceContext({
                  sourcePath: requestedSourcePath,
                  effectKind: 'mutated'
                })
              }),
              activity: { actionType: input.spec.activityActionType }
            })
          }

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

          try {
            await runtime.registerCreatedDocument({
              sourcePath: requestedSourcePath,
              baselineDocId,
              workingDocId,
              stats: workingOpen.payload.stats,
              persistedStats
            })
          } catch (error) {
            runtime.state.editSessionBySourcePath.delete(requestedSourcePath)
            runtime.state.readSessionBySourcePath.delete(requestedSourcePath)
            return finalizeDocxToolFailure({
              runtime,
              failure: runtime.emitFailure({
                toolName,
                toolCallId,
                reason: 'failed',
                error: `The document has been created, but the internal session update failed. Read the file again and report the issue: ${error instanceof Error ? error.message : String(error)}`,
                resourceContext: runtime.buildResourceContext({
                  sourcePath: requestedSourcePath,
                  effectKind: 'mutated'
                })
              }),
              activity: { actionType: input.spec.activityActionType }
            })
          }

          const result = preCommitResult

          return finalizeDocxToolSuccess({
            runtime,
            toolName,
            toolCallId,
            result,
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

      const sessionResult = await runtime.ensureEditSession({
        toolName,
        toolCallId,
        sourcePath: args.sourcePath
      })
      if ('failure' in sessionResult) return sessionResult.failure

      const compiled = compileEdit(operations)

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

      const result = applied.result
      return finalizeDocxToolSuccess({
        runtime,
        toolName,
        toolCallId,
        result,
        draftDocId: applied.nextDocId,
        activity: {
          actionType: input.spec.activityActionType,
          startedSummary: `执行 ${toolName}: ${operations[0]!.type}`,
          buildCompletedSummary: () => `${toolName} 完成`
        }
      })
    }
  })
}
