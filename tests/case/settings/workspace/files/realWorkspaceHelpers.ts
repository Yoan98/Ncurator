import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { WorkspaceTreeListResponse } from '../../../../../src/shared/types'
import { copyE2EWorkspaceFixture } from '../../../../harness/e2e/workspaceFixture'

export type SupportedFileStatus = {
  name: string
  relativePath: string
  status: string
  lastError: string
}

export const copySharedWorkspaceFixture = async (caseId: string): Promise<string> => {
  const workspace = await copyE2EWorkspaceFixture(caseId, 'settings')
  return workspace.rootPath
}

export const createWorkspaceWithFiles = async (
  caseId: string,
  files: Array<{ relativePath: string; content: string }>
): Promise<string> => {
  const workspaceRoot = await mkWorkspaceRoot(caseId)
  for (const file of files) {
    const target = path.join(workspaceRoot, file.relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, file.content, 'utf8')
  }
  return workspaceRoot
}

export const cleanupRealWorkspace = async (workspaceRoot: string): Promise<void> => {
  await rm(workspaceRoot, {
    recursive: true,
    force: true
  })
}

export const toSupportedFileStatuses = (tree: WorkspaceTreeListResponse): SupportedFileStatus[] =>
  tree.items
    .filter((item) => item.kind === 'file' && item.supported_for_index)
    .map((item) => ({
      name: item.name,
      relativePath: item.relative_path,
      status: item.index_status || '',
      lastError: item.last_error || ''
    }))

const mkWorkspaceRoot = async (caseId: string): Promise<string> =>
  await mkdtemp(
    path.join(os.tmpdir(), `ncurator-settings-${caseId.replace(/[^a-zA-Z0-9-_]/g, '-')}-`)
  )
