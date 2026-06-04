import { mkdir, writeFile, cp, rm, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'
import type { WorkspaceIndexJobRecord, WorkspaceTreeListResponse } from '../../../../src/shared/types'
import { importSelectors } from '../../../../src/renderer/src/testing/selectors'
import {
  createRealWorkspaceWithRoot,
  getSettingsLocator,
  navigateToSettingsSection,
  readWorkspaceTree,
  waitForFileIndexJobIdle
} from '../../../harness/e2e/settings'

export type RealWorkspacePrepareResult = {
  workspaceId: string
  workspaceRoot: string
  beforeTree: WorkspaceTreeListResponse
  runningJob?: WorkspaceIndexJobRecord
  lastRunningJob?: WorkspaceIndexJobRecord
  finalTree: WorkspaceTreeListResponse
}

export type SupportedFileStatus = {
  name: string
  relativePath: string
  status: string
  lastError: string
}

export const copySharedWorkspaceFixture = async (caseId: string): Promise<string> => {
  const workspaceRoot = await mkWorkspaceRoot(caseId)
  await cp(path.resolve('tests/fixtures/workspace'), workspaceRoot, {
    recursive: true,
    force: true,
    filter: (source) => path.basename(source) !== '.DS_Store'
  })
  return workspaceRoot
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

export const createWorkspaceWithFixtureFiles = async (
  caseId: string,
  files: Array<{ sourcePath: string; relativePath: string }>
): Promise<string> => {
  const workspaceRoot = await mkWorkspaceRoot(caseId)
  for (const file of files) {
    const target = path.join(workspaceRoot, file.relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await cp(path.resolve(file.sourcePath), target)
  }
  return workspaceRoot
}

export const cleanupRealWorkspace = async (workspaceRoot: string): Promise<void> => {
  await rm(workspaceRoot, {
    recursive: true,
    force: true
  })
}

export const triggerRealWorkspacePrepare = async (
  page: Page,
  input: { workspaceRoot: string; workspaceName: string }
): Promise<RealWorkspacePrepareResult> => {
  const workspace = await createRealWorkspaceWithRoot(page, {
    name: input.workspaceName,
    rootPath: input.workspaceRoot
  })
  const workspaceId = workspace.workspace!.id
  await navigateToSettingsSection(page, 'workspace')
  await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).waitFor({
    state: 'visible'
  })
  const beforeTree = await readWorkspaceTree(page, workspaceId)
  await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
  const prepareResponse = await page.evaluate(async (selectedWorkspaceId) => {
    return await window.api.workspaceIndexJobGet({
      workspaceId: selectedWorkspaceId,
      sourceKind: 'file'
    })
  }, workspaceId)
  if (!prepareResponse.success) {
    throw new Error(prepareResponse.error || 'failed to read workspace prepare job')
  }
  const { lastRunningJob, tree } = await waitForFileIndexJobIdle(page, workspaceId)
  return {
    workspaceId,
    workspaceRoot: input.workspaceRoot,
    beforeTree,
    runningJob: prepareResponse.job || lastRunningJob,
    lastRunningJob,
    finalTree: tree
  }
}

export const toSupportedFileStatuses = (
  tree: WorkspaceTreeListResponse
): SupportedFileStatus[] =>
  tree.items
    .filter((item) => item.kind === 'file' && item.supported_for_index)
    .map((item) => ({
      name: item.name,
      relativePath: item.relative_path,
      status: item.index_status || '',
      lastError: item.last_error || ''
    }))

const mkWorkspaceRoot = async (caseId: string): Promise<string> =>
  await mkdtemp(path.join(os.tmpdir(), `ncurator-settings-${caseId.replace(/[^a-zA-Z0-9-_]/g, '-')}-`))
