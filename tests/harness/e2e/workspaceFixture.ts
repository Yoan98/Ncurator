import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerE2EResource } from './resourceScope'

export const E2E_WORKSPACE_FIXTURE_ROOT = path.resolve('tests/fixtures/workspace')

const sanitizePathPart = (value: string): string => value.replace(/[^a-zA-Z0-9-_]/g, '-')

export type TemporaryE2EWorkspace = {
  rootPath: string
}

export const resolveE2ETempRoot = (): string =>
  path.resolve(String(process.env.NCURATOR_E2E_TEMP_ROOT || '').trim() || os.tmpdir())

const WINDOWS_FILE_LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'])

const isFileLockError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code
  return Boolean(code && WINDOWS_FILE_LOCK_CODES.has(code))
}

const removeTemporaryWorkspace = async (rootPath: string): Promise<void> => {
  try {
    await rm(rootPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 500
    })
  } catch (error) {
    if (!isFileLockError(error)) throw error
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2_000)
    })
    try {
      await rm(rootPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 500
      })
    } catch (retryError) {
      if (!isFileLockError(retryError)) throw retryError
    }
  }
}

export const copyE2EWorkspaceFixture = async (
  caseId: string,
  scope: 'settings' | 'workbench'
): Promise<TemporaryE2EWorkspace> => {
  const tempRoot = resolveE2ETempRoot()
  await mkdir(tempRoot, { recursive: true })
  const createdRootPath = await mkdtemp(
    path.join(tempRoot, `ncurator-${scope}-${sanitizePathPart(caseId)}-`)
  )
  const rootPath = await realpath(createdRootPath)
  try {
    await cp(E2E_WORKSPACE_FIXTURE_ROOT, rootPath, {
      recursive: true,
      force: true,
      filter: (source) => path.basename(source) !== '.DS_Store'
    })
  } catch (error) {
    await rm(rootPath, { recursive: true, force: true })
    throw error
  }

  registerE2EResource({
    name: `${scope}-workspace:${rootPath}`,
    phase: 'after-app-close',
    dispose: async () => {
      await removeTemporaryWorkspace(rootPath)
    }
  })

  return { rootPath }
}
