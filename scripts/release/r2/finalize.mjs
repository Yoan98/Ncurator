import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const tagIndex = args.indexOf('--tag')
const releaseTag = tagIndex >= 0 ? args[tagIndex + 1] || '' : ''
if (!/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
  throw new Error('usage: node scripts/release/r2/finalize.mjs --tag <v1.2.3> [--keep-old]')
}

const run = (script) =>
  new Promise((resolve, reject) => {
    const childArgs = [
      path.join(process.cwd(), 'scripts', 'release', 'r2', script),
      '--tag',
      releaseTag
    ]
    if (args.includes('--keep-old')) childArgs.push('--keep-old')
    const child = spawn(process.execPath, childArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`))
    )
  })

await run('finalize-windows.mjs')
await run('finalize-macos.mjs')
