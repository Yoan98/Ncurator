import type { ChatMessage } from '../../../types/store'
import type { SourceScopeSelection } from '../../../../shared/types'
import type { AiRunStartPayload } from '../types'

const toTrimmedStringList = (values: string[] | undefined): string[] =>
  Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : []

export const normalizeWorkspaceBinding = (
  workspace: AiRunStartPayload['workspace']
): AiRunStartPayload['workspace'] | undefined => {
  if (!workspace) return undefined

  const workspaceId = String(workspace.workspaceId || '').trim()
  const rootPath = String(workspace.rootPath || '').trim()
  if (!workspaceId || !rootPath) return undefined

  return {
    workspaceId,
    rootPath,
    policyProfile: workspace.policyProfile ? String(workspace.policyProfile) : undefined
  }
}

export const normalizeSelectedSourceScopes = (
  scopes: SourceScopeSelection[] | undefined
): SourceScopeSelection[] | undefined => {
  if (!Array.isArray(scopes)) return undefined

  const normalized = scopes
    .map((scope) => ({
      ...scope,
      sourceId: String(scope.sourceId || '').trim(),
      nodeId: scope.nodeId ? String(scope.nodeId).trim() : undefined,
      label: String(scope.label || '').trim(),
      absolutePath: scope.absolutePath ? String(scope.absolutePath).trim() : undefined,
      relativePath: scope.relativePath ? String(scope.relativePath).trim() : undefined,
      documentIds: toTrimmedStringList(scope.documentIds),
      workspace: normalizeWorkspaceBinding(scope.workspace)
    }))
    .filter((scope) => scope.sourceId && scope.label)

  return normalized.length > 0 ? normalized : undefined
}

export const collectScopedDocumentIds = (scopes: SourceScopeSelection[] | undefined): string[] => {
  if (!Array.isArray(scopes)) return []
  return Array.from(new Set(scopes.flatMap((scope) => toTrimmedStringList(scope.documentIds))))
}

export const buildEffectiveDocumentIds = (
  explicitDocumentIds: string[] | undefined,
  scopes: SourceScopeSelection[] | undefined
): string[] | undefined => {
  const merged = Array.from(
    new Set([...toTrimmedStringList(explicitDocumentIds), ...collectScopedDocumentIds(scopes)])
  )
  return merged.length > 0 ? merged : undefined
}

export const buildScopeSummary = (scopes: SourceScopeSelection[] | undefined): string => {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return '未选择任何资料范围；仅在需要时使用默认本地资料。'
  }

  return scopes
    .map((scope, index) => {
      const preparedCount = Number(scope.preparedDocumentCount ?? scope.documentIds.length)
      const unpreparedCount = Number(scope.unpreparedFileCount ?? 0)
      const workspaceText = scope.workspace
        ? ` | workspace=${scope.workspace.workspaceId}`
        : ''

      return `${index + 1}. ${scope.scopeType}:${scope.label}${scope.relativePath ? ` (${scope.relativePath})` : ''} | prepared=${preparedCount} | unprepared=${unpreparedCount}${workspaceText}`
    })
    .join('\n')
}

export const buildSelectedScopeSummary = (
  scopes: SourceScopeSelection[] | undefined,
  allowNonLocal: boolean | undefined
): string => `${buildScopeSummary(scopes)}\n允许非本地信息: ${allowNonLocal ? '是' : '否'}`

export const formatTurns = (messages: ChatMessage[]): string =>
  messages
    .map((message) => {
      const role = String(message.role || 'user')
      const content = String(message.content || '')
      return `${role}: ${content}`
    })
    .join('\n')
