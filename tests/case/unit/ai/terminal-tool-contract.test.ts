import { describe, expect, it } from 'vitest'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import { TERMINAL_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/terminal/toolSpecs'
import {
  TERMINAL_READ_SCHEMA,
  TERMINAL_RUN_SCHEMA
} from '../../../../src/main/services/ai/human/tools/terminal/toolSchemas'
import type {
  TerminalReadOutput,
  TerminalRunOutput
} from '../../../../src/main/services/ai/human/tools/terminal/outputTypes'
import {
  mapTerminalReadStatus,
  mapTerminalRunStatus
} from '../../../../src/main/services/ai/human/tools/terminal/terminalToolStatus'

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

  it('accepts optional maxWaitSeconds without teaching defaults or next steps', () => {
    expect(TERMINAL_TOOL_SPECS[0]?.promptSpec.description).toBe(
      '在用户本机终端执行命令。默认工作目录为用户主目录。'
    )
    expect(TERMINAL_RUN_SCHEMA.shape.maxWaitSeconds.description).toBe(
      '本次调用最长盯着命令结束的秒数；到点后命令继续执行'
    )
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

  it('declares terminal run and read output fields', () => {
    const runSample = {
      terminalId: 'term-1',
      status: 'succeeded',
      output: 'hello\n',
      readEndPosition: 6,
      hasMoreOutput: false
    } satisfies TerminalRunOutput

    const readSample = {
      status: 'running',
      output: 'more\n',
      readEndPosition: 12,
      hasMoreOutput: true
    } satisfies TerminalReadOutput

    expect(runSample.status).toBe('succeeded')
    expect(readSample.hasMoreOutput).toBe(true)
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
