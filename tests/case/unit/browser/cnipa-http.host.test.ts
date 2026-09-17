import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const electronExecutablePath = createRequire(import.meta.url)('electron') as string
const HOST_SCRIPT = path.resolve(
  process.cwd(),
  'tests/harness/backend/electronBareNavigateHost.mjs'
)

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const runHost = async (): Promise<Record<string, unknown>> => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'ncurator-cnipa-nav-'))
  tempDirs.push(userDataPath)
  const env = { ...process.env, NCURATOR_TEST_NAV_USER_DATA_PATH: userDataPath }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electronExecutablePath, [HOST_SCRIPT], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => {
    stdout += String(chunk)
  })
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const exitCode = await new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code))
  })
  const line = stdout
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find((item) => item.startsWith('NCURATOR_NAV_RESULT='))
  if (!line) {
    throw new Error(
      `CNIPA host produced no result (exit=${String(exitCode)}): ${stderr.slice(-800) || stdout.slice(-800)}`
    )
  }
  const payload = JSON.parse(line.slice('NCURATOR_NAV_RESULT='.length)) as Record<string, unknown>
  payload.userDataPath = userDataPath
  payload.hasDevToolsActivePortAfterExit = existsSync(path.join(userDataPath, 'DevToolsActivePort'))
  return payload
}

describe('cnipa explicit http host', () => {
  it(
    'opens 中国专利公布公告 over explicit http without a process-level debug port',
    async () => {
      const result = await runHost()
      expect(result.hasRemoteDebuggingPort).toBe(false)
      expect(result.hasDevToolsActivePort).toBe(false)
      expect(result.hasDevToolsActivePortAfterExit).toBe(false)
      expect(String(result.url || '')).toMatch(/^http:\/\/epub\.cnipa\.gov\.cn\/?/)
      expect(result.ok).toBe(true)
      expect(`${String(result.title || '')} ${String(result.bodyText || '')}`).toContain('中国专利公布公告')
    },
    90_000
  )
})
