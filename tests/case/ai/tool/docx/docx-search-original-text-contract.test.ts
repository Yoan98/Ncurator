import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-search-original-text-contract', async () => {
    await runBackendCase({
      caseId: 'docx-search-original-text-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 literal 与 regex 都搜索完整原文，不隐式改写 Unicode 字形。',
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
          const normalizedLiteral = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: path.join(runtime.workspaceRoot, 'unicode-normalization.docx'),
            query: '反走样'
          })
          const exactLiteral = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: path.join(runtime.workspaceRoot, 'unicode-normalization.docx'),
            query: '反⾛样'
          })

          return {
            normalizedLiteral,
            exactLiteral
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.normalizedLiteral.matches.length === 0 &&
            result.exactLiteral.matches.length === 1 &&
            result.exactLiteral.matches[0]?.matchText === '反⾛样',
          {
            name: 'docx-search-preserves-original-glyphs',
            message: 'DOCX 搜索必须只返回完整原文中的实际命中。',
            data: result
          }
        )
      }
    })
  })
})
