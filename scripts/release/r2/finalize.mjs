import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { parseReleaseTag } from '../tag.mjs'

const args = process.argv.slice(2)
const tagIndex = args.indexOf('--tag')
const releaseTag = tagIndex >= 0 ? args[tagIndex + 1] || '' : ''
let releaseFamily = ''
try {
  releaseFamily = parseReleaseTag(releaseTag).family
} catch {
  throw new Error('usage: node scripts/release/r2/finalize.mjs --tag <mac-v1.2.3|windows-v1.2.3>')
}

const run = (script) =>
  new Promise((resolve, reject) => {
    const childArgs = [
      path.join(process.cwd(), 'scripts', 'release', 'r2', script),
      '--tag',
      releaseTag
    ]
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

await run(releaseFamily === 'mac' ? 'finalize-macos.mjs' : 'finalize-windows.mjs')
