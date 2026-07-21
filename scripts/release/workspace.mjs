import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export const prepareReleaseWorkspace = async ({ releaseTag, defaultRootName, keepWork }) => {
  const workRoot = path.resolve(
    String(process.env.NCURATOR_RELEASE_WORK_ROOT || '').trim() ||
      path.join(os.tmpdir(), defaultRootName)
  )
  const workDirectory = path.join(workRoot, releaseTag)
  await rm(workDirectory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500
  })
  await mkdir(workDirectory, { recursive: true })

  return {
    workDirectory,
    dispose: async () => {
      if (keepWork) {
        process.stdout.write(`[release] kept work directory ${workDirectory}\n`)
        return
      }
      await rm(workDirectory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 500
      })
    }
  }
}
