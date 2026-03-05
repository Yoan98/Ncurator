import { randomUUID } from 'node:crypto'
import type { HumanTaskOutput } from '../../../src/shared/types'
import type { AiRunContext } from '../../../src/main/services/ai/types'
import { createHumanGraphRunner } from '../../../src/main/services/ai/graph/humanGraph'
import type { CaseAssertion } from './types'
import { EventCollector } from './eventCollector'
import { assertRequiredFixtures } from './fixtureGuard'
import { createTestAiRunContext } from './contextFactory'
import { loadLiveLlmConfigFromEnv } from './llmConfig'
import {
  cleanupWorkspace,
  copyFixturesIntoWorkspace,
  createIsolatedWorkspace,
  type FixtureCopy
} from './workspaceManager'
import { writeCaseReport } from './reporter'

type HumanLiveRuntime = {
  runId: string
  taskId: string
  workspaceRoot: string
  ctx: AiRunContext
  eventCollector: EventCollector
  assertions: CaseAssertion[]
}

export const runHumanLiveCase = async (input: {
  caseId: string
  description: string
  objective: string
  requiredFixtures: string[]
  fixtureCopies: FixtureCopy[]
  approvalPolicy?: 'auto-approve' | 'deny-medium-high' | 'deny-all'
  maxSteps?: number
  assert: (result: HumanTaskOutput, runtime: HumanLiveRuntime) => Promise<void>
}): Promise<void> => {
  const runId = randomUUID()
  const taskId = `task-${input.caseId}`
  const startedAt = Date.now()
  const notes: string[] = [input.description]
  const assertions: CaseAssertion[] = []
  const eventCollector = new EventCollector()
  let workspaceRoot = ''
  let status: 'passed' | 'failed' = 'passed'

  try {
    await assertRequiredFixtures(input.requiredFixtures)
    const liveConfig = loadLiveLlmConfigFromEnv()
    workspaceRoot = await createIsolatedWorkspace(input.caseId)
    await copyFixturesIntoWorkspace(workspaceRoot, input.fixtureCopies)

    const ctx = createTestAiRunContext({
      runId,
      workspaceRootPath: workspaceRoot,
      eventCollector,
      approvalPolicy: input.approvalPolicy || 'auto-approve',
      liveModelConfig: liveConfig
    })
    const runtime: HumanLiveRuntime = {
      runId,
      taskId,
      workspaceRoot,
      ctx,
      eventCollector,
      assertions
    }

    const runHumanTask = createHumanGraphRunner({
      ctx,
      maxSteps: input.maxSteps || 8
    })
    const result = await runHumanTask({
      taskId,
      objective: input.objective
    })

    await input.assert(result, runtime)
  } catch (error) {
    status = 'failed'
    notes.push(error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    const finishedAt = Date.now()
    await writeCaseReport({
      suite: 'human-live',
      caseId: input.caseId,
      runId,
      taskId,
      startedAt,
      finishedAt,
      status,
      assertions,
      events: eventCollector.snapshot(),
      analysis: {
        failure_category: status === 'passed' ? 'none' : 'human_live_execution_error',
        suspected_root_cause:
          status === 'passed'
            ? 'none'
            : '检查 human_step、tool_call_result 与 approval 事件序列',
        optimization_hints:
          status === 'passed'
            ? ['增加复杂目标以持续验证渐进式求解能力']
            : ['检查 LLM 配置与网络可用性', '检查 objective 是否明确可执行', '检查审批策略是否阻断关键步骤']
      },
      notes
    })
    if (workspaceRoot) {
      await cleanupWorkspace(workspaceRoot)
    }
  }
}
