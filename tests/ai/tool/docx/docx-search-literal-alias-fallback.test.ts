import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxSearchResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-search-literal-alias-fallback', async () => {
    await runBackendCase({
      caseId: 'docx-search-literal-alias-fallback',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 literal 搜索 0 命中时会触发有限 alias fallback，并命中“过度拟合”内容。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'alias-fallback.docx', [
          {
            type: 'paragraph',
            text: '模型在训练时间过久时容易出现过度拟合。'
          }
        ])

        const harness = createDocxToolHarness(runtime)
        try {
          return await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'alias-fallback.docx',
            query: '过拟合'
          })
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.matches.length === 1 &&
            result.effectiveQuery === '过度拟合' &&
            result.appliedAliases.length === 1 &&
            result.appliedAliases[0]?.from === '过拟合' &&
            result.appliedAliases[0]?.to === '过度拟合',
          {
            name: 'literal-search-can-fallback-to-stable-alias',
            message: 'literal 搜索 0 命中后，应通过稳定 alias fallback 命中真实 block。',
            data: result
          }
        )
      }
    })
  })
})
