/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFile, spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const version = valueAfter('--version') || ''
const releaseTag = `v${version}`
const notes = valueAfter('--notes') || `Ncurator ${releaseTag}`

if (!/^\d+\.\d+\.\d+$/u.test(version)) {
  throw new Error(
    'usage: node scripts/prepare-desktop-release.mjs --version <1.2.3> [--notes <text>]'
  )
}

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

const compareVersions = (left, right) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

const branch = (
  await execFileAsync('git', ['branch', '--show-current'], { cwd: ROOT })
).stdout.trim()
if (branch !== 'main') throw new Error(`desktop releases must be prepared on main, not ${branch}`)

await execFileAsync('git', ['diff', '--quiet', '--', 'package.json'], { cwd: ROOT }).catch(() => {
  throw new Error('package.json has uncommitted changes')
})
await execFileAsync('git', ['diff', '--cached', '--quiet', '--', 'package.json'], {
  cwd: ROOT
}).catch(() => {
  throw new Error('package.json has staged changes')
})

const packagePath = path.join(ROOT, 'package.json')
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
if (compareVersions(version, packageJson.version) <= 0) {
  throw new Error(`new version ${version} must be higher than ${packageJson.version}`)
}

const tagExists = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', releaseTag], {
  cwd: ROOT
})
  .then(() => true)
  .catch(() => false)
if (tagExists) throw new Error(`tag already exists: ${releaseTag}`)

packageJson.version = version
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

await run('pnpm', ['typecheck'])
await run('pnpm', ['test:update:unit'])
await run('pnpm', ['test:update:e2e'])
await run('git', ['add', '--', 'package.json'])
await run('git', ['commit', '-m', `release: prepare ${releaseTag}`])
await run('git', ['tag', '-a', releaseTag, '-m', notes])
await run('git', ['push', 'origin', 'main'])
await run('git', ['push', 'origin', releaseTag])

process.stdout.write(`[release] prepared and pushed ${releaseTag}\n`)
