import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  IngestionService,
  isSupportedLocalFilePath
} from '../../../../src/main/services/ingestion/loader'
import {
  buildWorkspaceKnowledgeSplitSnapshot,
  computeWorkspaceFileContentHash
} from '../../../../src/main/services/workspace/utils/knowledge'
import { handleWorkspacePrepareWorkerRequest } from '../../../../src/main/services/workspace/worker/workspacePrepareWorker'
import type { WorkspacePrepareWorkerRequest } from '../../../../src/main/services/workspace/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('knowledge workspace backend', () => {
  it('workspace-index-worker-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-index-worker-contract',
      harnessMode: 'tool-real',
      domain: 'knowledge',
      suite: 'foundation',
      description: '真实文件经 workspace worker handler 解析并复用真实切分缓存。',
      fixtures: ['tests/fixtures/workspace'],
      runMode: 'single',
      execute: async (runtime) => {
        const workerFilePath = path.join(runtime.workspaceRoot, '学习笔记', '深度学习.docx')
        const workerRequest: WorkspacePrepareWorkerRequest = {
          requestId: 'worker-contract-docx',
          action: 'prepare_source',
          payload: { filePath: workerFilePath }
        }
        const workerSuccess = await handleWorkspacePrepareWorkerRequest(workerRequest)
        const pdfFilePath = path.join(runtime.workspaceRoot, '学习笔记', '深度学习.pdf')
        const pdfContentHash = await computeWorkspaceFileContentHash(pdfFilePath)
        const pdfSplitSnapshot = await buildWorkspaceKnowledgeSplitSnapshot({
          ingestionService: IngestionService.getInstance(),
          filePath: pdfFilePath,
          contentHash: pdfContentHash,
          fileExt: '.pdf'
        })
        const markdownFilePath = path.join(runtime.workspaceRoot, 'indexed-notes.md')
        await fs.writeFile(
          markdownFilePath,
          [
            '# Indexed Markdown Notes',
            '',
            'Unique markdown vector marker: cedar-md-index-118.',
            '',
            '- searchable markdown item'
          ].join('\n'),
          'utf8'
        )
        const markdownContentHash = await computeWorkspaceFileContentHash(markdownFilePath)
        const markdownSplitSnapshot = await buildWorkspaceKnowledgeSplitSnapshot({
          ingestionService: IngestionService.getInstance(),
          filePath: markdownFilePath,
          contentHash: markdownContentHash,
          fileExt: '.md'
        })
        const textFilePath = path.join(runtime.workspaceRoot, 'indexed-notes.txt')
        await fs.writeFile(
          textFilePath,
          'Unique plain text vector marker: cedar-txt-index-219.\nSecond text line.',
          'utf8'
        )
        const textContentHash = await computeWorkspaceFileContentHash(textFilePath)
        const textSplitSnapshot = await buildWorkspaceKnowledgeSplitSnapshot({
          ingestionService: IngestionService.getInstance(),
          filePath: textFilePath,
          contentHash: textContentHash,
          fileExt: '.txt'
        })
        const xlsxFilePath = path.join(runtime.workspaceRoot, '销售额统计表.xlsx')
        const xlsxWorkerSuccess = await handleWorkspacePrepareWorkerRequest({
          requestId: 'worker-contract-xlsx-success',
          action: 'prepare_source',
          payload: {
            filePath: xlsxFilePath
          }
        })
        const legacyDocPath = path.join(
          runtime.workspaceRoot,
          '长江干线（江苏段）大型船舶通航安全风险分级管控办法（初稿）.doc'
        )
        const legacyDocContentHash = await computeWorkspaceFileContentHash(legacyDocPath)
        const legacyDocSplitSnapshot = await buildWorkspaceKnowledgeSplitSnapshot({
          ingestionService: IngestionService.getInstance(),
          filePath: legacyDocPath,
          contentHash: legacyDocContentHash,
          fileExt: '.doc'
        })
        const markdownWorkerSuccess = await handleWorkspacePrepareWorkerRequest({
          requestId: 'worker-contract-markdown-success',
          action: 'prepare_source',
          payload: {
            filePath: markdownFilePath,
            cachedSplit: markdownSplitSnapshot
          }
        })
        const emptyTextFilePath = path.join(runtime.workspaceRoot, 'empty-notes.txt')
        await fs.writeFile(emptyTextFilePath, ' \n\t', 'utf8')
        const emptyTextWorkerSuccess = await handleWorkspacePrepareWorkerRequest({
          requestId: 'worker-contract-empty-text-success',
          action: 'prepare_source',
          payload: {
            filePath: emptyTextFilePath
          }
        })
        const pdfWorkerSuccess = await handleWorkspacePrepareWorkerRequest({
          requestId: 'worker-contract-pdf-success',
          action: 'prepare_source',
          payload: {
            filePath: pdfFilePath,
            cachedSplit: pdfSplitSnapshot
          }
        })
        const legacyDocWorkerSuccess = await handleWorkspacePrepareWorkerRequest({
          requestId: 'worker-contract-legacy-doc-success',
          action: 'prepare_source',
          payload: {
            filePath: legacyDocPath,
            cachedSplit: legacyDocSplitSnapshot
          }
        })
        const workerFailure = await handleWorkspacePrepareWorkerRequest({
          action: 'prepare_source',
          requestId: 'worker-contract-error',
          payload: {
            filePath: path.join(runtime.workspaceRoot, 'unsupported.js')
          }
        })

        return {
          textFileSupport: {
            md: isSupportedLocalFilePath(markdownFilePath),
            markdown: isSupportedLocalFilePath(path.join(runtime.workspaceRoot, 'notes.markdown')),
            txt: isSupportedLocalFilePath(textFilePath),
            doc: isSupportedLocalFilePath(legacyDocPath),
            xlsx: isSupportedLocalFilePath(xlsxFilePath),
            js: isSupportedLocalFilePath(path.join(runtime.workspaceRoot, 'unsupported.js'))
          },
          markdownSplitSnapshot,
          textSplitSnapshot,
          legacyDocSplitSnapshot,
          xlsxWorkerSuccess,
          markdownWorkerSuccess,
          emptyTextWorkerSuccess,
          workerSuccess,
          pdfWorkerSuccess,
          legacyDocWorkerSuccess,
          workerFailure,
          pdfSplitSnapshot
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.textFileSupport.md &&
            result.textFileSupport.markdown &&
            result.textFileSupport.txt &&
            result.textFileSupport.doc &&
            result.textFileSupport.xlsx &&
            !result.textFileSupport.js,
          {
            name: 'text-file-extensions-supported-for-index',
            message:
              'workspace 文件索引应支持 .md/.markdown/.txt，并继续拒绝无关脚本文件；excel 只索引元数据。',
            data: result
          }
        )

        runtime.assertThat(
          result.legacyDocSplitSnapshot.chunks.some((chunk) => chunk.text.includes('通航安全风险')),
          {
            name: 'legacy-doc-file-produces-searchable-split-chunks',
            message:
              'workspace fixture 中的 legacy .doc 应被 word-extractor 读取并切分为索引 chunk',
            data: result.legacyDocSplitSnapshot
          }
        )

        runtime.assertThat(
          result.markdownSplitSnapshot.chunks.some((chunk) =>
            chunk.text.includes('cedar-md-index-118')
          ) &&
            result.markdownSplitSnapshot.chunks[0].text === 'indexed-notes.md' &&
            result.textSplitSnapshot.chunks.some((chunk) =>
              chunk.text.includes('cedar-txt-index-219')
            ) &&
            result.textSplitSnapshot.chunks[0].text === 'indexed-notes.txt',
          {
            name: 'text-files-produce-searchable-split-chunks',
            message:
              'md/txt 文本文件应通过 UTF-8 读取进入现有 splitter，生成可检索 chunk，并前置文件名锚点 chunk。',
            data: result
          }
        )

        runtime.assertThat(
          result.markdownWorkerSuccess.ok &&
            result.markdownWorkerSuccess.payload?.fileExt === '.md' &&
            result.markdownWorkerSuccess.payload.splitSnapshot.chunks.length > 0 &&
            result.markdownWorkerSuccess.payload.splitSnapshot.chunks.some((chunk) =>
              chunk.text.includes('cedar-md-index-118')
            ),
          {
            name: 'worker-markdown-success-uses-text-loader',
            message: 'workspace worker 应能处理 markdown 文件，并返回可写入本地索引的 chunk。',
            data: result
          }
        )

        runtime.assertThat(
          result.emptyTextWorkerSuccess.ok &&
            result.emptyTextWorkerSuccess.payload?.fileExt === '.txt' &&
            result.emptyTextWorkerSuccess.payload.splitSnapshot.chunks.length === 1 &&
            result.emptyTextWorkerSuccess.payload.splitSnapshot.chunks[0].text ===
              'empty-notes.txt',
          {
            name: 'empty-text-file-keeps-filename-anchor-chunk',
            message:
              '空 md/txt 不产生正文 chunk，但保留文件名锚点 chunk，保证空文件仍可按文件名被检索。',
            data: result
          }
        )

        runtime.assertThat(
          result.workerSuccess.ok &&
            (result.workerSuccess.payload?.splitSnapshot.chunks.length ?? 0) > 1,
          {
            name: 'worker-success-returns-main-process-split-payload',
            message: 'worker 成功时只返回 split chunks，向量推理由独立 embedding runtime 负责。',
            data: result
          }
        )

        runtime.assertThat(
          result.pdfWorkerSuccess.ok &&
            result.pdfWorkerSuccess.payload?.fileExt === '.pdf' &&
            JSON.stringify(result.pdfWorkerSuccess.payload.splitSnapshot) ===
              JSON.stringify(result.pdfSplitSnapshot) &&
            result.pdfWorkerSuccess.payload.splitSnapshot.chunks.length > 1 &&
            result.pdfWorkerSuccess.payload.splitSnapshot.chunks.some((chunk) =>
              chunk.text.includes('深度学习')
            ),
          {
            name: 'worker-pdf-success-uses-supported-loader-version',
            message:
              'workspace worker 应能解析共享 workspace fixture 中的 PDF，并返回可写入本地索引的 chunk，对齐 SET-WORKSPACE-004-AC1。',
            data: result
          }
        )

        runtime.assertThat(
          result.legacyDocWorkerSuccess.ok &&
            result.legacyDocWorkerSuccess.payload?.fileExt === '.doc' &&
            result.legacyDocWorkerSuccess.payload.splitSnapshot.chunks.some((chunk) =>
              chunk.text.includes('通航安全风险')
            ),
          {
            name: 'worker-legacy-doc-success-uses-text-loader',
            message: 'workspace worker should index legacy .doc fixture files',
            data: result.legacyDocWorkerSuccess
          }
        )

        runtime.assertThat(
          result.xlsxWorkerSuccess.ok &&
            result.xlsxWorkerSuccess.payload?.fileExt === '.xlsx' &&
            result.xlsxWorkerSuccess.payload.splitSnapshot.chunks.length === 1 &&
            result.xlsxWorkerSuccess.payload.splitSnapshot.chunks[0].text.includes(
              '销售额统计表.xlsx'
            ) &&
            result.xlsxWorkerSuccess.payload.splitSnapshot.chunks[0].text.includes(
              '2026年度销售汇总'
            ) &&
            result.xlsxWorkerSuccess.payload.splitSnapshot.chunks[0].text.includes('季度销售') &&
            result.xlsxWorkerSuccess.payload.splitSnapshot.chunks[0].text.includes('客户明细') &&
            result.xlsxWorkerSuccess.payload.splitSnapshot.chunks[0].text.includes('产品&分类') &&
            !result.xlsxWorkerSuccess.payload.splitSnapshot.chunks[0].text.includes(
              'cedar-xlsx-cell-secret'
            ) &&
            !result.xlsxWorkerSuccess.payload.splitSnapshot.chunks[0].text.includes(
              'cedar-xlsx-sheet-secret'
            ) &&
            !result.xlsxWorkerSuccess.payload.splitSnapshot.chunks[0].text.includes(
              'cedar-xlsx-category-secret'
            ),
          {
            name: 'worker-xlsx-success-indexes-metadata-only',
            message:
              'workspace worker 应只索引 excel 的文件名、标题和工作表名元数据，不索引任何单元格内容。',
            data: result.xlsxWorkerSuccess
          }
        )

        runtime.assertThat(
          !result.workerFailure.ok &&
            result.workerFailure.error?.includes('Unsupported file type') === true,
          {
            name: 'worker-js-error-becomes-file-level-failure-response',
            message:
              'worker 内 JS 错误应返回 ok=false，让 main process 把当前文件收敛为 failed 并继续后续文件。',
            data: result
          }
        )
      }
    })
  })
})
