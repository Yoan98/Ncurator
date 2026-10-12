import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'vite'
import type { AiRunEvent } from '../../../src/shared/types'

const require = createRequire(import.meta.url)
const execute = promisify(execFile)
export const runElectronDocxRead = async (
  sourcePath: string,
  directory: string,
  runId: string
): Promise<{
  images: Array<{
    kind: string
    extension: string
    byteLength: number
    width: number
    height: number
    nonWhitePixels: number
  }>
  events: AiRunEvent[]
}> => {
  await fs.mkdir(directory, { recursive: true })
  await fs.symlink(
    path.resolve('node_modules'),
    path.join(directory, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  const result = path.join(directory, 'result.json')
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: path.resolve('tests/harness/backend/docxVisualHost.ts'),
      outDir: directory,
      emptyOutDir: false,
      target: 'node22',
      minify: false,
      rollupOptions: {
        external: (id) => !id.startsWith('.') && !path.isAbsolute(id),
        output: {
          entryFileNames: 'host.mjs',
          paths: (id) => (id.startsWith('@node-rs/jieba/') ? require.resolve(id) : id)
        }
      }
    }
  })
  const { stdout } = await execute(process.execPath, [
    'scripts/build/native/better-sqlite3.mjs',
    'path',
    'electron'
  ])
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NCURATOR_BETTER_SQLITE3_NATIVE_BINDING: stdout.trim().split(/\r?\n/).at(-1),
    NCURATOR_USER_DATA_PATH: path.join(directory, 'user-data')
  }
  delete env.ELECTRON_RUN_AS_NODE
  const launcher = path.join(directory, 'launcher.cjs')
  await fs.writeFile(
    launcher,
    "import('./host.mjs').catch((error) => { console.error(error); require('electron').app.exit(1) })"
  )
  await execute(require('electron') as string, [launcher, sourcePath, directory, result, runId], {
    env,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024
  })
  return JSON.parse(await fs.readFile(result, 'utf8'))
}
