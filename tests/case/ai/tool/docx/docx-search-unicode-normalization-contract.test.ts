import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-search-unicode-normalization-contract', async () => {
    await runBackendCase({
      caseId: 'docx-search-unicode-normalization-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 docx_search 会对兼容字形做归一化，普通查询与 regex 都可命中真实节点。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'unicode-normalization.docx', [
          {
            type: 'paragraph',
            text: '普通说明段落。'
          },
          {
            type: 'paragraph',
            text: '反⾛样会在采样频率不足时出现明显锯齿。'
          }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          const literal = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: path.join(runtime.workspaceRoot, 'unicode-normalization.docx'),
            query: '反走样'
          })
          const regex = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: path.join(runtime.workspaceRoot, 'unicode-normalization.docx'),
            query: '反走样',
            mode: 'regex'
          })

          return {
            literal,
            regex
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.literal.matches.length === 1 &&
            result.regex.matches.length === 1 &&
            result.literal.matches[0]?.nodeId === result.regex.matches[0]?.nodeId &&
            result.literal.matches[0]?.text.includes('反⾛样'),
          {
            name: 'docx-search-normalizes-compatibility-glyphs',
            message: 'literal / regex 搜索都应能用普通查询命中兼容字形文本。',
            data: result
          }
        )
      }
    })
  })
})
