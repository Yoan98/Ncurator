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

const createManager = (
  environment?: Record<string, string>,
  yieldMs = 120,
  readMaxChars?: number
) => {
  const manager = new TerminalSessionManager({
    yieldMs,
    stopGraceMs: 1000,
    environment,
    readMaxChars
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
  return { exitCode, output: result.output }
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

describe.skipIf(process.platform === 'win32')('terminal session manager', () => {
  it('updates cwd from a leading cd before yielding a long-running command', async () => {
    const manager = createManager(undefined, 250)
    const root = await createRoot()
    const nested = path.join(root, 'nested')
    await fs.mkdir(nested)

    const running = await manager.run({
      chatSessionId: 'chat-cwd-mac',
      workspaceId: 'workspace-cwd-mac',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-cwd-mac',
      command: `cd "${nested}"; while true; do sleep 0.05; done`
    })

    expect(running.returnReason).toBe('command_still_running')
    expect(running.currentTerminalPath).toBe(nested)

    const stopped = await manager.stop({
      terminalId: running.terminalId,
      chatSessionId: 'chat-cwd-mac',
      workspaceId: 'workspace-cwd-mac',
      closeTerminal: true
    })
    expect(stopped.terminalStatus).toBe('closed')
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
      command: `cd "中文目录"; printf '中文输出😀\\n'; pwd`
    })
    expect(changed.output).toContain('中文输出😀')
    expect(changed.output).toContain(chineseDirectory)
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

  it('keeps completed output readable until every chunk has been consumed', async () => {
    const manager = createManager(undefined, 2_000, 1_000)
    const root = await createRoot()
    const expected = Array.from({ length: 4_000 }, (_, index) => `output-${index + 1}`).join('\n')
    const sourcePath = path.join(root, 'expected.txt')
    await fs.writeFile(sourcePath, expected, 'utf8')

    const result = await manager.run({
      chatSessionId: 'chat-output',
      workspaceId: 'workspace-output',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-output',
      command: `sed -n '1,4000p' "${sourcePath}"`
    })
    if (result.exitCode === null) {
      await manager.waitForCommand({
        terminalId: result.terminalId,
        commandId: result.commandId,
        chatSessionId: 'chat-output',
        workspaceId: 'workspace-output'
      })
    }

    let combined = result.output
    let cursor = result.readEndPosition
    let hasMore = result.hasMoreOutput || result.exitCode === null
    while (hasMore) {
      const next = await manager.read({
        terminalId: result.terminalId,
        chatSessionId: 'chat-output',
        workspaceId: 'workspace-output',
        readEndPosition: cursor
      })
      combined += next.output
      cursor = next.readEndPosition
      hasMore = next.hasMoreOutput
    }

    expect(combined.replace(/^\n/u, '').trimEnd()).toBe(expected)
    await expect(
      manager.read({
        terminalId: result.terminalId,
        chatSessionId: 'chat-output',
        workspaceId: 'workspace-output',
        readEndPosition: cursor
      })
    ).rejects.toThrow()
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

  it('rejects a new session beyond the per-chat concurrent limit but allows termination commands', async () => {
    const manager = new TerminalSessionManager({
      yieldMs: 100,
      stopGraceMs: 1000,
      maxConcurrentSessions: 2
    })
    managers.push(manager)
    const root = await createRoot()
    const longCommand = 'sleep 30'
    const first = await manager.run({
      chatSessionId: 'chat-limit',
      workspaceId: 'workspace-limit',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-1',
      command: longCommand
    })
    const second = await manager.run({
      chatSessionId: 'chat-limit',
      workspaceId: 'workspace-limit',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-2',
      command: longCommand
    })
    expect(first.returnReason).toBe('command_still_running')
    expect(second.returnReason).toBe('command_still_running')

    await expect(
      manager.run({
        chatSessionId: 'chat-limit',
        workspaceId: 'workspace-limit',
        workspaceRootPath: root,
        platform: 'macos',
        runId: 'run-3',
        command: 'echo blocked'
      })
    ).rejects.toThrow('terminal_session_limit_reached')

    const kill = await manager.run({
      chatSessionId: 'chat-limit',
      workspaceId: 'workspace-limit',
      workspaceRootPath: root,
      platform: 'macos',
      runId: 'run-4',
      command: "pkill -f 'sleep 30'"
    })
    const completedKill = await finishCommand(manager, kill, 'chat-limit', 'workspace-limit')
    expect(completedKill.exitCode).toBe(0)
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
      command: `Set-Location "${chineseDirectory}"; Write-Output '持续中文'`
    })
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
      (
        await manager.read({
          terminalId: running.terminalId,
          chatSessionId: 'chat-cwd',
          workspaceId: 'workspace-cwd'
        })
      ).currentTerminalPath
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

  it('reads output in bounded chunks while advancing the cursor for continuous reading', async () => {
    const manager = createManager(undefined, 100, 20)
    const root = await createRoot()
    const running = await manager.run({
      chatSessionId: 'chat-chunk',
      workspaceId: 'workspace-chunk',
      workspaceRootPath: root,
      platform: 'windows',
      runId: 'run-chunk',
      command: "Write-Output ('a' * 100); Start-Sleep -Seconds 5"
    })

    expect(running.returnReason).toBe('command_still_running')
    expect(running.output.length).toBeLessThanOrEqual(20)

    await new Promise<void>((resolve) => setTimeout(resolve, 1500))

    const parts = [running.output]
    const hasMoreValues: boolean[] = []
    let cursor = running.readEndPosition
    for (let index = 0; index < 200; index += 1) {
      const read = await manager.read({
        terminalId: running.terminalId,
        chatSessionId: 'chat-chunk',
        workspaceId: 'workspace-chunk',
        readEndPosition: cursor
      })
      expect(read.readEndPosition - cursor).toBe(read.output.length)
      expect(read.output.length).toBeLessThanOrEqual(20)
      hasMoreValues.push(read.hasMoreOutput)
      parts.push(read.output)
      cursor = read.readEndPosition
      if (read.output === '' && !read.hasMoreOutput) break
      if (read.output === '' && read.hasMoreOutput) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
      }
    }
    expect(hasMoreValues[0]).toBe(true)
    expect(hasMoreValues.at(-1)).toBe(false)
    expect(parts.join('')).toContain('a'.repeat(100))

    await manager.stop({
      terminalId: running.terminalId,
      chatSessionId: 'chat-chunk',
      workspaceId: 'workspace-chunk',
      closeTerminal: true
    })
  })

  it('rejects a new session beyond the per-chat concurrent limit', async () => {
    const manager = new TerminalSessionManager({
      yieldMs: 100,
      stopGraceMs: 1000,
      maxConcurrentSessions: 2
    })
    managers.push(manager)
    const root = await createRoot()
    const longCommand = 'while ($true) { Start-Sleep -Milliseconds 50 }'
    const first = await manager.run({
      chatSessionId: 'chat-limit',
      workspaceId: 'workspace-limit',
      workspaceRootPath: root,
      platform: 'windows',
      runId: 'run-1',
      command: longCommand
    })
    const second = await manager.run({
      chatSessionId: 'chat-limit',
      workspaceId: 'workspace-limit',
      workspaceRootPath: root,
      platform: 'windows',
      runId: 'run-2',
      command: longCommand
    })
    expect(first.returnReason).toBe('command_still_running')
    expect(second.returnReason).toBe('command_still_running')

    await expect(
      manager.run({
        chatSessionId: 'chat-limit',
        workspaceId: 'workspace-limit',
        workspaceRootPath: root,
        platform: 'windows',
        runId: 'run-3',
        command: 'Write-Output blocked'
      })
    ).rejects.toThrow('terminal_session_limit_reached')
  })
})
