import { describe, expect, it } from 'vitest'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import { TERMINAL_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/terminal/toolSpecs'
import {
  TERMINAL_READ_SCHEMA,
  TERMINAL_RUN_SCHEMA
} from '../../../../src/main/services/ai/human/tools/terminal/toolSchemas'
import type { TerminalSessionOutput } from '../../../../src/main/services/ai/human/tools/terminal/outputTypes'

describe('ai unit terminal tool contract', () => {
  it('binds both tools to the terminal skill', () => {
    expect(TERMINAL_TOOL_SPECS.map((spec) => spec.name)).toEqual([
      'terminal_run',
      'terminal_read'
    ])
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

  it('declares terminal session output fields', () => {
    const sample = {
      terminalId: 'term-1',
      status: 'completed',
      output: 'hello\n',
      readEndPosition: 6,
      hasMoreOutput: false,
      exitCode: 0
    } satisfies TerminalSessionOutput

    expect(sample.status).toBe('completed')
    expect(sample.hasMoreOutput).toBe(false)
  })
})
