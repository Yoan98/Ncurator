import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertNodePtyNativeReleaseReady,
  isNodePtyNativeReleaseReady,
  prepareNodePtyNativeRelease
} from '../../../../scripts/node-pty-native-release.mjs'

const tempRoots: string[] = []

const createRelease = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-node-pty-native-'))
  tempRoots.push(root)
  await fs.writeFile(path.join(root, 'pty.node'), 'test binding')
  await fs.writeFile(path.join(root, 'spawn-helper'), '#!/bin/sh\nexit 0\n', { mode: 0o644 })
  return root
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

describe.skipIf(process.platform === 'win32')('node-pty native release preparation', () => {
  it('repairs a packaged spawn-helper that has no executable bit', async () => {
    const release = await createRelease()

    expect(isNodePtyNativeReleaseReady(release)).toBe(false)
    expect(prepareNodePtyNativeRelease(release)).toBe(true)
    expect(isNodePtyNativeReleaseReady(release)).toBe(true)
    expect((await fs.stat(path.join(release, 'spawn-helper'))).mode & 0o111).toBe(0o111)
  })

  it('rejects an incomplete release instead of accepting file presence alone', async () => {
    const release = await createRelease()
    await fs.rm(path.join(release, 'pty.node'))

    expect(prepareNodePtyNativeRelease(release)).toBe(false)
    expect(() => assertNodePtyNativeReleaseReady(release, 'test release')).toThrow(
      'test release is incomplete'
    )
  })
})
