import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveLeadingCommandCwd,
  resolveTerminalTrackingCwd
} from '../../../../src/main/services/ai/human/tools/terminal/resolveLeadingCommandCwd'

const tempRoots: string[] = []

const createRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-leading-cwd-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

describe('resolveLeadingCommandCwd', () => {
  it('resolves leading cd with && and semicolon separators', async () => {
    const root = await createRoot()
    const nested = path.join(root, 'nested')
    await fs.mkdir(nested)

    await expect(
      resolveLeadingCommandCwd({
        command: `cd "${nested}" && printf ok`,
        currentPath: root
      })
    ).resolves.toBe(nested)

    await expect(
      resolveLeadingCommandCwd({
        command: `cd '${nested}'; touch a.txt`,
        currentPath: root
      })
    ).resolves.toBe(nested)

    await expect(
      resolveLeadingCommandCwd({
        command: `Set-Location "${nested}"; Write-Output ok`,
        currentPath: root
      })
    ).resolves.toBe(nested)
  })

  it('resolves relative leading cd against the session start path', async () => {
    const root = await createRoot()
    const nested = path.join(root, 'nested')
    await fs.mkdir(nested)

    await expect(
      resolveLeadingCommandCwd({
        command: 'cd nested && pwd',
        currentPath: root
      })
    ).resolves.toBe(nested)
  })

  it('returns undefined when there is no leading cd or the target is missing', async () => {
    const root = await createRoot()

    await expect(
      resolveLeadingCommandCwd({
        command: `printf 'hi' > "${path.join(root, 'out.txt')}"`,
        currentPath: os.homedir()
      })
    ).resolves.toBeUndefined()

    await expect(
      resolveLeadingCommandCwd({
        command: 'echo first; cd nested && pwd',
        currentPath: root
      })
    ).resolves.toBeUndefined()

    await expect(
      resolveLeadingCommandCwd({
        command: 'cd missing-dir && pwd',
        currentPath: root
      })
    ).resolves.toBeUndefined()
  })

  it('builds tracking cwd from session start plus leading cd', async () => {
    const home = await createRoot()
    const workspace = await createRoot()

    await expect(
      resolveTerminalTrackingCwd({
        command: `printf x > "${path.join(workspace, 'a.txt')}"`,
        sessionStartPath: home
      })
    ).resolves.toBe(path.resolve(home))

    await expect(
      resolveTerminalTrackingCwd({
        command: `cd "${workspace}" && printf x > a.txt`,
        sessionStartPath: home
      })
    ).resolves.toBe(path.resolve(workspace))

    await expect(
      resolveTerminalTrackingCwd({
        command: `Set-Location -LiteralPath '${workspace}'; Set-Content a.txt x`,
        sessionStartPath: home
      })
    ).resolves.toBe(path.resolve(workspace))
  })

  it('resolves PowerShell -LiteralPath / -Path and cmd-style cd /d', async () => {
    const root = await createRoot()
    const nested = path.join(root, 'nested')
    await fs.mkdir(nested)

    await expect(
      resolveLeadingCommandCwd({
        command: `Set-Location -LiteralPath '${nested}'; Get-ChildItem`,
        currentPath: root
      })
    ).resolves.toBe(nested)

    await expect(
      resolveLeadingCommandCwd({
        command: `Set-Location -Path "${nested}"; Write-Output ok`,
        currentPath: root
      })
    ).resolves.toBe(nested)

    await expect(
      resolveLeadingCommandCwd({
        command: `cd /d "${nested}" && dir`,
        currentPath: root
      })
    ).resolves.toBe(nested)
  })
})
