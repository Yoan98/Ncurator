import { describe, expect, it } from 'vitest'
import {
  analyzeTerminalCommand
} from '../../../src/main/services/ai/human/tools/terminal/terminalCommandPolicy'
import {
  analyzeReadonlyTerminalCommandPolicy
} from '../../../src/main/services/ai/human/tools/terminal/readonlyCommandPolicy'
import { TERMINAL_RUN_TOOL_SPEC } from '../../../src/main/services/ai/human/tools/terminal/toolSpecs'

describe('ai unit terminal command policy', () => {
  it('allows readonly commands from the approved set', () => {
    expect(analyzeReadonlyTerminalCommandPolicy('echo hello world').executionPolicy).toBe(
      'readonly_allowed'
    )
    expect(analyzeReadonlyTerminalCommandPolicy('printf "%s\\n" hello').executionPolicy).toBe(
      'readonly_allowed'
    )
    expect(analyzeReadonlyTerminalCommandPolicy('find . -type f').executionPolicy).toBe(
      'readonly_allowed'
    )
    expect(analyzeTerminalCommand({ command: 'echo hello world' }).artifactCandidates).toEqual([])
  })

  it('requires approval for inline interpreter commands', () => {
    expect(analyzeReadonlyTerminalCommandPolicy('python3 -c "print(1)"').executionPolicy).toBe(
      'approval_required'
    )
    expect(analyzeReadonlyTerminalCommandPolicy('node -e "console.log(1)"').executionPolicy).toBe(
      'approval_required'
    )
  })

  it('keeps non-readonly commands out of parallel-safe metadata', () => {
    const pythonMeta = TERMINAL_RUN_TOOL_SPEC.resolveExecutionMeta({
      command: 'python3 -c "print(1)"'
    })
    const nodeMeta = TERMINAL_RUN_TOOL_SPEC.resolveExecutionMeta({
      command: 'node -e "console.log(1)"'
    })
    const echoMeta = TERMINAL_RUN_TOOL_SPEC.resolveExecutionMeta({
      command: 'echo hello world'
    })
    const findMeta = TERMINAL_RUN_TOOL_SPEC.resolveExecutionMeta({
      command: 'find . -type f'
    })

    expect(pythonMeta.parallelSafe).toBe(false)
    expect(nodeMeta.parallelSafe).toBe(false)
    expect(echoMeta.parallelSafe).toBe(true)
    expect(echoMeta.mutability).toBe('read_only')
    expect(findMeta.parallelSafe).toBe(true)
    expect(findMeta.mutability).toBe('read_only')
  })

  it('requires approval for shell redirection and broad commands', () => {
    expect(analyzeReadonlyTerminalCommandPolicy('echo hi > a.txt').executionPolicy).toBe(
      'approval_required'
    )
    expect(analyzeReadonlyTerminalCommandPolicy('find . -delete').executionPolicy).toBe(
      'approval_required'
    )
  })
})
