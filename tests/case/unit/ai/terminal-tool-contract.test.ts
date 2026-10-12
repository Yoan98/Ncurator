import { renderTerminalRunModelResult } from '../../../../src/main/services/ai/human/shared/modelToolResultRenderers'
import { renderTerminalReadModelResult } from '../../../../src/main/services/ai/human/shared/modelToolResultRenderers'
import { describe, expect, it } from 'vitest'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import { TERMINAL_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/terminal/toolSpecs'
import {
  TERMINAL_READ_SCHEMA,
  TERMINAL_RUN_SCHEMA
} from '../../../../src/main/services/ai/human/tools/terminal/toolSchemas'
import {
  mapTerminalReadStatus,
  mapTerminalRunStatus
} from '../../../../src/main/services/ai/human/tools/terminal/terminalToolStatus'

describe('ai unit terminal tool contract', () => {
  it('binds both tools to the terminal skill', () => {
    expect(TERMINAL_TOOL_SPECS.map((spec) => spec.name)).toEqual(['terminal_run', 'terminal_read'])
    expect(SKILL_DEFINITIONS.terminal.toolNames).toEqual(['terminal_run', 'terminal_read'])
    TERMINAL_TOOL_SPECS.forEach((spec) => {
      expect(spec.skillIds).toEqual(['terminal'])
      expect(spec.familyId).toBe('terminal')
      expect(typeof spec.modelResult.renderSuccess).toBe('function')
    })
  })

  it('requires command and commandExplanation for terminal_run', () => {
    expect(
      TERMINAL_RUN_SCHEMA.safeParse({
        command: 'pwd',
        commandExplanation: '查看当前目录'
      }).success
    ).toBe(true)
    expect(
      TERMINAL_RUN_SCHEMA.safeParse({
        command: 'pwd'
      }).success
    ).toBe(false)
    expect(
      TERMINAL_RUN_SCHEMA.safeParse({
        commandExplanation: '说明'
      }).success
    ).toBe(false)
  })

  it('accepts integer maxWaitSeconds and rejects fractions', () => {
    expect(
      TERMINAL_RUN_SCHEMA.safeParse({
        command: 'sleep 40; echo done',
        commandExplanation: '等待页面就绪',
        maxWaitSeconds: 40
      }).success
    ).toBe(true)
    expect(
      TERMINAL_RUN_SCHEMA.safeParse({
        command: 'pwd',
        commandExplanation: '查看当前目录',
        maxWaitSeconds: 1.5
      }).success
    ).toBe(false)
  })

  it('requires terminalId for terminal_read and accepts optional readEndPosition', () => {
    expect(TERMINAL_READ_SCHEMA.safeParse({ terminalId: 'term-1' }).success).toBe(true)
    expect(
      TERMINAL_READ_SCHEMA.safeParse({
        terminalId: 'term-1',
        readEndPosition: 0
      }).success
    ).toBe(true)
    expect(TERMINAL_READ_SCHEMA.safeParse({ readEndPosition: 0 }).success).toBe(false)
    expect(
      TERMINAL_READ_SCHEMA.safeParse({
        terminalId: 'term-1',
        readEndPosition: -1
      }).success
    ).toBe(false)
  })

  it('maps terminal run and read statuses to four-state contract', () => {
    expect(mapTerminalRunStatus('command_still_running', null)).toBe('running')
    expect(mapTerminalRunStatus('command_stopped', 130)).toBe('cancelled')
    expect(mapTerminalRunStatus('command_completed', 0)).toBe('succeeded')
    expect(mapTerminalRunStatus('command_completed', 1)).toBe('failed')

    expect(mapTerminalReadStatus('running', null, true)).toBe('running')
    expect(mapTerminalReadStatus('idle', 130, false)).toBe('cancelled')
    expect(mapTerminalReadStatus('idle', 0, false)).toBe('succeeded')
    expect(mapTerminalReadStatus('idle', 2, false)).toBe('failed')
  })
})

describe('tool result data fidelity', () => {
  it('preserves terminal_run data', () => {
    const rendered = renderTerminalRunModelResult({
      toolName: 'terminal_run',
      args: {},
      data: {
        terminalId: 'term-001',
        exitCode: 0,
        internalTrace: 'private-terminal-trace',
        status: 'succeeded',
        output: 'done\n',
        readEndPosition: 5,
        hasMoreOutput: false
      }
    })

    expect(rendered).toContain('done')
    expect(rendered).toContain('succeeded')
    expect(rendered).toContain('term-001')
    expect(rendered).not.toContain('exitCode')
    expect(rendered).not.toContain('private-terminal-trace')
  })

  it('preserves terminal_read data', () => {
    const rendered = renderTerminalReadModelResult({
      toolName: 'terminal_read',
      args: { terminalId: 'term-001' },
      data: {
        status: 'running',
        output: 'more\n',
        readEndPosition: 12,
        hasMoreOutput: true
      }
    })

    expect(rendered).toContain('running')
    expect(rendered).not.toContain('term-001')
  })
})
