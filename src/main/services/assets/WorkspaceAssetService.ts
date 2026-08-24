import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const WORKSPACE_NCURATOR_DIR = '.ncurator'
const WORKSPACE_RUNTIME_DIR = 'runtime'
const WORKSPACE_ASSETS_DIR = 'assets'
const WORKSPACE_SCRIPTS_DIR = 'scripts'
const WORKSPACE_TOOL_RESULT_DIR = 'toolresult'

const normalizeWorkspaceRoot = (workspaceRootPath: string): string => {
  const value = String(workspaceRootPath || '').trim()
  if (!value) throw new Error('缺少工作区根目录')
  return path.resolve(value)
}

export const getWorkspaceRuntimeDir = (workspaceRootPath: string): string =>
  path.join(
    normalizeWorkspaceRoot(workspaceRootPath),
    WORKSPACE_NCURATOR_DIR,
    WORKSPACE_RUNTIME_DIR
  )

export const getWorkspaceAssetsRootDir = (workspaceRootPath: string): string =>
  path.join(getWorkspaceRuntimeDir(workspaceRootPath), WORKSPACE_ASSETS_DIR)

export const getWorkspaceScriptsRootDir = (workspaceRootPath: string): string =>
  path.join(getWorkspaceRuntimeDir(workspaceRootPath), WORKSPACE_SCRIPTS_DIR)

export const getWorkspaceToolResultDir = (workspaceRootPath: string): string =>
  path.join(getWorkspaceRuntimeDir(workspaceRootPath), WORKSPACE_TOOL_RESULT_DIR)

export const getWorkspaceAssetBucketDir = (
  workspaceRootPath: string,
  assetBucketId: string
): string => {
  const normalizedBucketId = String(assetBucketId || '').trim()
  if (!normalizedBucketId || path.basename(normalizedBucketId) !== normalizedBucketId) {
    throw new Error('assetBucketId 无效')
  }
  return path.join(getWorkspaceAssetsRootDir(workspaceRootPath), normalizedBucketId)
}

export const ensureWorkspaceRuntimeDirs = async (workspaceRootPath: string): Promise<void> => {
  const runtimeDir = getWorkspaceRuntimeDir(workspaceRootPath)
  await Promise.all([
    fs.mkdir(path.join(runtimeDir, WORKSPACE_ASSETS_DIR), { recursive: true }),
    fs.mkdir(getWorkspaceScriptsRootDir(workspaceRootPath), { recursive: true }),
    fs.mkdir(getWorkspaceToolResultDir(workspaceRootPath), { recursive: true })
  ])
}

export const ensureWorkspaceAssetBucket = async (
  workspaceRootPath: string,
  assetBucketId: string
): Promise<string> => {
  await ensureWorkspaceRuntimeDirs(workspaceRootPath)
  const directoryPath = getWorkspaceAssetBucketDir(workspaceRootPath, assetBucketId)
  await fs.mkdir(directoryPath, { recursive: true })
  return directoryPath
}

export const createWorkspaceAssetBucket = async (
  workspaceRootPath: string
): Promise<{ assetBucketId: string; directoryPath: string }> => {
  const assetBucketId = randomUUID()
  return {
    assetBucketId,
    directoryPath: await ensureWorkspaceAssetBucket(workspaceRootPath, assetBucketId)
  }
}
