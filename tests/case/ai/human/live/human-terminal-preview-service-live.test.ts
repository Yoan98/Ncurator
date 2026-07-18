import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { describe, it } from 'vitest'
import { terminalSessionManager } from '../../../../../src/main/services/ai/human/tools/terminal/TerminalSessionManager'
import type { JsonObject, JsonValue } from '../../../../../src/shared/types'
import {
  hasLiveLlmConfigInEnv,
  loadLiveLlmConfigFromEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const CASE_ID = 'human-terminal-preview-service-live'
const SESSION_ID = 'human-terminal-preview-service-live-session'
const SITE_DIRECTORY = 'preview-site'
const PAGE_MARKER = 'NCURATOR_LIVE_PREVIEW_READY_731'

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

const isRecord = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const waitForUrlToBecomeUnavailable = async (url: string): Promise<boolean> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const unavailable = await fetch(url, { signal: AbortSignal.timeout(1_500) })
      .then(() => false)
      .catch(() => true)
    if (unavailable) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

describe('ai human live backend', () => {
  it(CASE_ID, async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: CASE_ID,
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证真实模型能在项目子目录启动临时预览服务、访问页面、读取服务日志并彻底停止服务。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return {
              skipped: true,
              output: null,
              events: [],
              portReleased: true,
              sessionsBeforeCleanup: []
            }
          }

          const sitePath = path.join(runtime.workspaceRoot, SITE_DIRECTORY)
          const port = await reservePort()
          const url = `http://127.0.0.1:${String(port)}/`
          await fs.mkdir(sitePath, { recursive: true })
          await fs.writeFile(
            path.join(sitePath, 'index.html'),
            `<!doctype html><title>Preview</title><main>${PAGE_MARKER}</main>\n`,
            'utf8'
          )
          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const runner = createHumanTestRunner(runtime, {
            sessionId: SESSION_ID,
            allowedToolNames: ['terminal_run', 'terminal_read', 'terminal_stop'],
            humanRuntimeOverrides: { hardActionLimit: 16 }
          })

          try {
            const output = await runner.run({
              taskId: runtime.taskId,
              userInput: `我准备检查 ${SITE_DIRECTORY} 里的静态页面。这个项目依赖相对路径，所以预览服务必须进入这个目录后再启动。请启动一个只监听 127.0.0.1:${String(port)} 的临时 HTTP 预览服务，访问首页并确认页面显示 ${PAGE_MARKER}。

服务必须由持久终端直接托管：请用 terminal_run 在前台直接运行服务命令，不要使用 Start-Process、Start-Job、尾部 & 或其他后台/分离进程方式。terminal_run 返回 command_still_running 后，请保存它返回的 terminalId；访问页面后，用同一个 terminalId 调用 terminal_read 查看新日志，确认服务确实收到了请求；最后用 terminal_stop 并设置 closeTerminal=true 停止服务和关闭终端。不要留下后台进程。`
            })
            const events = runtime.eventCollector.snapshot()
            const portReleased = await waitForUrlToBecomeUnavailable(url)
            const sessionsBeforeCleanup = terminalSessionManager.list({
              chatSessionId: SESSION_ID,
              workspaceId: 'test-workspace'
            })
            return {
              skipped: false,
              output,
              events,
              portReleased,
              sessionsBeforeCleanup
            }
          } finally {
            await terminalSessionManager.closeByChatSession(SESSION_ID)
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human terminal preview service live case。'
            })
            return
          }

          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const results = filterAiRunEventsByType(result.events, 'tool_call_result')
          const runResults = results
            .filter((event) => event.toolName === 'terminal_run' && isRecord(event.result?.data))
            .map((event) => event.result?.data)
            .filter(isRecord)
          const runningResult = runResults.find(
            (data) => data.executionStatus === 'running' && data.terminalStatus === 'running'
          )
          const serviceTerminalId =
            typeof runningResult?.terminalId === 'string' ? runningResult.terminalId : ''
          const commands = starts
            .filter((event) => event.toolName === 'terminal_run')
            .map((event) => event.input.command)
            .filter((value): value is string => typeof value === 'string')
          const readInputs = starts
            .filter((event) => event.toolName === 'terminal_read')
            .map((event) => event.input)
          const stopInputs = starts
            .filter((event) => event.toolName === 'terminal_stop')
            .map((event) => event.input)
          const resultText = JSON.stringify(results.map((event) => event.result?.data))
          const yielded = filterAiRunEventsByType(result.events, 'terminal_command_yielded')
          const stopped = filterAiRunEventsByType(result.events, 'terminal_command_stopped')
          const closed = filterAiRunEventsByType(result.events, 'terminal_session_closed')
          const serviceYielded = yielded.find((event) => event.terminalId === serviceTerminalId)
          const finalText = String(result.output?.deliveryMarkdown || '')

          runtime.assertThat(
            result.output?.status === 'completed' &&
              Boolean(serviceTerminalId) &&
              typeof serviceYielded?.currentTerminalPath === 'string' &&
              serviceYielded.currentTerminalPath.endsWith(`${path.sep}${SITE_DIRECTORY}`) &&
              commands.every((command) => !/(^|[^&])&\s*$/u.test(command)) &&
              Boolean(serviceYielded),
            {
              name: 'human-live-terminal-starts-persistent-preview-service',
              message:
                'live human 应进入页面目录启动受持久终端管理的服务，并正确理解 command_still_running。',
              data: {
                commands,
                runningResult: runningResult || null,
                yieldedTerminalIds: yielded.map((event) => event.terminalId)
              }
            }
          )

          runtime.assertThat(
            readInputs.some((input) => input.terminalId === serviceTerminalId) &&
              stopInputs.some(
                (input) => input.terminalId === serviceTerminalId && input.closeTerminal === true
              ) &&
              stopped.some((event) => event.terminalId === serviceTerminalId) &&
              closed.some((event) => event.terminalId === serviceTerminalId) &&
              resultText.includes(PAGE_MARKER) &&
              finalText.includes(PAGE_MARKER) &&
              !resultText.includes('availableActions') &&
              !resultText.includes('commandId') &&
              result.portReleased &&
              !result.sessionsBeforeCleanup.some(
                (session) => session.terminalId === serviceTerminalId && session.status !== 'closed'
              ),
            {
              name: 'human-live-terminal-verifies-reads-and-cleans-preview-service',
              message:
                'live human 应真实访问页面、读取服务日志，并停止关闭服务终端且不暴露多余结果字段。',
              data: {
                readInputs,
                stopInputs,
                stoppedTerminalIds: stopped.map((event) => event.terminalId),
                closedTerminalIds: closed.map((event) => event.terminalId),
                portReleased: result.portReleased,
                sessionsBeforeCleanup: result.sessionsBeforeCleanup,
                finalText
              }
            }
          )
        }
      })
    })
  })
})
