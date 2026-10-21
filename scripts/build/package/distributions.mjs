import { createDistributionConfig } from './distribution-config.mjs'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import {
  DISTRIBUTIONS,
  distributionName,
  hashSharedApp
} from '../../release/shared/distribution.mjs'
import { verifySidecarStartup } from '../sidecar/verify.mjs'

const platform = process.argv[2]
if (!['win', 'mac'].includes(platform))
  throw new Error('usage: distributions.mjs win|mac [--signed]')
const signed = process.argv.includes('--signed')
const root = process.cwd()
const base = parse(readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'))
const sharedAppHash = hashSharedApp(path.join(root, 'release-stage', 'app'))
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32' && /\.cmd$/u.test(command)
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`)
}
for (const distribution of DISTRIBUTIONS) {
  const origin =
    distribution === 'international'
      ? 'https://download.ncurator.com'
      : 'https://download.guanzhangai.cn'
  const configurationDirectory = path.join(root, 'release-stage', 'distribution', distribution)
  const output = path.join(root, 'dist', distribution)
  rmSync(output, { recursive: true, force: true })
  mkdirSync(configurationDirectory, { recursive: true })
  mkdirSync(output, { recursive: true })
  const updateFile = path.join(configurationDirectory, 'app-update.yml')
  const markerFile = path.join(configurationDirectory, 'app-distribution.json')
  writeFileSync(
    updateFile,
    `provider: generic\nurl: ${origin}/updates/latest\nupdaterCacheDirName: ncurator-updater\n`
  )
  writeFileSync(markerFile, JSON.stringify({ distribution }) + '\n')
  const config = createDistributionConfig(base, {
    distribution,
    output,
    resourcesDirectory: configurationDirectory
  })
  const configFile = path.join(configurationDirectory, 'electron-builder.json')
  writeFileSync(configFile, JSON.stringify(config, null, 2))
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  run(pnpm, [
    'exec',
    'electron-builder',
    '--config',
    configFile,
    `--${platform}`,
    platform === 'win' ? '--x64' : '--arm64',
    '--publish',
    'never',
    ...(signed ? ['--config.forceCodeSigning=true'] : [])
  ])
  writeFileSync(path.join(output, 'shared-app.sha256'), sharedAppHash + '\n')
  writeFileSync(path.join(output, 'app-distribution.json'), JSON.stringify({ distribution }) + '\n')
  run(process.execPath, [
    path.join(root, 'scripts/build/package/audit-app.mjs'),
    output,
    path.join(root, 'release-stage/runtime-trace-report.json')
  ])
  const resourcesDirectory =
    platform === 'mac'
      ? path.join(
          output,
          'mac-arm64',
          `${distributionName(distribution)}.app`,
          'Contents',
          'Resources'
        )
      : path.join(output, 'win-unpacked', 'resources')
  verifySidecarStartup(
    path.join(
      resourcesDirectory,
      'web_crawler_sidecar',
      'bin',
      'web_crawler_sidecar',
      platform === 'win' ? 'web_crawler_sidecar.exe' : 'web_crawler_sidecar'
    )
  )
}
