import JSZip from 'jszip'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'vite'
import { mediaBrowserAssets } from '../../../scripts/build/runtime/media-assets.mjs'
import { obfuscateMainJavaScript } from '../../../scripts/build/package/obfuscation.mjs'
import type { AiRunEvent } from '../../../src/shared/types'

const require = createRequire(import.meta.url),
  execute = promisify(execFile)
export type MediaScenarioResult = {
  checks: Record<string, boolean>
  events: AiRunEvent[]
  outputs: string[]
  diagnostics: string[]
}
export const runElectronMediaScenario = async (
  scenario: string,
  directory: string,
  runId: string,
  fixtureDirectory: string
): Promise<MediaScenarioResult> => {
  await fs.mkdir(directory, { recursive: true })
  await fs.cp(fixtureDirectory, directory, { recursive: true })
  await fs.symlink(
    path.resolve('node_modules'),
    path.join(directory, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  const result = path.join(directory, 'result.json')
  await build({
    configFile: false,
    logLevel: 'error',
    plugins: [mediaBrowserAssets()],
    build: {
      ssr: true,
      outDir: path.join(directory, 'out/main'),
      emptyOutDir: false,
      target: 'node22',
      minify: false,
      rollupOptions: {
        input: {
          host: path.resolve('tests/harness/backend/mediaRuntimeHost.ts'),
          drawingCli: path.resolve('src/main/services/media/engine/cli.ts')
        },
        external: (id) => !id.startsWith('.') && !path.isAbsolute(id),
        output: {
          format: 'es',
          entryFileNames: '[name].js',
          paths: (id) =>
            id.startsWith('@node-rs/jieba/') ? pathToFileURL(require.resolve(id)).href : id
        }
      }
    }
  })
  if (scenario === 'drawing-engine-contract') {
    const cli = path.join(directory, 'out/main/drawingCli.js')
    await fs.writeFile(
      cli,
      obfuscateMainJavaScript(await fs.readFile(cli, 'utf8'), 'out/main/drawingCli.js')
    )
  }
  const binding = await execute(process.execPath, [
    'scripts/build/native/better-sqlite3.mjs',
    'path',
    'electron'
  ])
  const environment = {
    ...process.env,
    NCURATOR_BETTER_SQLITE3_NATIVE_BINDING: binding.stdout.trim().split(/\r?\n/u).at(-1),
    NCURATOR_USER_DATA_PATH: path.join(directory, 'user-data')
  }
  delete environment.ELECTRON_RUN_AS_NODE
  const launcher = path.join(directory, 'launcher.cjs')
  await fs.writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ type: 'module', name: 'ncurator-media-test', version: '2.0.2' })
  )
  await fs.writeFile(
    launcher,
    "import('./out/main/host.js').catch(error=>{console.error(error);require('electron').app.exit(1)})"
  )
  await execute(process.execPath, ['scripts/build/native/node-pty.mjs', 'ensure', 'electron'])
  try {
    const hostStarted = Date.now()
    await execute(require('electron') as string, [launcher, scenario, directory, result, runId], {
      env: environment,
      timeout: scenario.includes('live') ? 1200000 : 240000,
      maxBuffer: 8 * 1024 * 1024
    })
    const collected = JSON.parse(await fs.readFile(result, 'utf8')) as MediaScenarioResult
    const elapsed = Date.now() - hostStarted
    collected.diagnostics.push(`Electron lifecycle: ${elapsed}ms`)
    if (!scenario.includes('live')) collected.checks.hostExitedWithoutDeadline = elapsed < 90000
    await fs.writeFile(result, JSON.stringify(collected, null, 2))
    return collected
  } finally {
    await execute(process.execPath, ['scripts/build/native/node-pty.mjs', 'ensure', 'node'])
    const zip = new JSZip()
    const collect = async (folder: string, prefix = ''): Promise<void> => {
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        if (
          ['node_modules', 'out', 'user-data', '.ncurator-test'].includes(entry.name) ||
          entry.isSymbolicLink() ||
          entry.name === 'evidence.zip'
        )
          continue
        const file = path.join(folder, entry.name),
          relative = prefix + entry.name
        if (entry.isDirectory()) await collect(file, relative + '/')
        else if (entry.isFile() && !/\.(sqlite(?:-shm|-wal)?|db|env)$/u.test(entry.name))
          zip.file(relative, await fs.readFile(file))
      }
    }
    await collect(directory)
    const partners = path.join(directory, 'user-data', 'partners')
    for (const partner of await fs.readdir(partners, { withFileTypes: true }).catch(() => [])) {
      if (!partner.isDirectory()) continue
      const assets = path.join(partners, partner.name, 'runtime', 'assets')
      for (const task of await fs.readdir(assets, { withFileTypes: true }).catch(() => []))
        if (task.isDirectory() && /^(drawing|video)-/u.test(task.name))
          await collect(
            path.join(assets, task.name),
            `runtime-assets/${partner.name}/${task.name}/`
          )
    }
    await fs.writeFile(
      path.join(directory, 'evidence.zip'),
      await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    )
  }
}
