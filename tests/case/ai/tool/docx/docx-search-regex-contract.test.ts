import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxFailureResult, DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-search-regex-contract', async () => {
    await runBackendCase({
      caseId: 'docx-search-regex-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 regex 搜索可用，且非法 regex 会稳定报 invalid_input。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'regex-search.docx', [
          {
            type: 'paragraph',
            text: '反走样通过多个采样点来减轻边缘锯齿。'
          }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          return {
            valid: await harness.invoke<DocxSearchResult>('docx_search', {
              sourcePath: 'regex-search.docx',
              query: '反.*样',
              mode: 'regex'
            }),
            invalid: await harness.invoke<DocxFailureResult>('docx_search', {
              sourcePath: 'regex-search.docx',
              query: '反(',
              mode: 'regex'
            })
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.valid.matches.length === 1 &&
            result.valid.matches[0]?.offsets?.length === 1 &&
            result.invalid.error.length > 0 &&
            result.invalid.error.includes('invalid regex pattern'),
          {
            name: 'regex-search-stays-stable-for-valid-and-invalid-patterns',
            message: 'regex 搜索应能稳定命中，非法模式则应直接返回 invalid_input。',
            data: result
          }
        )
      }
    })
  })
})
