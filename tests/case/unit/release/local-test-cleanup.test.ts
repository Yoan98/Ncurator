import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupLocalTestLogs } from '../../../../scripts/release/shared/test-logs.mjs'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})
const createRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-release-log-cleanup-'))
  roots.push(root)
  return root
}
const write = async (root: string, relative: string) => {
  const file = path.join(root, relative)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, 'retained diagnostic evidence')
  return file
}
const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false
  )

describe('published release test cleanup', () => {
  it('removes copied attempts for the published platform through its version only', async () => {
    const root = await createRoot()
    const logs = await write(root, 'tests/logs/run/trace.zip')
    const old = await write(root, '.codex-tmp/release-mac-v1.0.13/attempt-3/logs/trace.zip')
    const current = await write(root, '.codex-tmp/release-mac-v1.0.14/attempt-1/logs/trace.zip')
    const retained = await Promise.all([
      write(root, '.codex-tmp/release-mac-v1.0.15/attempt-1/logs/trace.zip'),
      write(root, '.codex-tmp/release-windows-v1.0.13/attempt-1/logs/trace.zip'),
      write(root, '.codex-tmp/release-mac-v1.0.14-notes/report.json'),
      write(root, '.codex-tmp/knowledge-cache/model.onnx')
    ])
    const removed = await cleanupLocalTestLogs(root, { tag: 'mac-v1.0.14' })
    expect(removed).toHaveLength(2)
    for (const file of [logs, old, current]) expect(await exists(file)).toBe(false)
    for (const file of retained) expect(await exists(file)).toBe(true)
    await expect(cleanupLocalTestLogs(root, { tag: 'mac-v1.0.14' })).resolves.toEqual([])
  })

  it('requires a valid published tag before deleting any logs', async () => {
    const root = await createRoot()
    const logs = await write(root, 'tests/logs/run/trace.zip')
    await expect(cleanupLocalTestLogs(root, { tag: '../../outside' })).rejects.toThrow(
      'release tag'
    )
    expect(await exists(logs)).toBe(true)
  })

  it('refuses a linked scratch root and preserves outside data and local logs', async () => {
    const root = await createRoot(),
      outside = await createRoot()
    const external = await write(outside, 'release-mac-v1.0.13/valuable.txt')
    const logs = await write(root, 'tests/logs/run/trace.zip')
    await fs.symlink(
      outside,
      path.join(root, '.codex-tmp'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    await expect(cleanupLocalTestLogs(root, { tag: 'mac-v1.0.14' })).rejects.toThrow(
      'symbolic link'
    )
    expect(await exists(external)).toBe(true)
    expect(await exists(logs)).toBe(true)
  })
})
