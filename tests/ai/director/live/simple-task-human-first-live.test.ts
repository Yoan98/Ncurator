import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createDirectorTestRunner } from '../../../harness/backend/directorHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  createRateLimitedLiveChatStructuredOverride,
  filterToolCallResultEventsByNames,
  HUMAN_LIVE_PRIMARY_MODEL,
  startLiveProgressLogger
} from '../../human/live/testUtils'
import { filterDirectorEventsByType, summarizeDirectorEvents } from '../testUtils'

const DIRECTOR_LIVE_ENABLED = String(process.env.AI_ENABLE_DIRECTOR_LIVE || '').trim() === '1'
const DIRECTOR_LIVE_MIN_INTERVAL_MS = (() => {
  const value = Number(process.env.NCURATOR_DIRECTOR_LIVE_MIN_INTERVAL_MS || '')
  return Number.isFinite(value) && value > 0 ? value : 30_000
})()
const liveIt = HUMAN_LIVE_PRIMARY_MODEL && DIRECTOR_LIVE_ENABLED ? it : it.skip

describe('ai director live backend', () => {
  liveIt('simple-task-human-first-live', async () => {
    await runBackendCase({
      caseId: 'simple-task-human-first-live',
      domain: 'ai',
      suite: 'director',
      groups: ['live'],
      description: '验证普通任务在真实 AI 调用下仍走 direct human，不进入 context 或 plan。',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: HUMAN_LIVE_PRIMARY_MODEL?.model_name ?? null,
      execute: async (runtime) => {
        await fs.writeFile(
          path.join(runtime.workspaceRoot, 'director-simple-live.txt'),
          [
            'Weekly risk summary: pending follow-up until compliance signs off.',
            'Owner note: Compliance leads the final review window.'
          ].join('\n'),
          'utf8'
        )

        const runner = createDirectorTestRunner(runtime, {
          chatStructuredOverride: HUMAN_LIVE_PRIMARY_MODEL
            ? createRateLimitedLiveChatStructuredOverride(
                HUMAN_LIVE_PRIMARY_MODEL,
                DIRECTOR_LIVE_MIN_INTERVAL_MS
              )
            : undefined,
          humanRuntimeOverrides: {
            hardActionLimit: 4
          }
        })

        const stopProgressLogger = startLiveProgressLogger({
          caseId: 'simple-task-human-first-live',
          snapshot: () => runtime.eventCollector.snapshot()
        })

        let output: Awaited<ReturnType<typeof runner.run>>
        try {
          output = await runner.run({
            userInput: [
              '请读取当前工作区里的 `director-simple-live.txt`，直接给我一个简短总结。',
              '这是一个单任务文档总结请求：只需要读取内容并输出最终答复，不要修改文件，也不要拆成多阶段计划。',
              '严格按这个顺序推进：先用一次只读 terminal 命令读取文件内容，然后直接交付。',
              '总结时保留风险总结和负责人说明两点即可。'
            ].join('\n')
          })
        } finally {
          stopProgressLogger()
        }

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const directorTaskStarted = filterDirectorEventsByType(result.events, 'task_started')
        const directorTaskCompleted = filterDirectorEventsByType(result.events, 'task_completed')
        const planCreatedEvents = filterDirectorEventsByType(result.events, 'plan_created')
        const terminalToolResults = filterToolCallResultEventsByNames(result.events, [
          'terminal_run_command'
        ])

        runtime.assertThat(
          result.output.status === 'completed' &&
            result.output.directorStage === 'director_complete' &&
            result.output.plan.length === 0 &&
            planCreatedEvents.length === 0 &&
            directorTaskStarted.length === 1 &&
            directorTaskStarted[0]?.taskId === 'direct-human' &&
            directorTaskStarted[0]?.stage === 'director_direct_human_exec' &&
            directorTaskCompleted.length === 1 &&
            directorTaskCompleted[0]?.taskId === 'direct-human',
          {
            name: 'director-live-simple-task-stays-human-first',
            message:
              'simple-task-human-first-live 应保持 direct human 默认路径，不进入 context 或 plan/synthesis 链路。',
            data: {
              directorEvents: summarizeDirectorEvents(result.events),
              planLength: result.output.plan.length,
              finalDeliveryMarkdown: result.output.finalDeliveryMarkdown
            }
          }
        )

        runtime.assertThat(
          terminalToolResults.length >= 1 &&
            result.output.finalDeliveryMarkdown?.trim().length !== 0 &&
            result.output.finalDeliveryMarkdown.includes('Compliance'),
          {
            name: 'director-live-simple-task-uses-a-single-document-summary-chain',
            message:
              'simple-task-human-first-live 应由 direct human 读取单个文档并完成最终总结，而不是升级为多阶段编排。',
            data: {
              terminalToolNames: terminalToolResults.map((event) => event.toolName),
              finalDeliveryMarkdown: result.output.finalDeliveryMarkdown
            }
          }
        )
      }
    })
  }, 420_000)
})
