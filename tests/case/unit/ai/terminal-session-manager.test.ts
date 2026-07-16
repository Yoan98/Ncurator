import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TerminalSessionManager } from '../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'

const managers: TerminalSessionManager[] = []
const tempRoots: string[] = []

const createManager = () => {
  const manager = new TerminalSessionManager({ yieldMs: 120, stopGraceMs: 1000 })
  managers.push(manager)
  return manager
}

const createRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-terminal-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

describe.skipIf(process.platform === 'win32')('terminal session manager', () => {
  it('keeps cwd in the same terminal and starts a new terminal at workspace root', async () => {
    const manager = createManager()
    const root = await createRoot()
    await fs.mkdir(path.join(root, 'nested'))

    const changed = await manager.run({
      chatSessionId: 'chat-1',
      workspaceId: 'workspace-1',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-1',
      command: 'cd nested'
    })
    expect(changed.returnReason).toBe('command_completed')
    expect(changed.currentTerminalPath).toBe(path.join(root, 'nested'))

    const continued = await manager.run({
      chatSessionId: 'chat-1',
      workspaceId: 'workspace-1',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-1',
      terminalId: changed.terminalId,
      command: 'pwd'
    })
    expect(continued.output).toContain(path.join(root, 'nested'))
    expect(continued.output).not.toContain('__ncurator')
    expect(continued.output).not.toMatch(/\u001b\[/u)

    const fresh = await manager.run({
      chatSessionId: 'chat-1',
      workspaceId: 'workspace-1',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-1',
      command: 'pwd'
    })
    expect(fresh.terminalId).not.toBe(changed.terminalId)
    expect(fresh.output).toContain(root)
  })

  it('yields a running command, exposes incremental output, and stops it', async () => {
    const manager = createManager()
    const root = await createRoot()
    const running = await manager.run({
      chatSessionId: 'chat-1',
      workspaceId: 'workspace-1',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-1',
      command: 'while true; do echo terminal-tick; sleep 0.05; done'
    })

    expect(running.returnReason).toBe('command_still_running')
    expect(running.terminalStatus).toBe('running')
    const read = manager.read({
      terminalId: running.terminalId,
      chatSessionId: 'chat-1',
      workspaceId: 'workspace-1',
      outputCursor: 0
    })
    expect(read.output).toContain('terminal-tick')

    const stopped = await manager.stop({
      terminalId: running.terminalId,
      chatSessionId: 'chat-1',
      workspaceId: 'workspace-1'
    })
    expect(stopped.stopped).toBe(true)
    expect(stopped.terminalStatus).toBe('idle')
  })

  it('isolates terminals by chat and workspace and closes them with the chat', async () => {
    const manager = createManager()
    const root = await createRoot()
    const created = await manager.run({
      chatSessionId: 'chat-1',
      workspaceId: 'workspace-1',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-1',
      command: 'pwd'
    })
    expect(manager.list({ chatSessionId: 'chat-2' })).toEqual([])
    expect(() =>
      manager.read({
        terminalId: created.terminalId,
        chatSessionId: 'chat-1',
        workspaceId: 'workspace-2'
      })
    ).toThrow('terminal_not_found')
    await manager.closeByChatSession('chat-1')
    expect(manager.list({ chatSessionId: 'chat-1' })).toEqual([])
  })
})
