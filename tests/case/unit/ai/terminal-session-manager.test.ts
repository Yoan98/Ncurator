import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TerminalSessionManager } from '../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'

const managers: TerminalSessionManager[] = []
const tempRoots: string[] = []

const createManager = (environment?: Record<string, string>, yieldMs = 120) => {
  const manager = new TerminalSessionManager({
    yieldMs,
    stopGraceMs: 1000,
    environment
  })
  managers.push(manager)
  return manager
}

const createRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-terminal-'))
  tempRoots.push(root)
  return root
}

const writeCommandStub = async (
  directoryPath: string,
  commandName: string,
  output: string,
  exitCode = 0
) => {
  const commandPath = path.join(directoryPath, commandName)
  await fs.writeFile(
    commandPath,
    `#!/bin/sh\nprintf '%s\\n' '${output}'\nexit ${String(exitCode)}\n`
  )
  await fs.chmod(commandPath, 0o755)
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
    // eslint-disable-next-line no-control-regex
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

  it('keeps cwd when switching between workspace and the allowed user runtime', async () => {
    const manager = createManager()
    const root = await createRoot()
    const userRuntimeRoot = await createRoot()

    const changed = await manager.run({
      chatSessionId: 'chat-runtime',
      workspaceId: 'workspace-runtime',
      workspaceRootPath: root,
      userRuntimeRootPath: userRuntimeRoot,
      platform: 'macos',
      runId: 'run-runtime',
      command: `cd "${userRuntimeRoot}"`
    })

    expect(changed.returnReason).toBe('command_completed')
    expect(changed.currentTerminalPath).toBe(userRuntimeRoot)

    const continued = await manager.run({
      chatSessionId: 'chat-runtime',
      workspaceId: 'workspace-runtime',
      workspaceRootPath: root,
      userRuntimeRootPath: userRuntimeRoot,
      platform: 'macos',
      runId: 'run-runtime',
      terminalId: changed.terminalId,
      command: 'pwd'
    })

    expect(continued.output).toContain(userRuntimeRoot)
  })

  it('can isolate Node and Python availability without changing the app process', async () => {
    const root = await createRoot()
    const binRoot = await createRoot()
    await writeCommandStub(binRoot, 'node', 'v22.0.0')
    await writeCommandStub(binRoot, 'python3', 'python unavailable', 127)
    const manager = createManager({ PATH: `${binRoot}:/usr/bin:/bin` }, 1000)

    const nodeResult = await manager.run({
      chatSessionId: 'chat-env',
      workspaceId: 'workspace-env',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-env',
      command: 'node --version'
    })
    const pythonResult = await manager.run({
      chatSessionId: 'chat-env',
      workspaceId: 'workspace-env',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-env',
      command: 'python3 --version'
    })

    expect(nodeResult.exitCode).toBe(0)
    expect(nodeResult.output).toContain('v22.0.0')
    expect(pythonResult.exitCode).toBe(127)
    expect(pythonResult.output).toContain('python unavailable')
    expect(process.execPath).not.toBe(path.join(binRoot, 'node'))
  })

  it('can expose a Python-only terminal profile', async () => {
    const root = await createRoot()
    const binRoot = await createRoot()
    await writeCommandStub(binRoot, 'node', 'node unavailable', 127)
    await writeCommandStub(binRoot, 'python3', 'Python 3.12.0')
    const manager = createManager({ PATH: `${binRoot}:/usr/bin:/bin` }, 1000)

    const nodeResult = await manager.run({
      chatSessionId: 'chat-python',
      workspaceId: 'workspace-python',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-python',
      command: 'node --version'
    })
    const pythonResult = await manager.run({
      chatSessionId: 'chat-python',
      workspaceId: 'workspace-python',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-python',
      command: 'python3 --version'
    })

    expect(nodeResult.exitCode).toBe(127)
    expect(pythonResult.exitCode).toBe(0)
    expect(pythonResult.output).toContain('Python 3.12.0')
  })

  it('can expose a terminal profile without Node or Python', async () => {
    const root = await createRoot()
    const binRoot = await createRoot()
    await writeCommandStub(binRoot, 'node', 'node unavailable', 127)
    await writeCommandStub(binRoot, 'python3', 'python unavailable', 127)
    const manager = createManager({ PATH: `${binRoot}:/usr/bin:/bin` }, 1000)

    const nodeResult = await manager.run({
      chatSessionId: 'chat-empty',
      workspaceId: 'workspace-empty',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-empty',
      command: 'node --version'
    })
    const pythonResult = await manager.run({
      chatSessionId: 'chat-empty',
      workspaceId: 'workspace-empty',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-empty',
      command: 'python3 --version'
    })

    expect(nodeResult.exitCode).toBe(127)
    expect(pythonResult.exitCode).toBe(127)
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
