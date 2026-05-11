import { describe, expect, it } from 'vitest'
import {
  analyzeTerminalCommand,
  classifyCommandMode
} from '../../../src/main/services/ai/human/tools/terminal/terminalCommandPolicy'
import { TERMINAL_RUN_TOOL_SPEC } from '../../../src/main/services/ai/human/tools/terminal/toolSpecs'

describe('ai unit terminal command policy', () => {
  it('classifies echo and printf without redirection as read_only', () => {
    expect(classifyCommandMode('echo hello world')).toBe('read_only')
    expect(classifyCommandMode('printf \"%s\\n\" hello')).toBe('read_only')
    expect(analyzeTerminalCommand({ command: 'echo hello world' }).commandMode).toBe('read_only')
  })

  it('treats inline interpreter commands as executable but not read_only classified', () => {
    expect(classifyCommandMode('python3 -c "print(1)"')).toBe('unknown')
    expect(classifyCommandMode('node -e "console.log(1)"')).toBe('unknown')
  })

  it('keeps inline interpreter commands out of parallel-safe metadata', () => {
    const pythonMeta = TERMINAL_RUN_TOOL_SPEC.resolveExecutionMeta({
      command: 'python3 -c "print(1)"'
    })
    const nodeMeta = TERMINAL_RUN_TOOL_SPEC.resolveExecutionMeta({
      command: 'node -e "console.log(1)"'
    })
    const echoMeta = TERMINAL_RUN_TOOL_SPEC.resolveExecutionMeta({
      command: 'echo hello world'
    })

    expect(pythonMeta.parallelSafe).toBe(false)
    expect(nodeMeta.parallelSafe).toBe(false)
    expect(echoMeta.parallelSafe).toBe(true)
    expect(echoMeta.mutability).toBe('read_only')
  })
})
