import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTextFileToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { TEXT_FILE_SEARCH_CONTEXT_CHARS } from '../../../../../src/main/services/ai/human/tools/textFile/toolSpecs'

type SearchMatch = {
  line: number
  charOffset: number
  matchText: string
  textContext: string
  truncated: boolean
}

type SearchResult = {
  sourcePath: string
  totalMatchCount: number
  returnedMatchCount: number
  matches: SearchMatch[]
}

describe('ai tool text-file search backend', () => {
  it('text-file-search-contract', async () => {
    await runBackendCase({
      caseId: 'text-file-search-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['text-file'],
      description: '验证 text_file_search 的 literal/regex 命中位置（行号与全文件字符偏移）、单行超长日志的上下文裁剪、命中数上限和无效正则报错。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createTextFileToolHarness(runtime)

        const multiPath = path.join(runtime.workspaceRoot, 'search-target.txt')
        await fs.writeFile(
          multiPath,
          ['hello world', 'second hello here', '尾部 hello 结束'].join('\n'),
          'utf8'
        )
        const literalResult = await harness.invoke<SearchResult>('text_file_search', {
          sourcePath: multiPath,
          query: 'hello'
        })

        const regexResult = await harness.invoke<SearchResult>('text_file_search', {
          sourcePath: multiPath,
          query: 'h\\w+',
          mode: 'regex'
        })

        const emojiPath = path.join(runtime.workspaceRoot, 'emoji-search.txt')
        await fs.writeFile(emojiPath, 'a😀b hello', 'utf8')
        const emojiResult = await harness.invoke<SearchResult>('text_file_search', {
          sourcePath: emojiPath,
          query: 'hello'
        })

        const manyPath = path.join(runtime.workspaceRoot, 'many.txt')
        await fs.writeFile(manyPath, 'x\n'.repeat(50_000), 'utf8')
        const manyResult = await harness.invoke<SearchResult>('text_file_search', {
          sourcePath: manyPath,
          query: 'x'
        })

        const toolResultRoot = path.join(runtime.workspaceRoot, '.ncurator', 'runtime', 'toolresult')
        const logPath = path.join(toolResultRoot, 'run-1', 'big.log')
        const longLine = `${'x'.repeat(2_000)}TARGET_KEY${'y'.repeat(20_000)}`
        await fs.mkdir(path.dirname(logPath), { recursive: true })
        await fs.writeFile(logPath, longLine, 'utf8')
        const logResult = await harness.invoke<SearchResult>('text_file_search', {
          sourcePath: logPath,
          query: 'TARGET_KEY'
        })

        let invalidRegexError = ''
        try {
          await harness.invoke('text_file_search', {
            sourcePath: multiPath,
            query: '[',
            mode: 'regex'
          })
        } catch (error) {
          invalidRegexError = error instanceof Error ? error.message : String(error)
        }

        let noMatchResult: SearchResult
        try {
          noMatchResult = await harness.invoke<SearchResult>('text_file_search', {
            sourcePath: multiPath,
            query: 'missing-keyword'
          })
        } catch {
          noMatchResult = { sourcePath: multiPath, totalMatchCount: -1, returnedMatchCount: -1, matches: [] }
        }

        return {
          literalResult,
          regexResult,
          emojiResult,
          manyResult,
          logResult,
          invalidRegexError,
          noMatchResult
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.literalResult.totalMatchCount === 3 &&
            result.literalResult.returnedMatchCount === 3 &&
            result.literalResult.matches[0].line === 1 &&
            result.literalResult.matches[0].charOffset === 1 &&
            result.literalResult.matches[0].textContext === 'hello world' &&
            !result.literalResult.matches[0].truncated &&
            result.literalResult.matches[1].line === 2 &&
            result.literalResult.matches[1].charOffset === 20 &&
            result.literalResult.matches[2].line === 3 &&
            result.regexResult.totalMatchCount === 4 &&
            result.regexResult.matches[0].matchText === 'hello' &&
            result.regexResult.matches[1].matchText === 'hello' &&
            result.regexResult.matches[2].matchText === 'here' &&
            result.regexResult.matches[2].line === 2 &&
            result.regexResult.matches[3].matchText === 'hello' &&
            result.emojiResult.matches[0].charOffset === 5 &&
            result.emojiResult.matches[0].line === 1 &&
            result.manyResult.totalMatchCount === 50_000 &&
            result.manyResult.returnedMatchCount === 10 &&
            result.manyResult.matches.length === 10 &&
            result.logResult.totalMatchCount === 1 &&
            result.logResult.matches[0].line === 1 &&
            result.logResult.matches[0].charOffset === 2_001 &&
            result.logResult.matches[0].matchText === 'TARGET_KEY' &&
            result.logResult.matches[0].textContext.length <= TEXT_FILE_SEARCH_CONTEXT_CHARS &&
            result.logResult.matches[0].truncated &&
            result.logResult.matches[0].textContext.includes('TARGET_KEY') &&
            result.invalidRegexError.includes('正则表达式无效') &&
            result.noMatchResult.totalMatchCount === 0 &&
            result.noMatchResult.returnedMatchCount === 0 &&
            result.noMatchResult.matches.length === 0,
          {
            name: 'text-file-search-position-and-clipping',
            message: '搜索应返回准确的行号与全文件字符偏移（Unicode 码点对齐），单行超长日志应裁剪上下文并标记 truncated，匹配数上限与无效正则行为正确。',
            data: {
              literalResult: result.literalResult,
              emojiResult: result.emojiResult,
              logResult: result.logResult
            }
          }
        )
      }
    })
  })
})
