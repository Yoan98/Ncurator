import { cp, mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const E2E_WORKSPACE_FIXTURE_ROOT = path.resolve('tests/fixtures/workspace')

const sanitizePathPart = (value: string): string => value.replace(/[^a-zA-Z0-9-_]/g, '-')

export type TemporaryE2EWorkspace = {
  rootPath: string
  cleanup: () => Promise<void>
}

export const copyE2EWorkspaceFixture = async (
  caseId: string,
  scope: 'settings' | 'workbench'
): Promise<TemporaryE2EWorkspace> => {
  const createdRootPath = await mkdtemp(
    path.join(os.tmpdir(), `ncurator-${scope}-${sanitizePathPart(caseId)}-`)
  )
  const rootPath = await realpath(createdRootPath)
  await cp(E2E_WORKSPACE_FIXTURE_ROOT, rootPath, {
    recursive: true,
    force: true,
    filter: (source) => path.basename(source) !== '.DS_Store'
  })

  return {
    rootPath,
    cleanup: async () => {
      await rm(rootPath, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 500
      })
    }
  }
}
