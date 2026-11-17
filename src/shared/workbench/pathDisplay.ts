import type { WorkspaceSource } from '../types'

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

export type WorkspacePathSeparator = ' > ' | '/'

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
  workspaces: WorkspaceSource[]
): string => {
  const parts = getWorkspacePathParts(filePath, workspaces)
  if (!parts.workspaceName) return parts.relativePath || parts.fileName
  if (!parts.relativePath) return parts.workspaceName
  return `${parts.workspaceName.trim()}/${parts.relativePath}`
}

/**
 * 面包屑只展示真实的工作区归属：命中工作区根时带工作区名和区内相对路径；
 * 区外文件从文件系统根开始展示，不借用当前选中工作区的名字。
 */
export const getWorkspacePathLabelParts = (
  filePath: string | undefined,
  workspaces: WorkspaceSource[],
  separator: WorkspacePathSeparator = ' > '
): {
  label: string
  prefix: string
  fileName: string
} => {
  const parts = getWorkspacePathParts(filePath, workspaces)
  const workspaceName = String(parts.workspaceName || '').trim()
  const relativePath = String(parts.relativePath || parts.fileName || '').replace(/\\/g, '/')
  const fileName = parts.fileName || relativePath.split('/').filter(Boolean).pop() || relativePath
  const directoryPath = relativePath.endsWith(fileName)
    ? relativePath.slice(0, Math.max(0, relativePath.length - fileName.length)).replace(/\/+$/g, '')
    : ''
  const prefix = [workspaceName, ...directoryPath.split('/').filter(Boolean)]
    .filter(Boolean)
    .join(separator)
  return {
    label: formatWorkspacePathLabel(filePath, workspaces),
    prefix: prefix ? `${prefix}${separator}` : '',
    fileName
  }
}
