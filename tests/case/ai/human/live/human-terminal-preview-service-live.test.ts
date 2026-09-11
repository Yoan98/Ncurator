import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

const PAGE_MARKER = 'NCURATOR_PREVIEW_SERVICE_OK'

const allocatePort = async (): Promise<number> => {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法分配测试端口')
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return address.port
}

const canFetch = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
    await response.arrayBuffer()
    return response.ok
  } catch {
    return false
  }
}

const isWaitLikeCommand = (command: string): boolean => {
  if (/\bStart-Sleep\b/i.test(command)) return true
  if (/\btimeout(\s+\/t)?\s+\d+/i.test(command)) return true
  if (/\bsleep\s+\d/i.test(command)) return true
  if (/\bpython3?\b[\s\S]*\btime\.sleep\b/i.test(command)) return true
  if (/\bping\s+(-n|-c)\s+\d+/i.test(command)) return true
  return false
}

describe('ai human live terminal backend', () => {
  it('human-terminal-preview-service-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-terminal-preview-service-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证真实模型启动临时预览服务、确认页面标记并在完成后关闭服务（允许前台长跑或后台分离路径）。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const previewDirectory = path.join(runtime.workspaceRoot, 'preview-site')
          await fs.mkdir(previewDirectory, { recursive: true })
          await fs.writeFile(
            path.join(previewDirectory, 'index.html'),
            `<!doctype html><title>Preview</title><main>${PAGE_MARKER}</main>`,
            'utf8'
          )
          const port = await allocatePort()
          const url = `http://127.0.0.1:${String(port)}/`
          const output = await createHumanTestRunner(runtime).run({
            taskId: runtime.taskId,
            userInput: `请进入 preview-site 启动一个监听 127.0.0.1:${String(port)} 的临时 HTTP 预览服务，真实访问 ${url} 确认页面标记，确认服务收到了访问请求，然后关闭服务。完成后告诉我看到的页面标记。`
          })
          const events = runtime.eventCollector.snapshot()
          return {
            output,
            events,
            serviceStillReachable: await canFetch(url)
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const results = filterAiRunEventsByType(result.events, 'tool_call_result')
          const yielded = result.events.some((event) => event.type === 'terminal_command_yielded')
          const toolNames = starts.map((event) => event.toolName)
          const terminalCommands = starts
            .filter((event) => event.toolName === 'terminal_run')
            .map((event) => String((event.input as { command?: string } | undefined)?.command || ''))
          const hasWaitLike = terminalCommands.some((command) => isWaitLikeCommand(command))
          const hasRunningResult = results.some(
            (event) =>
              event.toolName === 'terminal_run' &&
              event.result?.ok === true &&
              (event.result.data as { status?: string } | undefined)?.status === 'running'
          )
          const hasSuccessfulRead = results.some(
            (event) => event.toolName === 'terminal_read' && event.result?.ok === true
          )
          const toolSawMarker = results.some((event) =>
            JSON.stringify(event.result || {}).includes(PAGE_MARKER)
          )
          const markerDelivered =
            result.output.deliveryMarkdown.includes(PAGE_MARKER) || toolSawMarker
          const foregroundPath =
            (yielded || hasRunningResult) && (hasSuccessfulRead || toolSawMarker)
          const detachedWaitPath = hasWaitLike && markerDelivered
          const pathCovered = foregroundPath || detachedWaitPath

          runtime.assertThat(
            result.output.status === 'completed' &&
              toolNames.includes('terminal_run') &&
              markerDelivered &&
              pathCovered &&
              !result.serviceStillReachable,
            {
              name: 'human-terminal-preview-service-is-inspected-and-stopped',
              message:
                '真实模型应启动预览服务、确认页面标记并关闭服务；允许前台 yield/读终端或后台分离后等待再确认。',
              data: {
                toolNames,
                terminalCommands,
                yielded,
                hasRunningResult,
                hasSuccessfulRead,
                hasWaitLike,
                toolSawMarker,
                foregroundPath,
                detachedWaitPath,
                finalAnswer: result.output.deliveryMarkdown,
                serviceStillReachable: result.serviceStillReachable
              }
            }
          )
        }
      })
    })
  })
})
