import { mkdir, rm, rmdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export const prepareReleaseWorkspace = async ({ releaseTag, defaultRootName, keepWork }) => {
  const defaultBaseDirectory =
    process.platform === 'win32'
      ? path.join(os.homedir(), '.ncurator', 'release-work')
      : os.tmpdir()
  const configuredRoot = String(process.env.NCURATOR_RELEASE_WORK_ROOT || '').trim()
  const workRoot = path.resolve(configuredRoot || path.join(defaultBaseDirectory, defaultRootName))
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
      if (!configuredRoot) {
        await rmdir(workRoot).catch((error) => {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error
        })
        if (process.platform === 'win32') {
          await rmdir(defaultBaseDirectory).catch((error) => {
            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error
          })
        }
      }
    }
  }
}
