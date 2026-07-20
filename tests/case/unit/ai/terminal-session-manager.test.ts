import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  TerminalSessionManager,
  type TerminalCommandResult
} from '../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'

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

const finishCommand = async (
  manager: TerminalSessionManager,
  result: TerminalCommandResult,
  chatSessionId: string,
  workspaceId: string
) => {
  const exitCode =
    result.exitCode ??
    (await manager.waitForCommand({
      terminalId: result.terminalId,
      commandId: result.commandId,
      chatSessionId,
      workspaceId
    }))
  const read = manager.read({
    terminalId: result.terminalId,
    chatSessionId,
    workspaceId,
    outputCursor: 0
  })
  return { exitCode, output: read.output }
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

  it('uses deterministic UTF-8 for Chinese files even when the parent locale is invalid', async () => {
    const manager = createManager({ LANG: 'C', LC_ALL: 'C', LC_CTYPE: 'C' }, 1000)
    const root = await createRoot()
    const chineseDirectory = path.join(root, '中文目录')
    await fs.mkdir(chineseDirectory)
    await fs.writeFile(path.join(root, 'sample-edit_中文.docx'), 'fixture', 'utf8')

    const listed = await manager.run({
      chatSessionId: 'chat-unicode',
      workspaceId: 'workspace-unicode',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-unicode',
      command: 'ls -1'
    })

    expect(listed.exitCode).toBe(0)
    expect(listed.output).toContain('中文目录')
    expect(listed.output).toContain('sample-edit_中文.docx')
    expect(listed.output).not.toContain('????')

    const changed = await manager.run({
      chatSessionId: 'chat-unicode',
      workspaceId: 'workspace-unicode',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-unicode',
      terminalId: listed.terminalId,
      command: 'cd "中文目录"'
    })
    expect(changed.currentTerminalPath).toBe(chineseDirectory)

    const continued = await manager.run({
      chatSessionId: 'chat-unicode',
      workspaceId: 'workspace-unicode',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-unicode',
      terminalId: listed.terminalId,
      command: `printf '中文输出😀\\n'; pwd`
    })
    expect(continued.output).toContain('中文输出😀')
    expect(continued.output).toContain(chineseDirectory)
  })

  it('runs commands larger than the PTY input line limit', async () => {
    const manager = createManager(undefined, 1000)
    const root = await createRoot()
    const longComment = `# ${'long-command-payload-'.repeat(1500)}`
    const result = await manager.run({
      chatSessionId: 'chat-long-command',
      workspaceId: 'workspace-long-command',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-long-command',
      command: `${longComment}\nprintf '超长命令正常\\n'`
    })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('超长命令正常')
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
    const nodeCompleted = await finishCommand(manager, nodeResult, 'chat-env', 'workspace-env')
    const pythonCompleted = await finishCommand(manager, pythonResult, 'chat-env', 'workspace-env')

    expect(nodeCompleted.exitCode).toBe(0)
    expect(nodeCompleted.output).toContain('v22.0.0')
    expect(pythonCompleted.exitCode).toBe(127)
    expect(pythonCompleted.output).toContain('python unavailable')
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
    const nodeCompleted = await finishCommand(
      manager,
      nodeResult,
      'chat-python',
      'workspace-python'
    )
    const pythonCompleted = await finishCommand(
      manager,
      pythonResult,
      'chat-python',
      'workspace-python'
    )

    expect(nodeCompleted.exitCode).toBe(127)
    expect(pythonCompleted.exitCode).toBe(0)
    expect(pythonCompleted.output).toContain('Python 3.12.0')
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
    const nodeCompleted = await finishCommand(manager, nodeResult, 'chat-empty', 'workspace-empty')
    const pythonCompleted = await finishCommand(
      manager,
      pythonResult,
      'chat-empty',
      'workspace-empty'
    )

    expect(nodeCompleted.exitCode).toBe(127)
    expect(pythonCompleted.exitCode).toBe(127)
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

describe.skipIf(process.platform !== 'win32')('terminal session manager on Windows', () => {
  it('keeps PowerShell and native command output in UTF-8', async () => {
    const manager = createManager({ PYTHONIOENCODING: 'cp1252', PYTHONUTF8: '0' }, 2000)
    const root = await createRoot()
    const chineseDirectory = path.join(root, '中文目录')
    await fs.mkdir(chineseDirectory)
    await fs.writeFile(path.join(root, 'sample-edit_中文.txt'), 'fixture', 'utf8')

    const powershell = await manager.run({
      chatSessionId: 'chat-windows-unicode',
      workspaceId: 'workspace-windows-unicode',
      workspaceRootPath: root,
      platform: 'windows',
      runId: 'run-windows-unicode',
      command:
        `Write-Output '中文输出😀'; Get-ChildItem -Name; ` +
        `Write-Output ([Console]::InputEncoding.WebName); ` +
        `Write-Output ([Console]::OutputEncoding.WebName); ` +
        `Write-Output ($OutputEncoding.WebName)`
    })

    expect(powershell.exitCode).toBe(0)
    expect(powershell.output).toContain('中文输出😀')
    expect(powershell.output).toContain('中文目录')
    expect(powershell.output).toContain('sample-edit_中文.txt')
    expect(powershell.output.match(/utf-8/giu)?.length).toBeGreaterThanOrEqual(3)

    const native = await manager.run({
      chatSessionId: 'chat-windows-unicode',
      workspaceId: 'workspace-windows-unicode',
      workspaceRootPath: root,
      platform: 'windows',
      runId: 'run-windows-unicode',
      terminalId: powershell.terminalId,
      command: 'cmd.exe /d /c dir /b'
    })
    expect(native.output).toContain('中文目录')
    expect(native.output).toContain('sample-edit_中文.txt')

    const changed = await manager.run({
      chatSessionId: 'chat-windows-unicode',
      workspaceId: 'workspace-windows-unicode',
      workspaceRootPath: root,
      platform: 'windows',
      runId: 'run-windows-unicode',
      terminalId: powershell.terminalId,
      command: `Set-Location "${chineseDirectory}"; Write-Output '持续中文'`
    })
    expect(changed.currentTerminalPath).toBe(chineseDirectory)
    expect(changed.output).toContain('持续中文')
  })

  it('updates cwd before yielding a long-running command', async () => {
    const manager = createManager(undefined, 250)
    const root = await createRoot()
    const nested = path.join(root, 'nested')
    await fs.mkdir(nested)

    const running = await manager.run({
      chatSessionId: 'chat-cwd',
      workspaceId: 'workspace-cwd',
      workspaceRootPath: root,
      platform: 'windows',
      runId: 'run-cwd',
      command: `cd "${nested}"; while ($true) { Start-Sleep -Milliseconds 50 }`
    })

    expect(running.returnReason).toBe('command_still_running')
    expect(running.currentTerminalPath).toBe(nested)
    expect(
      manager.read({
        terminalId: running.terminalId,
        chatSessionId: 'chat-cwd',
        workspaceId: 'workspace-cwd'
      }).currentTerminalPath
    ).toBe(nested)

    const stopped = await manager.stop({
      terminalId: running.terminalId,
      chatSessionId: 'chat-cwd',
      workspaceId: 'workspace-cwd',
      closeTerminal: true
    })
    expect(stopped.terminalStatus).toBe('closed')
  })

  it('repeatedly force closes long-running commands without crashing', async () => {
    const manager = createManager(undefined, 100)
    const root = await createRoot()

    for (let index = 0; index < 3; index += 1) {
      const running = await manager.run({
        chatSessionId: `chat-close-${String(index)}`,
        workspaceId: 'workspace-close',
        workspaceRootPath: root,
        platform: 'windows',
        runId: `run-close-${String(index)}`,
        command: 'while ($true) { Start-Sleep -Milliseconds 50 }'
      })
      expect(running.returnReason).toBe('command_still_running')

      const stopped = await manager.stop({
        terminalId: running.terminalId,
        chatSessionId: `chat-close-${String(index)}`,
        workspaceId: 'workspace-close',
        closeTerminal: true
      })
      expect(stopped.terminalStatus).toBe('closed')
    }
  })
})
