import { MAX_CONCURRENT_SUBAGENTS } from '../../../../src/main/services/ai/constants'
import { describe, it, expect } from 'vitest'
import { assertToolAllowed, isToolAllowed } from '../../../../src/main/services/ai/run/toolPolicy'
import { acquireRunFile, releaseRunFiles } from '../../../../src/main/services/ai/run/fileLease'
import { DELEGATE_TO_SUBAGENT_SCHEMA } from '../../../../src/main/services/ai/human/tools/agentControl/toolSchemas'

describe('subagent policy and file leases', () => {
  it('denies nested dispatch, questions and scheduled management', () => {
    for (const tool of [
      'delegate_to_subagent',
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
  it('guards the configured task limit and short names', () => {
    expect(DELEGATE_TO_SUBAGENT_SCHEMA.safeParse({ tasks: [] }).success).toBe(false)
    expect(
      DELEGATE_TO_SUBAGENT_SCHEMA.safeParse({
        tasks: Array.from({ length: MAX_CONCURRENT_SUBAGENTS + 1 }, () => ({
          name: '海豹',
          task: '任务'
        }))
      }).success
    ).toBe(false)
    expect(
      DELEGATE_TO_SUBAGENT_SCHEMA.safeParse({ tasks: [{ name: '123456789', task: '任务' }] })
        .success
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
})
