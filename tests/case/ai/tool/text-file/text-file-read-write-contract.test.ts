import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTextFileToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('ai tool text-file backend', () => {
  it('text-file-read-write-contract', async () => {
    await runBackendCase({
      caseId: 'text-file-read-write-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['text-file'],
      description: '验证普通文本文件创建、范围读取、批量精确编辑、replaceAll、diff、修改记录和保存时生成的 diff 预览。',
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
        const createResult = await harness.invoke<string>('text_file_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'notes', 'generated.txt'),
          action: 'create',
          content: 'generated\n'
        })
        const readResult = await harness.invoke<{
          content: string
          startLine: number
          endLine: number
          totalLines: number
        }>('text_file_read', {
          type: 'lines',
          sourcePath,
          startLine: 2,
          lineCount: 2
        })
        const editResult = await harness.invoke<string>('text_file_edit', {
          sourcePath,
          action: 'edit',
          edits: [
            { oldText: 'const timeout = 1000', newText: 'const timeout = 3000' },
            { oldText: 'const retries = 1', newText: 'const retries = 3' }
          ]
        })
        const replaceAllResult = await harness.invoke<string>('text_file_edit', {
          sourcePath,
          action: 'replaceAll',
          oldText: 'OLD_API_URL',
          newText: 'API_BASE_URL'
        })
        const finalContent = await fs.readFile(sourcePath, 'utf-8')
        const records = await harness.ctx.listFileChangeRecords({ runId: runtime.runId })
        const configRecord = records.find((record) => record.path === sourcePath)
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
          hasEagerPreview: Boolean(configRecord?.previewPath),
          fileArtifactCount: textFileArtifacts.length,
          configApplyIds
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.createResult ===
            `已创建文件：${path.join(runtime.workspaceRoot, 'notes', 'generated.txt')}。` &&
            result.readResult.content === 'const timeout = 1000\nconst filler0 = 0' &&
            result.readResult.startLine === 2 &&
            result.readResult.endLine === 3 &&
            result.readResult.totalLines === 12 &&
            result.editResult ===
              `已在 ${path.join(runtime.workspaceRoot, 'src', 'config.ts')} 中应用 2 处修改。` &&
            result.replaceAllResult ===
              `已在 ${path.join(runtime.workspaceRoot, 'src', 'config.ts')} 中替换 2 处内容。` &&
            result.finalContent.includes('const API_BASE_URL') &&
            result.finalContent.includes('fallback = API_BASE_URL') &&
            result.finalContent.includes('timeout = 3000') &&
            result.finalContent.includes('retries = 3') &&
            result.recordCount === 2 &&
            result.configCapability === 'text_file' &&
            result.configChangeCount === 8 &&
            result.hasEagerPreview === true &&
            result.fileArtifactCount === 3 &&
            result.configApplyIds.length === 2 &&
            new Set(result.configApplyIds).size === 1,
          {
            name: 'text-file-read-write-result-and-diff',
            message: '文本工具应写入正确内容并保存修改元数据，保存时即生成 diff 预览。',
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
          await harness.invoke('text_file_edit', {
            sourcePath: path.join(runtime.workspaceRoot, 'keywords.txt'),
            action: 'edit',
            edits: [{ oldText: 'key=aa', newText: 'key=bb' }]
          })
        } catch (error) {
          duplicateError = error instanceof Error ? error.message : String(error)
        }
        const afterFailedEdit = await fs.readFile(sourcePath)
        const replaceResult = await harness.invoke<string>('text_file_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'keywords.txt'),
          action: 'replaceAll',
          oldText: 'aa',
          newText: 'aaa'
        })
        const afterReplace = await fs.readFile(sourcePath)
        let noMatchError = ''
        try {
          await harness.invoke('text_file_edit', {
            sourcePath: path.join(runtime.workspaceRoot, 'keywords.txt'),
            action: 'replaceAll',
            oldText: 'missing',
            newText: 'value'
          })
        } catch (error) {
          noMatchError = error instanceof Error ? error.message : String(error)
        }
        const afterNoMatch = await fs.readFile(sourcePath)
        const rewriteResult = await harness.invoke<string>('text_file_edit', {
          sourcePath: path.join(runtime.workspaceRoot, 'keywords.txt'),
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
          result.duplicateError.includes('匹配到 2 处') &&
            result.unchangedAfterFailedEdit &&
            result.replaceResult ===
              `已在 ${path.join(runtime.workspaceRoot, 'keywords.txt')} 中替换 2 处内容。` &&
            result.hasBom &&
            result.preservedCrlf &&
            result.noMatchError.includes('找不到 oldText') &&
            result.unchangedAfterNoMatch &&
            result.rewriteResult ===
              `已完整改写文件：${path.join(runtime.workspaceRoot, 'keywords.txt')}。` &&
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
