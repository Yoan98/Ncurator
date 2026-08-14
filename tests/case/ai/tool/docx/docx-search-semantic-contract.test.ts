import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-search-semantic-contract', async () => {
    await runBackendCase({
      caseId: 'docx-search-semantic-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 semantic 搜索能返回相关 block，且结果带 score。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.ensureEmbeddingReady()
        await writeTestDocxFile(runtime.workspaceRoot, 'semantic-search.docx', [
          {
            type: 'paragraph',
            text: '反走样通过在像素边缘增加多个采样点来减轻锯齿。'
          },
          {
            type: 'paragraph',
            text: '这一段与图形学无关。'
          }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          return await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: path.join(runtime.workspaceRoot, 'semantic-search.docx'),
            query: '像素边缘锯齿怎么减轻',
            mode: 'semantic'
          })
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.mode === 'semantic' &&
            result.matches.length >= 1 &&
            result.matches[0]?.text.includes('多个采样点') &&
            typeof result.matches[0]?.score === 'number',
          {
            name: 'semantic-search-returns-scored-relevant-blocks',
            message: 'semantic 搜索应返回相关 block，并显式暴露相关度 score。',
            data: result
          }
        )
      }
    })
  })
})
