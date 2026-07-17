import { describe, expect, it } from 'vitest'
import {
  analyzeSafeTerminalCommandPolicy,
  analyzeTerminalCommand,
  checkWorkspaceBoundary
} from '../../../../src/main/services/ai/human/tools/terminal/commandPolicy'
import { buildWindowsPowerShellEncodedCommand } from '../../../../src/main/services/ai/human/tools/terminal/terminalExec'
import { createTerminalRunToolSpec } from '../../../../src/main/services/ai/human/tools/terminal/toolSpecs'

describe('ai unit terminal command policy', () => {
  it('allows macos commands from the platform safe command set', () => {
    expect(analyzeSafeTerminalCommandPolicy('echo hello world', 'macos').executionPolicy).toBe(
      'safe_allowed'
    )
    expect(analyzeSafeTerminalCommandPolicy('printf "%s\\n" hello', 'macos').executionPolicy).toBe(
      'safe_allowed'
    )
    expect(analyzeSafeTerminalCommandPolicy('find . -type f', 'macos').executionPolicy).toBe(
      'safe_allowed'
    )
    expect(
      analyzeSafeTerminalCommandPolicy('cat notes.txt | head -10', 'macos').executionPolicy
    ).toBe('safe_allowed')
    expect(
      analyzeSafeTerminalCommandPolicy("cat '学习笔记/深度学习.pdf' | strings | head -500", 'macos')
        .executionPolicy
    ).toBe('safe_allowed')
    expect(
      analyzeTerminalCommand({ command: 'echo hello world', platform: 'macos' }).artifactCandidates
    ).toEqual([])
  })

  it('allows windows commands from the platform safe command set', () => {
    expect(analyzeSafeTerminalCommandPolicy('Get-Location', 'windows').executionPolicy).toBe(
      'safe_allowed'
    )
    expect(
      analyzeSafeTerminalCommandPolicy('Get-ChildItem -LiteralPath notes', 'windows')
        .executionPolicy
    ).toBe('safe_allowed')
    expect(
      analyzeSafeTerminalCommandPolicy(
        'Get-ChildItem -Path notes -Recurse -File | Select-String -Pattern "alpha"',
        'windows'
      ).executionPolicy
    ).toBe('safe_allowed')
    expect(analyzeSafeTerminalCommandPolicy('ls', 'windows').executionPolicy).toBe(
      'approval_required'
    )
  })

  it('requires approval for inline interpreter commands', () => {
    expect(analyzeSafeTerminalCommandPolicy('python3 -c "print(1)"', 'macos').executionPolicy).toBe(
      'approval_required'
    )
    expect(
      analyzeSafeTerminalCommandPolicy('node -e "console.log(1)"', 'macos').executionPolicy
    ).toBe('approval_required')
  })

  it('maps safe terminal commands without artifacts to read_only execution metadata', () => {
    const macTerminalSpec = createTerminalRunToolSpec('macos')
    const pythonMeta = macTerminalSpec.resolveExecutionMeta({
      command: 'python3 -c "print(1)"'
    })
    const nodeMeta = macTerminalSpec.resolveExecutionMeta({
      command: 'node -e "console.log(1)"'
    })
    const echoMeta = macTerminalSpec.resolveExecutionMeta({
      command: 'echo hello world'
    })
    const findMeta = macTerminalSpec.resolveExecutionMeta({
      command: 'find . -type f'
    })

    expect(pythonMeta.mutability).toBe('mutating')
    expect(nodeMeta.mutability).toBe('mutating')
    expect(echoMeta.mutability).toBe('read_only')
    expect(findMeta.mutability).toBe('read_only')
  })

  it('requires approval for shell redirection and broad commands', () => {
    expect(analyzeSafeTerminalCommandPolicy('echo hi > a.txt', 'macos').executionPolicy).toBe(
      'approval_required'
    )
    expect(analyzeSafeTerminalCommandPolicy('find . -delete', 'macos').executionPolicy).toBe(
      'approval_required'
    )
    expect(
      analyzeSafeTerminalCommandPolicy('cat notes.txt | python3 -c "print(1)"', 'macos')
        .executionPolicy
    ).toBe('approval_required')
    expect(analyzeSafeTerminalCommandPolicy('ls & rm -rf tmp', 'macos').executionPolicy).toBe(
      'approval_required'
    )
  })

  it('allows workspace and user runtime paths while rejecting other absolute paths', () => {
    const workspaceRoot = '/tmp/workspace'
    const userRuntimeRoot = '/Users/test/.ncurator/runtime'

    expect(
      checkWorkspaceBoundary(
        'mkdir -p /tmp/workspace/.ncurator/runtime/scripts/report',
        [workspaceRoot, userRuntimeRoot],
        'macos'
      )
    ).toEqual({ ok: true })
    expect(
      checkWorkspaceBoundary(
        'mkdir -p /Users/test/.ncurator/runtime/node',
        [workspaceRoot, userRuntimeRoot],
        'macos'
      )
    ).toEqual({ ok: true })
    expect(
      checkWorkspaceBoundary(
        'cat /Users/test/Documents/private.txt',
        [workspaceRoot, userRuntimeRoot],
        'macos'
      )
    ).toEqual({
      ok: false,
      reason: 'path out of allowed boundary: /Users/test/Documents/private.txt'
    })
    expect(
      checkWorkspaceBoundary(
        'cat ~/Documents/private.txt',
        [workspaceRoot, userRuntimeRoot],
        'macos'
      ).ok
    ).toBe(false)
  })

  it('supports the same two-root boundary on windows', () => {
    const workspaceRoot = 'C:\\workspaces\\demo'
    const userRuntimeRoot = 'C:\\Users\\test\\.ncurator\\runtime'

    expect(
      checkWorkspaceBoundary(
        'New-Item -ItemType Directory -Path C:\\Users\\test\\.ncurator\\runtime\\python',
        [workspaceRoot, userRuntimeRoot],
        'windows'
      )
    ).toEqual({ ok: true })
    expect(
      checkWorkspaceBoundary(
        'Get-Content C:\\Users\\test\\Documents\\private.txt',
        [workspaceRoot, userRuntimeRoot],
        'windows'
      )
    ).toEqual({
      ok: false,
      reason: 'path out of allowed boundary: C:\\Users\\test\\Documents\\private.txt'
    })
  })

  it('renders terminal prompt specs by platform', () => {
    const macosPrompt = createTerminalRunToolSpec('macos').promptSpec
    const windowsPrompt = createTerminalRunToolSpec('windows').promptSpec

    expect(windowsPrompt.description).toContain('PowerShell')
    expect(windowsPrompt.description).not.toContain('zsh')
    expect(windowsPrompt.examples).toEqual([])
    expect(macosPrompt.description).toContain('zsh')
    expect(macosPrompt.description).not.toContain('PowerShell')
    expect(macosPrompt.examples).toEqual([])
  })

  it('builds windows powershell encoded commands with utf8 prelude', () => {
    const encoded = buildWindowsPowerShellEncodedCommand('Get-ChildItem')
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le')

    expect(decoded).toContain('[Console]::OutputEncoding')
    expect(decoded).toContain('$OutputEncoding')
    expect(decoded).toContain('Get-ChildItem')
  })
})
