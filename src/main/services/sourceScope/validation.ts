import fs from 'fs'
import type { AiRunEvent, SourceScopeSelection } from '../../../shared/types'

type WorkspaceLookup = {
  getWorkspaceById: (id: string) => Promise<{ id: string; root_path: string } | null>
}

type WebSourceLookup = {
  getWebSourceById: (
    id: string
  ) => Promise<{ id: string; import_status: number; document_id?: string } | null>
}

export const validateSelectedScopesForRun = async (params: {
  scopes?: SourceScopeSelection[]
  workspaceStore: WorkspaceLookup
  webSourceStore: WebSourceLookup
  sendEvent: (event: AiRunEvent) => void
  runId: string
  pathExists?: (targetPath: string) => boolean
  now?: () => number
}): Promise<{ ok: true } | { ok: false; error: string }> => {
  const scopes = params.scopes || []
  if (scopes.length === 0) return { ok: true }

  const pathExists = params.pathExists || fs.existsSync
  const getNow = params.now || Date.now

  for (const scope of scopes) {
    if (scope.sourceType === 'workspace') {
      const workspaceId = String(scope.workspace?.workspaceId || scope.sourceId || '').trim()
      if (!workspaceId) {
        params.sendEvent({
          type: 'runtime_issue',
          runId: params.runId,
          code: 'workspace_binding_missing',
          message: '当前范围缺少可用的工作空间上下文，请重新选择本地范围。',
          scopeSourceId: scope.sourceId,
          createdAt: getNow()
        })
        return { ok: false, error: 'workspace binding missing' }
      }

      const workspace = await params.workspaceStore.getWorkspaceById(workspaceId)
      if (!workspace) {
        params.sendEvent({
          type: 'runtime_issue',
          runId: params.runId,
          code: 'workspace_missing',
          message: '所选工作空间已不存在，请重新选择或重新配置工作空间。',
          workspaceId,
          scopeSourceId: scope.sourceId,
          createdAt: getNow()
        })
        return { ok: false, error: 'workspace missing' }
      }

      if (!pathExists(workspace.root_path)) {
        params.sendEvent({
          type: 'runtime_issue',
          runId: params.runId,
          code: 'workspace_path_unavailable',
          message: `工作空间路径不可用：${workspace.root_path}`,
          workspaceId,
          scopeSourceId: scope.sourceId,
          createdAt: getNow()
        })
        return { ok: false, error: 'workspace path unavailable' }
      }

      if (scope.absolutePath && !pathExists(scope.absolutePath)) {
        params.sendEvent({
          type: 'runtime_issue',
          runId: params.runId,
          code: 'scope_unavailable',
          message: `所选范围已失效：${scope.absolutePath}`,
          workspaceId,
          scopeSourceId: scope.sourceId,
          createdAt: getNow()
        })
        return { ok: false, error: 'scope unavailable' }
      }
    }

    if (scope.sourceType === 'web') {
      const source = await params.webSourceStore.getWebSourceById(scope.sourceId)
      if (!source || source.import_status !== 2 || !source.document_id) {
        params.sendEvent({
          type: 'runtime_issue',
          runId: params.runId,
          code: 'scope_unavailable',
          message: '所选网页资料当前不可用，请刷新或重新选择。',
          scopeSourceId: scope.sourceId,
          createdAt: getNow()
        })
        return { ok: false, error: 'scope unavailable' }
      }
    }
  }

  return { ok: true }
}
