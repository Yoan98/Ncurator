import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import {
  assertWindowsReleaseRouteAvailable,
  dispatchWindowsRelease,
  inspectLocalWindowsRelease
} from './shared/windows.mjs'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const releaseTag = valueAfter('--tag') || ''
const forceLocal = args.includes('--local-only')
const forceActions = args.includes('--actions')

if (!/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
  throw new Error(
    'usage: node scripts/release/route-windows.mjs --tag <v1.2.3> [--local-only|--actions]'
  )
}
if (forceLocal && forceActions) throw new Error('--local-only and --actions cannot be combined')

const run = (command, commandArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })

const localInspection = forceActions ? undefined : await inspectLocalWindowsRelease(ROOT)
const route = await assertWindowsReleaseRouteAvailable({
  root: ROOT,
  forceLocal,
  forceActions,
  localInspection
})

if (route === 'local') {
  process.stdout.write(`[release] local Windows environment is ready; building ${releaseTag}\n`)
  await run(process.execPath, [
    path.join(ROOT, 'scripts', 'release', 'windows.mjs'),
    '--tag',
    releaseTag
  ])
} else {
  if (localInspection?.issues.length) {
    process.stdout.write(
      `[release] local Windows release unavailable; using Actions:\n- ${localInspection.issues.join('\n- ')}\n`
    )
  }
  await dispatchWindowsRelease(ROOT, releaseTag)
}
