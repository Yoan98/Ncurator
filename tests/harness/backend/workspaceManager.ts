import { mkdtemp, rm, mkdir, cp, realpath } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export type FixtureCopy = {
  from: string
  to: string
}

export const createIsolatedWorkspace = async (caseId: string): Promise<string> => {
  const safeCaseId = caseId.replace(/[^a-zA-Z0-9-_]/g, '-')
  return await realpath(await mkdtemp(path.join(os.tmpdir(), `ncurator-ai-${safeCaseId}-`)))
}

export const copyFixturesIntoWorkspace = async (
  workspaceRoot: string,
  copies: FixtureCopy[]
): Promise<void> => {
  for (const item of copies) {
    const target = path.join(workspaceRoot, item.to)
    await mkdir(path.dirname(target), { recursive: true })
    await cp(item.from, target)
  }
}

export const cleanupWorkspace = async (workspaceRoot: string): Promise<void> => {
  await rm(workspaceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
}
