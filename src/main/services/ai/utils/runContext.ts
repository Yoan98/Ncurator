import type { KbAvailability, SelectedReference } from '../../../../shared/types'
import type { AiRunStartPayload } from '../types'

const toTrimmedStringList = (values: string[] | undefined): string[] =>
  Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : []

const normalizeKbAvailability = (value: string | undefined): KbAvailability =>
  value === 'indexed' || value === 'partial' || value === 'not_indexed' ? value : 'not_indexed'

export const normalizeWorkspaceBinding = (
  workspace: AiRunStartPayload['workspace']
): AiRunStartPayload['workspace'] | undefined => {
  if (!workspace) return undefined

  const workspaceId = String(workspace.workspaceId || '').trim()
  const workspaceName = String(workspace.workspaceName || '').trim()
  const rootPath = String(workspace.rootPath || '').trim()
  if (!workspaceId || !workspaceName || !rootPath) return undefined

  return {
    workspaceId,
    workspaceName,
    rootPath,
    policyProfile: workspace.policyProfile ? String(workspace.policyProfile) : undefined
  }
}

export const normalizeSelectedReferences = (
  references: SelectedReference[] | undefined
): SelectedReference[] | undefined => {
  if (!Array.isArray(references)) return undefined

  const normalized = references
    .map((reference) => {
      if (reference.kind === 'web') {
        return {
          kind: 'web' as const,
          workspaceId: String(reference.workspaceId || '').trim(),
          webSourceId: String(reference.webSourceId || '').trim(),
          name: String(reference.name || '').trim(),
          url: String(reference.url || '').trim(),
          kbDocumentIds: toTrimmedStringList(reference.kbDocumentIds),
          kbAvailability: normalizeKbAvailability(reference.kbAvailability)
        }
      }

      if (reference.kind === 'directory') {
        return {
          kind: 'directory' as const,
          workspaceId: String(reference.workspaceId || '').trim(),
          nodeId: String(reference.nodeId || '').trim(),
          name: String(reference.name || '').trim(),
          relativePath: String(reference.relativePath || '').trim(),
          absolutePath: String(reference.absolutePath || '').trim(),
          kbDocumentIds: toTrimmedStringList(reference.kbDocumentIds),
          kbAvailability: normalizeKbAvailability(reference.kbAvailability),
          indexedFileCount: Math.max(0, Number(reference.indexedFileCount || 0)),
          notIndexedFileCount: Math.max(0, Number(reference.notIndexedFileCount || 0))
        }
      }

      return {
        kind: 'file' as const,
        workspaceId: String(reference.workspaceId || '').trim(),
        nodeId: String(reference.nodeId || '').trim(),
        name: String(reference.name || '').trim(),
        relativePath: String(reference.relativePath || '').trim(),
        absolutePath: String(reference.absolutePath || '').trim(),
        fileExt: reference.fileExt ? String(reference.fileExt).trim() : undefined,
        kbDocumentIds: toTrimmedStringList(reference.kbDocumentIds),
        kbAvailability: normalizeKbAvailability(reference.kbAvailability)
      }
    })
    .filter((reference) => {
      if (reference.kind === 'web') {
        return Boolean(
          reference.workspaceId && reference.webSourceId && reference.name && reference.url
        )
      }

      return Boolean(
        reference.workspaceId &&
        reference.nodeId &&
        reference.name &&
        reference.relativePath &&
        reference.absolutePath
      )
    })

  return normalized.length > 0 ? normalized : undefined
}
