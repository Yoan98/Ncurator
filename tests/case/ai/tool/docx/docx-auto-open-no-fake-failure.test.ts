import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { AiRunEvent } from '../../../../../src/shared/types'
import type { DocxSearchResult } from './testUtils'

const filterToolResults = (events: readonly AiRunEvent[], toolName: string) =>
  events.filter(
    (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
      event.type === 'tool_call_result' && event.toolName === toolName
  )

describe('ai tool docx backend', () => {
  it('docx-auto-open-no-fake-failure', async () => {
    await runBackendCase({
      caseId: 'docx-auto-open-no-fake-failure',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description:
        '验证首次自动 open 后的 AI-facing 读取工具不会再先发 must be opened before 的假失败。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'auto-open.docx', [
          {
            type: 'paragraph',
            text: '自动打开后直接搜索。'
          }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const searchResult = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: path.join(runtime.workspaceRoot, 'auto-open.docx'),
            query: '自动打开'
          })
          return {
            searchResult,
            events: runtime.eventCollector.snapshot()
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const toolResults = filterToolResults(result.events, 'docx_search')

        runtime.assertThat(
          result.searchResult.matches.length === 1 &&
            toolResults.length === 1 &&
            !JSON.stringify(toolResults[0]).includes('must be opened before'),
          {
            name: 'auto-open-no-longer-emits-fake-preopen-failure',
            message: 'AI-facing 搜索工具首次自动 open 时，不应再出现“先失败后成功”的双结果噪音。',
            data: {
              searchResult: result.searchResult,
              toolResults
            }
          }
        )
      }
    })
  })
})
