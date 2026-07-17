import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  loadLiveLlmConfigFromEnv,
  hasLiveLlmConfigInEnv
} from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, runWithStructuredOutputRetry } from '../testUtils'

describe('ai human live backend', () => {
  it('human-text-file-read-write-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-text-file-read-write-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证 live 模型会读取代码文件，使用 replaceAll 和唯一 edit，并回读确认结果。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: hasLiveLlmConfigInEnv() ? loadLiveLlmConfigFromEnv().model_name : null,
        execute: async (runtime) => {
          if (!hasLiveLlmConfigInEnv()) {
            return { skipped: true, output: null, events: [], finalContent: '' }
          }

          const sourcePath = path.join(runtime.workspaceRoot, 'config.ts')
          await fs.writeFile(
            sourcePath,
            [
              'const OLD_API_URL = "https://api.example.com"',
              'const timeout = 1000',
              'export const endpoint = OLD_API_URL'
            ].join('\n'),
            'utf-8'
          )
          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const runner = createHumanTestRunner(runtime, {
            allowedToolNames: ['text_file_read', 'text_file_edit']
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput:
              '请直接修改 config.ts：用 replaceAll 把所有 OLD_API_URL 改成 API_BASE_URL，再把唯一的 const timeout = 1000 精确改成 const timeout = 3000。完成后读取文件确认。'
          })
          return {
            skipped: false,
            output,
            events: runtime.eventCollector.snapshot(),
            finalContent: await fs.readFile(sourcePath, 'utf-8')
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            runtime.assertThat(true, {
              name: 'live-config-not-provided',
              message: '未提供 live 模型配置，已跳过 human text-file live case。'
            })
            return
          }

          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const writes = starts.filter((event) => event.toolName === 'text_file_edit')
          const resultText = JSON.stringify(
            filterAiRunEventsByType(result.events, 'tool_call_result')
              .filter((event) => event.toolName === 'text_file_edit')
              .map((event) => event.result?.data)
          )
          runtime.assertThat(
            result.output?.status === 'completed' &&
              starts.some((event) => event.toolName === 'text_file_read') &&
              writes.some(
                (event) =>
                  event.input.action === 'replaceAll' &&
                  event.input.oldText === 'OLD_API_URL' &&
                  event.input.newText === 'API_BASE_URL'
              ) &&
              writes.some(
                (event) => event.input.action === 'edit' && Array.isArray(event.input.edits)
              ) &&
              !result.finalContent.includes('OLD_API_URL') &&
              result.finalContent.includes('API_BASE_URL') &&
              result.finalContent.includes('const timeout = 3000') &&
              !resultText.includes('previewPath') &&
              !resultText.includes('hunks') &&
              !resultText.includes('@@'),
            {
              name: 'human-live-text-file-read-write',
              message: 'live human 应使用文本工具完成全量替换和唯一编辑，写入结果中不得暴露 diff。',
              data: {
                writes: writes.map((event) => event.input),
                finalContent: result.finalContent,
                toolResults: resultText
              }
            }
          )
        }
      })
    })
  })
})
