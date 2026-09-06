import type { WorkspaceSource } from '../../../../shared/types'

const normalizePath = (value: string): string =>
  String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '')

const getBaseName = (filePath: string): string => {
  const normalized = normalizePath(filePath)
  return normalized.split('/').filter(Boolean).pop() || normalized
}

export const getWorkspacePathParts = (
  filePath: string | undefined,
  workspaces: WorkspaceSource[]
): {
  workspaceName?: string
  relativePath: string
  fileName: string
} => {
  if (!filePath) {
    return {
      relativePath: '',
      fileName: ''
    }
  }

  const normalizedFilePath = normalizePath(filePath)
  const fileName = getBaseName(normalizedFilePath)
  const matchingWorkspace = workspaces
    .filter((workspace) => workspace.root_path)
    .map((workspace) => ({
      workspace,
      rootPath: normalizePath(workspace.root_path || '')
    }))
    .filter(({ rootPath }) => {
      const root = trimSlashes(rootPath)
      const target = trimSlashes(normalizedFilePath)
      return target === root || target.startsWith(`${root}/`)
    })
    .sort((left, right) => right.rootPath.length - left.rootPath.length)[0]

  if (matchingWorkspace) {
    const root = trimSlashes(matchingWorkspace.rootPath)
    const target = trimSlashes(normalizedFilePath)
    const relativePath = trimSlashes(target.slice(root.length))
    return {
      workspaceName: getBaseName(matchingWorkspace.rootPath),
      relativePath: relativePath || fileName,
      fileName
    }
  }

  return {
    relativePath: normalizedFilePath,
    fileName
  }
}

export const formatWorkspacePathLabel = (
  filePath: string | undefined,
  workspaces: WorkspaceSource[],
  fallbackWorkspaceName?: string | null
): string => {
  const parts = getWorkspacePathParts(filePath, workspaces)
  const workspaceName = parts.workspaceName || fallbackWorkspaceName || ''
  if (!workspaceName) return parts.relativePath || parts.fileName
  if (!parts.relativePath) return workspaceName
  return `${String(workspaceName).trim()}/${parts.relativePath}`
}
