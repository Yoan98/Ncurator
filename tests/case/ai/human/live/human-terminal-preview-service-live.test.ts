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

describe('ai human live terminal backend', () => {
  it('human-terminal-preview-service-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-terminal-preview-service-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证真实模型启动临时预览服务、读取请求日志并在完成后关闭服务。',
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
            userInput: `请进入 preview-site 启动一个监听 127.0.0.1:${String(port)} 的临时 HTTP 预览服务，真实访问 ${url} 确认页面标记，读取终端中的请求日志，然后关闭服务。完成后告诉我看到的页面标记。`
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
          const toolNames = starts.map((event) => event.toolName)
          runtime.assertThat(
            result.output.status === 'completed' &&
              toolNames.includes('terminal_run') &&
              toolNames.includes('terminal_read') &&
              results.some(
                (event) => event.toolName === 'terminal_read' && event.result?.ok === true
              ) &&
              result.output.deliveryMarkdown.includes(PAGE_MARKER) &&
              !result.serviceStillReachable,
            {
              name: 'human-terminal-preview-service-is-inspected-and-stopped',
              message: '真实模型应启动预览服务、读取请求日志、交付页面标记并关闭服务。',
              data: {
                toolNames,
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
