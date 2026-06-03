import fs from 'fs'
import path from 'path'
import type { AiRunEvent, SelectedReference } from '../../../shared/types'

type WorkspaceLookup = {
  getWorkspaceById: (id: string) => Promise<{ id: string; root_path?: string } | null>
}

type WebSourceLookup = {
  getWebSourceById: (
    id: string,
    workspaceId?: string
  ) => Promise<{ id: string; workspace_id: string; index_status: string; document_id?: string } | null>
}

const isPathWithinWorkspace = (workspaceRootPath: string, targetPath: string): boolean => {
  const resolvedWorkspaceRoot = path.resolve(workspaceRootPath)
  const resolvedTargetPath = path.resolve(targetPath)
  if (resolvedWorkspaceRoot === resolvedTargetPath) return true

  const relativePath = path.relative(resolvedWorkspaceRoot, resolvedTargetPath)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

export const validateSelectedReferencesForRun = async (params: {
  references?: SelectedReference[]
  workspaceStore: WorkspaceLookup
  webSourceStore: WebSourceLookup
  sendEvent: (event: AiRunEvent) => void
  runId: string
  pathExists?: (targetPath: string) => boolean
  now?: () => number
}): Promise<{ ok: true } | { ok: false; error: string }> => {
  const references = params.references || []
  if (references.length === 0) return { ok: true }

  const pathExists = params.pathExists || fs.existsSync
  const getNow = params.now || Date.now

  for (const reference of references) {
    if (reference.kind !== 'web') {
      const workspaceId = String(reference.workspaceId || '').trim()
      if (!workspaceId) {
        params.sendEvent({
          type: 'runtime_issue',
          runId: params.runId,
          code: 'workspace_binding_missing',
          message: '当前参考资料缺少可用的工作空间上下文，请重新选择本地目录或文件。',
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
          createdAt: getNow()
        })
        return { ok: false, error: 'workspace missing' }
      }

      if (!workspace.root_path) {
        params.sendEvent({
          type: 'runtime_issue',
          runId: params.runId,
          code: 'workspace_path_unavailable',
          message: '当前工作空间尚未设置工作文件地址。',
          workspaceId,
          createdAt: getNow()
        })
        return { ok: false, error: 'workspace path unavailable' }
      }

      if (!pathExists(workspace.root_path)) {
        params.sendEvent({
          type: 'runtime_issue',
          runId: params.runId,
          code: 'workspace_path_unavailable',
          message: `工作空间路径不可用：${workspace.root_path}`,
          workspaceId,
          createdAt: getNow()
        })
        return { ok: false, error: 'workspace path unavailable' }
      }

      if (!pathExists(reference.absolutePath)) {
        params.sendEvent({
          type: 'runtime_issue',
          runId: params.runId,
          code: 'scope_unavailable',
          message: `所选参考资料已失效：${reference.absolutePath}`,
          workspaceId,
          createdAt: getNow()
        })
        return { ok: false, error: 'scope unavailable' }
      }

      if (!isPathWithinWorkspace(workspace.root_path, reference.absolutePath)) {
        params.sendEvent({
          type: 'runtime_issue',
          runId: params.runId,
          code: 'scope_unavailable',
          message: `所选参考资料不属于当前工作空间：${reference.absolutePath}`,
          workspaceId,
          createdAt: getNow()
        })
        return { ok: false, error: 'scope unavailable' }
      }

      continue
    }

    const workspaceId = String(reference.workspaceId || '').trim()
    if (!workspaceId) {
      params.sendEvent({
        type: 'runtime_issue',
        runId: params.runId,
        code: 'workspace_binding_missing',
        message: '当前网页资料缺少可用的工作空间上下文，请重新选择。',
        createdAt: getNow()
      })
      return { ok: false, error: 'workspace binding missing' }
    }

    const source = await params.webSourceStore.getWebSourceById(reference.webSourceId, workspaceId)
    if (
      !source ||
      source.workspace_id !== workspaceId ||
      source.index_status !== 'indexed' ||
      !source.document_id
    ) {
      params.sendEvent({
        type: 'runtime_issue',
        runId: params.runId,
        code: 'scope_unavailable',
        message: '所选网页资料当前不可用，请刷新或重新选择。',
        scopeSourceId: reference.webSourceId,
        createdAt: getNow()
      })
      return { ok: false, error: 'scope unavailable' }
    }
  }

  return { ok: true }
}
