import net from 'node:net'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  collectWorkbenchAiRunEvents,
  decideWorkbenchApprovalBatch,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'terminal-background-service-flow'
const PAGE_MARKER = 'NCURATOR_TERMINAL_BACKGROUND_OK'

const reservePort = async (): Promise<number> =>
  await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })

const isApprovalRequired = (
  event: AiRunEvent
): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
  event.type === 'approval_batch_required'

describe('workbench terminal e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'run',
        groups: ['process'],
        description: '真实 AI 启动持久终端 HTTP 服务、让出控制权并用浏览器验证页面。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const setup = await setupWorkbenchWithTempWorkspace(runtime.page, {
            caseId: CASE_ID
          })
          const port = await reservePort()
          await fs.writeFile(
            path.join(setup.workspace.rootPath, 'terminal-service.html'),
            `<!doctype html><title>Terminal service</title><main>${PAGE_MARKER}</main>\n`
          )
          const startedAtMs = Date.now()
          const handledApprovals = new Set<string>()
          await sendWorkbenchMessage(
            runtime.page,
            `请使用终端启动 python3 -m http.server ${port} --bind 127.0.0.1，不要在命令末尾添加 &。服务开始运行后，用内置浏览器打开 http://127.0.0.1:${port}/terminal-service.html 并确认页面包含 ${PAGE_MARKER}。`
          )

          const deadline = Date.now() + WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
          let events: AiRunEvent[] = []
          for (;;) {
            events = await collectWorkbenchAiRunEvents(runtime)
            const approval = events
              .filter(isApprovalRequired)
              .find((event) => !handledApprovals.has(event.batchId))
            if (approval) {
              handledApprovals.add(approval.batchId)
              await decideWorkbenchApprovalBatch(runtime, runtime.page, {
                event: approval,
                action: 'approve'
              })
              continue
            }
            const failed = events.find((event) => event.type === 'run_failed')
            if (failed?.type === 'run_failed') throw new Error(failed.message)
            if (events.some((event) => event.type === 'run_completed')) break
            if (Date.now() >= deadline) throw new Error('terminal background flow timed out')
            await runtime.page.waitForTimeout(500)
          }

          const finalAnswerText =
            events
              .filter(
                (event): event is Extract<AiRunEvent, { type: 'answer_completed' }> =>
                  event.type === 'answer_completed'
              )
              .at(-1)?.text || ''
          recordWorkbenchAiEvidence(
            runtime,
            {
              modelName: setup.env.modelName,
              durationMs: Date.now() - startedAtMs,
              events,
              finalAnswerText
            },
            0.85
          )
          return {
            eventTypes: events.map((event) => event.type),
            toolNames: events
              .filter(
                (event): event is Extract<AiRunEvent, { type: 'tool_call_started' }> =>
                  event.type === 'tool_call_started'
              )
              .map((event) => event.toolName),
            finalAnswerText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.eventTypes.includes('terminal_command_yielded') &&
              result.toolNames.includes('terminal_run') &&
              result.toolNames.includes('browser_use') &&
              result.finalAnswerText.includes(PAGE_MARKER),
            {
              name: 'workbench-real-persistent-terminal-service-flow',
              message: '真实 AI 应通过终端启动服务、让出控制权并使用浏览器验证页面。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
