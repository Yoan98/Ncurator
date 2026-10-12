import { validateDocumentSelection } from './documentSelection'
import path from 'node:path'
import type { ChatMessageContentNode, ChatSubmitRequest } from '../../../shared/types'
import { chatContentText, chatReferences, hasUserText } from '../../../shared/chatContent'
import { buildDirectoryReferenceFromRecords } from './referenceList'
import { buildWebReferenceItem } from './selection'
import type { WorkspaceStore } from '../storage/domains/WorkspaceStore'
import type { WebSourceStore } from '../storage/domains/WebSourceStore'
import type { DocumentsStore } from '../storage/domains/DocumentsStore'
import { normalizeSelectedReferences } from '../ai/utils/runContext'

export const resolveUserContent = async (
  request: ChatSubmitRequest,
  deps: {
    documents: Pick<DocumentsStore, 'getDocumentByFilePath'>
    workspace: Pick<WorkspaceStore, 'getWorkspaceById' | 'listWorkspaceFileIndexRecords'>
    webSources: Pick<WebSourceStore, 'getWebSourceById'>
  }
) => {
  if (!Array.isArray(request.contentNodes)) {
    throw new Error('请输入你的想法后再发送')
  }
  const contentNodes = structuredClone(request.contentNodes)
  const knowledgeByPath = new Map<
    string,
    Promise<
      NonNullable<Extract<ChatMessageContentNode, { kind: 'document_selection' }>['knowledge']>
    >
  >()
  const knowledge = (filePath: string) => {
    let pending = knowledgeByPath.get(filePath)
    if (!pending) {
      pending = deps.documents.getDocumentByFilePath(filePath).then((document) => ({
        kbAvailability:
          document?.import_status === 1 ? ('indexed' as const) : ('not_indexed' as const),
        kbDocumentIds: document?.import_status === 1 ? [document.id] : []
      }))
      knowledgeByPath.set(filePath, pending)
    }
    return pending
  }
  const resolve = async (nodes: ChatMessageContentNode[]): Promise<void> => {
    for (const node of nodes) {
      if (node.kind === 'text') {
        if (typeof node.text !== 'string') throw new Error('正文文字无效')
      } else if (node.kind === 'reference') {
        const normalized = normalizeSelectedReferences([node.reference])?.[0]
        if (!normalized) throw new Error('引用已失效，请重新选择')
        node.reference = normalized
        if (normalized.kind === 'file')
          Object.assign(normalized, await knowledge(normalized.absolutePath))
        else if (normalized.kind === 'web') {
          const source = await deps.webSources.getWebSourceById(normalized.webSourceId)
          if (!source) throw new Error('引用已失效，请重新选择')
          const current = buildWebReferenceItem(source)
          normalized.kbAvailability = current.kbAvailability
          normalized.kbDocumentIds = current.kbDocumentIds
        } else {
          const workspace = await deps.workspace.getWorkspaceById(normalized.workspaceId)
          if (!workspace) throw new Error('引用已失效，请重新选择')
          const current = buildDirectoryReferenceFromRecords({
            workspace,
            name: normalized.name,
            relativePath: normalized.relativePath,
            absolutePath: normalized.absolutePath,
            records: await deps.workspace.listWorkspaceFileIndexRecords(workspace.id)
          })
          normalized.kbAvailability = current.kbAvailability
          normalized.kbDocumentIds = current.kbDocumentIds
          normalized.indexedFileCount = current.indexedFileCount
          normalized.notIndexedFileCount = current.notIndexedFileCount
        }
      } else if (node.kind === 'document_selection') {
        validateDocumentSelection(node)
        node.contextBefore = Array.from(node.contextBefore).slice(-150).join('')
        node.contextAfter = Array.from(node.contextAfter).slice(0, 150).join('')
        node.filePath = path.normalize(node.filePath)
        node.knowledge = await knowledge(node.filePath)
        await resolve(node.children)
      } else throw new Error('正文节点无效')
    }
  }
  await resolve(contentNodes)
  if (!hasUserText(contentNodes)) throw new Error('请输入你的想法后再发送')
  return {
    ...request,
    contentNodes,
    input: chatContentText(contentNodes).trim(),
    selectedReferences: chatReferences(contentNodes)
  }
}
