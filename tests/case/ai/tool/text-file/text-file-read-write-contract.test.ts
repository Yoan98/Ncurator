import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { TextFileDiffArtifact } from '../../../../../src/shared/types'
import { createTextFileToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const replayDiff = (before: string, artifact: TextFileDiffArtifact): string => {
  const lines = before.length === 0 ? [] : before.split('\n')
  let lineOffset = 0
  for (const hunk of artifact.hunks) {
    const oldLineCount = hunk.lines.filter((line) => line.type !== 'add').length
    const nextLines = hunk.lines.filter((line) => line.type !== 'remove').map((line) => line.text)
    const start = hunk.oldStart - 1 + lineOffset
    lines.splice(start, oldLineCount, ...nextLines)
    lineOffset += nextLines.length - oldLineCount
  }
  return lines.join('\n')
}

describe('ai tool text-file backend', () => {
  it('text-file-read-write-contract', async () => {
    await runBackendCase({
      caseId: 'text-file-read-write-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['text-file'],
      description: '验证普通文本文件创建、范围读取、批量精确编辑、replaceAll、diff 和修改记录。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createTextFileToolHarness(runtime)
        const sourcePath = path.join(runtime.workspaceRoot, 'src', 'config.ts')
        const original = [
          'const OLD_API_URL = "https://a.example"',
          'const timeout = 1000',
          'const filler0 = 0',
          'const filler1 = 1',
          'const filler2 = 2',
          'const filler3 = 3',
          'const filler4 = 4',
          'const filler5 = 5',
          'const filler6 = 6',
          'const filler7 = 7',
          'export const fallback = OLD_API_URL',
          'const retries = 1'
        ].join('\n')
        await fs.mkdir(path.dirname(sourcePath), { recursive: true })
        await fs.writeFile(sourcePath, original, 'utf-8')
        const createResult = await harness.invoke<string>('file_write', {
          sourcePath: 'notes/generated.txt',
          action: 'create',
          content: 'generated\n'
        })
        const readResult = await harness.invoke<{
          content: string
          startLine: number
          endLine: number
          totalLines: number
        }>('file_read', {
          sourcePath: 'src/config.ts',
          startLine: 2,
          lineCount: 2
        })
        const editResult = await harness.invoke<string>('file_write', {
          sourcePath: 'src/config.ts',
          action: 'edit',
          edits: [
            { oldText: 'const timeout = 1000', newText: 'const timeout = 3000' },
            { oldText: 'const retries = 1', newText: 'const retries = 3' }
          ]
        })
        const replaceAllResult = await harness.invoke<string>('file_write', {
          sourcePath: 'src/config.ts',
          action: 'replaceAll',
          oldText: 'OLD_API_URL',
          newText: 'API_BASE_URL'
        })
        const finalContent = await fs.readFile(sourcePath, 'utf-8')
        const records = await harness.ctx.listFileChangeRecords({ runId: runtime.runId })
        const configRecord = records.find((record) => record.path === sourcePath)
        const artifact = configRecord?.previewPath
          ? (JSON.parse(
              await fs.readFile(configRecord.previewPath, 'utf-8')
            ) as TextFileDiffArtifact)
          : null
        const textFileArtifacts = runtime.eventCollector
          .snapshot()
          .filter((event) => event.type === 'file_artifact' && event.capability === 'text_file')
        const configApplyIds = textFileArtifacts
          .filter((event) => event.path === sourcePath)
          .map((event) => event.applyId)

        return {
          createResult,
          readResult,
          editResult,
          replaceAllResult,
          finalContent,
          recordCount: records.length,
          configCapability: configRecord?.capability,
          configChangeCount: configRecord?.changeCount,
          replayed: artifact ? replayDiff(original, artifact) : null,
          artifactVersion: artifact?.version,
          expandableAfterLines: artifact?.afterLines,
          hunkCount: artifact?.hunks.length,
          fileArtifactCount: textFileArtifacts.length,
          configApplyIds
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.createResult === 'Created file: notes/generated.txt.' &&
            result.readResult.content === 'const timeout = 1000\nconst filler0 = 0' &&
            result.readResult.startLine === 2 &&
            result.readResult.endLine === 3 &&
            result.readResult.totalLines === 12 &&
            result.editResult === 'Applied 2 edits to src/config.ts.' &&
            result.replaceAllResult === 'Replaced 2 occurrences in src/config.ts.' &&
            result.finalContent.includes('const API_BASE_URL') &&
            result.finalContent.includes('fallback = API_BASE_URL') &&
            result.finalContent.includes('timeout = 3000') &&
            result.finalContent.includes('retries = 3') &&
            result.recordCount === 2 &&
            result.configCapability === 'text_file' &&
            result.configChangeCount === 4 &&
            result.replayed === result.finalContent &&
            result.artifactVersion === 1 &&
            result.expandableAfterLines?.join('\n') === result.finalContent &&
            result.hunkCount === 2 &&
            result.fileArtifactCount === 3 &&
            result.configApplyIds.length === 2 &&
            new Set(result.configApplyIds).size === 1,
          {
            name: 'text-file-read-write-result-and-diff',
            message: '文本工具应返回约定结果、写入正确内容，并生成可重放的结构化 diff 修改记录。',
            data: result
          }
        )
      }
    })
  })

  it('text-file-atomic-guards-and-format-preservation', async () => {
    await runBackendCase({
      caseId: 'text-file-atomic-guards-and-format-preservation',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['text-file'],
      description: '验证多匹配保护、整批失败、replaceAll 非递归替换以及 BOM/CRLF 保持。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createTextFileToolHarness(runtime)
        const sourcePath = path.join(runtime.workspaceRoot, 'keywords.txt')
        const bom = Buffer.from([0xef, 0xbb, 0xbf])
        const originalBody = 'key=aa\r\nkey=aa\r\ntail=true\r\n'
        await fs.writeFile(sourcePath, Buffer.concat([bom, Buffer.from(originalBody)]))

        let duplicateError = ''
        try {
          await harness.invoke('file_write', {
            sourcePath: 'keywords.txt',
            action: 'edit',
            edits: [{ oldText: 'key=aa', newText: 'key=bb' }]
          })
        } catch (error) {
          duplicateError = error instanceof Error ? error.message : String(error)
        }
        const afterFailedEdit = await fs.readFile(sourcePath)
        const replaceResult = await harness.invoke<string>('file_write', {
          sourcePath: 'keywords.txt',
          action: 'replaceAll',
          oldText: 'aa',
          newText: 'aaa'
        })
        const afterReplace = await fs.readFile(sourcePath)
        let noMatchError = ''
        try {
          await harness.invoke('file_write', {
            sourcePath: 'keywords.txt',
            action: 'replaceAll',
            oldText: 'missing',
            newText: 'value'
          })
        } catch (error) {
          noMatchError = error instanceof Error ? error.message : String(error)
        }
        const afterNoMatch = await fs.readFile(sourcePath)
        const rewriteResult = await harness.invoke<string>('file_write', {
          sourcePath: 'keywords.txt',
          action: 'rewrite',
          content: 'first\nsecond\n'
        })
        const afterRewrite = await fs.readFile(sourcePath)

        return {
          duplicateError,
          unchangedAfterFailedEdit: afterFailedEdit.equals(
            Buffer.concat([bom, Buffer.from(originalBody)])
          ),
          replaceResult,
          hasBom: afterReplace.subarray(0, 3).equals(bom),
          preservedCrlf:
            afterReplace.subarray(3).toString('utf-8') === 'key=aaa\r\nkey=aaa\r\ntail=true\r\n',
          noMatchError,
          unchangedAfterNoMatch: afterNoMatch.equals(afterReplace),
          rewriteResult,
          rewritePreservedFormat:
            afterRewrite.subarray(0, 3).equals(bom) &&
            afterRewrite.subarray(3).toString('utf-8') === 'first\r\nsecond\r\n'
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.duplicateError.includes('Found 2 matches') &&
            result.unchangedAfterFailedEdit &&
            result.replaceResult === 'Replaced 2 occurrences in keywords.txt.' &&
            result.hasBom &&
            result.preservedCrlf &&
            result.noMatchError.includes('No matches found') &&
            result.unchangedAfterNoMatch &&
            result.rewriteResult === 'Rewrote file: keywords.txt.' &&
            result.rewritePreservedFormat,
          {
            name: 'text-file-atomic-guard-and-format-preservation',
            message: '歧义编辑和无匹配 replaceAll 应整批失败，成功替换不得递归并应保留 BOM/CRLF。',
            data: result
          }
        )
      }
    })
  })
})
