import { SUBAGENT_EXECUTION_CONCURRENCY } from '../../../../src/main/services/ai/constants'
import { describe, it, expect } from 'vitest'
import { assertToolAllowed, isToolAllowed } from '../../../../src/main/services/ai/run/toolPolicy'
import { acquireRunFile, releaseRunFiles } from '../../../../src/main/services/ai/run/fileLease'
import { formatZodErrorForTool } from '../../../../src/main/services/ai/human/shared/schemaError'
import { buildToolFeedback } from '../../../../src/main/services/ai/human/shared/toolFeedback'
import {
  DELEGATE_TO_SUBAGENT_SCHEMA,
  LIST_AGENT_SCHEMA
} from '../../../../src/main/services/ai/human/tools/agentControl/toolSchemas'

describe('subagent policy and file leases', () => {
  it('denies nested dispatch, questions and scheduled management', () => {
    for (const tool of [
      'delegate_to_subagent',
      'list_agent',
      'ask_user_question',
      'scheduled_task_list',
      'scheduled_task_action'
    ]) {
      expect(isToolAllowed({ isSubagent: true }, tool)).toBe(false)
      expect(() => assertToolAllowed({ isSubagent: true }, tool)).toThrow('交回主伙伴')
      expect(isToolAllowed({ isSubagent: false }, tool)).toBe(true)
    }
    expect(isToolAllowed({ isSubagent: true }, 'browser_use')).toBe(true)
    expect(isToolAllowed({ isSubagent: true }, 'terminal_run')).toBe(true)
  })
  it('accepts batches beyond execution concurrency and guards short names', () => {
    expect(LIST_AGENT_SCHEMA.safeParse({}).success).toBe(true)
    expect(LIST_AGENT_SCHEMA.safeParse({ agentId: 'a' }).success).toBe(false)
    expect(
      DELEGATE_TO_SUBAGENT_SCHEMA.safeParse({ agents: [{ agentId: 'a', instruction: '继续' }] })
        .success
    ).toBe(true)
    expect(
      DELEGATE_TO_SUBAGENT_SCHEMA.safeParse({
        agents: [{ agentId: 'a', name: '海豹', instruction: '继续' }]
      }).success
    ).toBe(false)
    expect(DELEGATE_TO_SUBAGENT_SCHEMA.safeParse({ agents: [] }).success).toBe(false)
    expect(
      DELEGATE_TO_SUBAGENT_SCHEMA.safeParse({
        agents: Array.from({ length: SUBAGENT_EXECUTION_CONCURRENCY + 1 }, () => ({
          name: '海豹',
          instruction: '任务'
        }))
      }).success
    ).toBe(true)
    expect(
      DELEGATE_TO_SUBAGENT_SCHEMA.safeParse({
        agents: [{ name: '123456789', instruction: '任务' }]
      }).success
    ).toBe(false)
  })
  it('holds the entire file session and permits access after disposal', () => {
    acquireRunFile('child-A', '/tmp/subagent-exclusive.docx')
    expect(() => acquireRunFile('child-A', '/tmp/subagent-exclusive.docx')).not.toThrow()
    expect(() => acquireRunFile('child-B', '/tmp/subagent-exclusive.docx')).toThrow('串行处理')
    releaseRunFiles('child-A')
    expect(() => acquireRunFile('child-B', '/tmp/subagent-exclusive.docx')).not.toThrow()
    releaseRunFiles('child-B')
  })
  it('preserves schema diagnostics and execution errors for a mixed selector', () => {
    const args = { agents: [{ name: '海豹', agentId: 'a', instruction: '继续核验' }] }
    const parsed = DELEGATE_TO_SUBAGENT_SCHEMA.safeParse(args)
    if (parsed.success) throw new Error('mixed create/resume selector was accepted')
    const error = formatZodErrorForTool('delegate_to_subagent', parsed.error)
    expect(error).toContain('agents[0]')
    expect(error).toContain('Unrecognized key')
    const feedback = buildToolFeedback({
      toolCallId: 'dispatch-failure',
      toolName: 'delegate_to_subagent',
      ok: false,
      errorMessage: '子 agent 不存在或不属于当前伙伴'
    })
    expect(feedback).toMatchObject({ ok: false, error: '子 agent 不存在或不属于当前伙伴' })
  })
})
