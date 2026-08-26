import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-search-literal-contract', async () => {
    await runBackendCase({
      caseId: 'docx-search-literal-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 literal 只搜索完整原文，不做硬编码同义词改写。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'literal-search.docx', [
          { type: 'paragraph', text: '前置一。' },
          { type: 'paragraph', text: '前置二。' },
          {
            type: 'paragraph',
            text: `模型可能出现过度拟合，也可能再次出现过度拟合。${'上限词 '.repeat(12)}`
          },
          { type: 'paragraph', text: '后置一。' },
          { type: 'paragraph', text: '后置二。' }
        ])
        const harness = createDocxToolHarness(runtime)
        try {
          return {
            exact: await harness.invoke<DocxSearchResult>('docx_search', {
              sourcePath: path.join(runtime.workspaceRoot, 'literal-search.docx'),
              query: '过度拟合',
              includeContext: true
            }),
            different: await harness.invoke<DocxSearchResult>('docx_search', {
              sourcePath: path.join(runtime.workspaceRoot, 'literal-search.docx'),
              query: '过拟合'
            }),
            capped: await harness.invoke<DocxSearchResult>('docx_search', {
              sourcePath: path.join(runtime.workspaceRoot, 'literal-search.docx'),
              query: '上限词'
            })
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.exact.totalMatchCount === 2 &&
            result.exact.matches.length === 2 &&
            result.exact.matches[0]?.matchText === '过度拟合' &&
            result.exact.matches[0]?.before?.length === 2 &&
            result.exact.matches[0]?.after?.length === 2 &&
            result.exact.matches[0]?.before?.[0]?.textPreview === '前置一。' &&
            result.exact.matches[0]?.after?.[1]?.textPreview === '后置二。' &&
            result.different.totalMatchCount === 0 &&
            result.capped.totalMatchCount === 12 &&
            result.capped.matches.length === 10,
          {
            name: 'literal-search-does-not-rewrite-query',
            message: 'literal 搜索必须只返回原文中的实际命中。',
            data: result
          }
        )
      }
    })
  })
})
