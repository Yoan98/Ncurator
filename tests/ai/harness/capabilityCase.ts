import { randomUUID } from 'node:crypto'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import type { CaseAssertion } from './types'
import { EventCollector } from './eventCollector'
import { assertRequiredFixtures } from './fixtureGuard'
import { createTestAiRunContext } from './contextFactory'
import {
  cleanupWorkspace,
  copyFixturesIntoWorkspace,
  createIsolatedWorkspace,
  type FixtureCopy
} from './workspaceManager'
import { writeCaseReport } from './reporter'

type CapabilityCaseRuntime = {
  runId: string
  taskId: string
  workspaceRoot: string
  ctx: AiRunContext
  eventCollector: EventCollector
  assertions: CaseAssertion[]
}

export const runCapabilityCase = async <TResult>(input: {
  caseId: string
  description: string
  requiredFixtures: string[]
  fixtureCopies: FixtureCopy[]
  approvalPolicy?: 'auto-approve' | 'deny-medium-high' | 'deny-all'
  execute: (runtime: CapabilityCaseRuntime) => Promise<TResult>
  assert: (result: TResult, runtime: CapabilityCaseRuntime) => Promise<void>
}): Promise<void> => {
  const runId = randomUUID()
  const taskId = `task-${input.caseId}`
  const startedAt = Date.now()
  const notes: string[] = [input.description]
  const assertions: CaseAssertion[] = []
  const eventCollector = new EventCollector()
  let workspaceRoot = ''
  let status: 'passed' | 'failed' = 'passed'
  let reportDir = ''

  try {
    await assertRequiredFixtures(input.requiredFixtures)
    workspaceRoot = await createIsolatedWorkspace(input.caseId)
    await copyFixturesIntoWorkspace(workspaceRoot, input.fixtureCopies)
    const ctx = createTestAiRunContext({
      runId,
      workspaceRootPath: workspaceRoot,
      eventCollector,
      approvalPolicy: input.approvalPolicy || 'auto-approve'
    })
    const runtime: CapabilityCaseRuntime = {
      runId,
      taskId,
      workspaceRoot,
      ctx,
      eventCollector,
      assertions
    }

    const result = await input.execute(runtime)
    await input.assert(result, runtime)
  } catch (error) {
    status = 'failed'
    notes.push(error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    const finishedAt = Date.now()
    reportDir = await writeCaseReport({
      suite: 'capability',
      caseId: input.caseId,
      runId,
      taskId,
      startedAt,
      finishedAt,
      status,
      assertions,
      events: eventCollector.snapshot(),
      analysis: {
        failure_category: status === 'passed' ? 'none' : 'capability_execution_error',
        suspected_root_cause:
          status === 'passed'
            ? 'none'
            : '检查 assertions.json 与 events.jsonl 中的失败断言和事件链路',
        optimization_hints:
          status === 'passed'
            ? ['增加更多边界输入覆盖以持续提升稳定性']
            : ['检查前置 fixture 是否正确', '检查 tool 返回码与错误摘要', '检查事件流是否出现 workspace 或 approval 阻塞']
      },
      notes
    })
    notes.push(`report: ${reportDir}`)
    if (workspaceRoot) {
      await cleanupWorkspace(workspaceRoot)
    }
  }
}
