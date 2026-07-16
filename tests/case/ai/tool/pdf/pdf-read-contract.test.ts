import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createPdfToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const PDF_FIXTURE = path.resolve('tests/fixtures/workspace/学习笔记/深度学习.pdf')

type PdfFailure = { ok: false; error: string; reason: string }
type PdfInspectResult = {
  sourcePath: string
  pageCount: number
  metadata: { title?: string }
  warnings: string[]
}
type PdfReadResult = {
  sourcePath: string
  pageCount: number
  pages: Array<{
    pageNumber: number
    text: string
    textStatus: 'available' | 'empty' | 'suspicious'
    imageCount: number
  }>
}
type PdfSearchResult = {
  totalMatchCount: number
  returnedMatchCount: number
  matches: Array<{ pageNumber: number; matchedText: string; snippet: string }>
}
type PdfRenderResult = {
  sourcePath: string
  pageCount: number
  assetBucketId: string
  images: Array<{
    pageNumber: number
    path: string
    mimeType: 'image/png'
    width: number
    height: number
  }>
}

const sha256 = async (filePath: string): Promise<string> =>
  createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex')

describe('ai tool pdf backend', () => {
  it('pdf-inspect-read-search-contract', async () => {
    await runBackendCase({
      caseId: 'pdf-inspect-read-search-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['pdf'],
      description: '验证真实 PDF 的元数据、页级正文和搜索结果可稳定读取。',
      fixtures: [PDF_FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = runtime.getFixtureWorkspacePath(PDF_FIXTURE)
        const harness = createPdfToolHarness(runtime)
        try {
          const inspect = await harness.invoke<PdfInspectResult>('pdf_inspect', { sourcePath })
          const read = await harness.invoke<PdfReadResult>('pdf_read_pages', {
            sourcePath,
            selection: { type: 'page_numbers', pageNumbers: [1, 9] }
          })
          const search = await harness.invoke<PdfSearchResult>('pdf_search', {
            sourcePath,
            query: '过度拟合',
            mode: 'literal',
            maxMatches: 20
          })
          return { inspect, read, search }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.inspect.pageCount === 11 && result.inspect.metadata.title === '深度学习',
          {
            name: 'pdf-inspect-returns-real-metadata',
            message: 'pdf_inspect 应返回 fixture 的真实页数和标题。',
            data: result.inspect
          }
        )
        runtime.assertThat(
          result.read.pages.length === 2 &&
            result.read.pages[0]?.pageNumber === 1 &&
            /architecture/i.test(result.read.pages[0]?.text || '') &&
            !result.read.pages.some((page) => page.text.includes('\u0000')),
          {
            name: 'pdf-read-pages-returns-normalized-text',
            message: 'pdf_read_pages 应按页返回无 NUL 的真实文本层。',
            data: result.read
          }
        )
        runtime.assertThat(
          result.search.totalMatchCount > 0 &&
            result.search.matches.some((match) => match.pageNumber === 8 || match.pageNumber === 9),
          {
            name: 'pdf-search-locates-overfitting-pages',
            message: 'pdf_search 应在第 8 或第 9 页找到“过度拟合”。',
            data: result.search
          }
        )
      }
    })
  })

  it('pdf-render-pages-runtime-assets-contract', async () => {
    await runBackendCase({
      caseId: 'pdf-render-pages-runtime-assets-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['pdf'],
      description: '验证 PDF 页面图片写入 runtime assets，且不修改源 PDF、不产生普通 artifact。',
      fixtures: [PDF_FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = runtime.getFixtureWorkspacePath(PDF_FIXTURE)
        const beforeHash = await sha256(sourcePath)
        const harness = createPdfToolHarness(runtime)
        try {
          const render = await harness.invoke<PdfRenderResult>('pdf_render_pages', {
            sourcePath,
            pageNumbers: [1, 9]
          })
          const headers = await Promise.all(
            render.images.map(async (image) =>
              (await fs.readFile(image.path)).subarray(0, 8).toString('hex')
            )
          )
          return {
            render,
            headers,
            beforeHash,
            afterHash: await sha256(sourcePath),
            artifactCount: runtime.eventCollector
              .snapshot()
              .filter((event) => event.type === 'file_artifact').length
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const expectedParent = path.join(
          runtime.workspaceRoot,
          '.ncurator',
          'runtime',
          'assets',
          result.render.assetBucketId
        )
        runtime.assertThat(
          result.render.images.length === 2 &&
            result.render.images.every((image) => path.dirname(image.path) === expectedParent) &&
            result.render.images.map((image) => path.basename(image.path)).join(',') ===
              'page-1.png,page-9.png' &&
            result.headers.every((header) => header === '89504e470d0a1a0a'),
          {
            name: 'pdf-render-writes-valid-runtime-assets',
            message: '页面图片应写入 .ncurator/runtime/assets/<uuid>，并且是有效 PNG。',
            data: result.render
          }
        )
        runtime.assertThat(result.beforeHash === result.afterHash && result.artifactCount === 0, {
          name: 'pdf-render-does-not-mutate-source-or-emit-artifact',
          message: '渲染页面不能修改源 PDF，也不能产生普通 file artifact。',
          data: { artifactCount: result.artifactCount }
        })
      }
    })
  })

  it('pdf-failure-boundary-contract', async () => {
    await runBackendCase({
      caseId: 'pdf-failure-boundary-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['pdf'],
      description: '验证越界页码、非法 regex、伪 PDF 和逃逸工作区的符号链接会明确失败。',
      fixtures: [PDF_FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = runtime.getFixtureWorkspacePath(PDF_FIXTURE)
        const corruptPath = path.join(runtime.workspaceRoot, 'corrupt.pdf')
        const outsidePath = path.join(path.dirname(runtime.workspaceRoot), 'outside-pdf.pdf')
        const symlinkPath = path.join(runtime.workspaceRoot, 'outside-link.pdf')
        await fs.writeFile(corruptPath, 'not a pdf')
        await fs.copyFile(sourcePath, outsidePath)
        await fs.symlink(outsidePath, symlinkPath)
        const harness = createPdfToolHarness(runtime)
        try {
          const outOfRange = await harness.invoke<PdfFailure>('pdf_read_pages', {
            sourcePath,
            selection: { type: 'page_numbers', pageNumbers: [99] }
          })
          const badRegex = await harness.invoke<PdfFailure>('pdf_search', {
            sourcePath,
            query: '[',
            mode: 'regex'
          })
          const oversizedRange = await harness.invoke<PdfFailure>('pdf_read_pages', {
            sourcePath,
            selection: { type: 'page_range', fromPage: 1, toPage: 1000000 }
          })
          const corrupt = await harness.invoke<PdfFailure>('pdf_inspect', {
            sourcePath: corruptPath
          })
          const outside = await harness.invoke<PdfFailure>('pdf_inspect', {
            sourcePath: symlinkPath
          })
          return { outOfRange, badRegex, oversizedRange, corrupt, outside }
        } finally {
          await harness.release()
          await fs.rm(outsidePath, { force: true })
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          [
            result.outOfRange,
            result.badRegex,
            result.oversizedRange,
            result.corrupt,
            result.outside
          ].every((failure) => failure.ok === false && failure.error.length > 0),
          {
            name: 'pdf-invalid-inputs-fail-explicitly',
            message: '所有 PDF 边界错误都应返回明确失败信息。',
            data: result
          }
        )
      }
    })
  })

  it('pdf-result-size-contract', async () => {
    await runBackendCase({
      caseId: 'pdf-result-size-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['pdf'],
      description: '验证 PDF 正文过大时返回统一 hand_tool_result_too_large 提示。',
      fixtures: [PDF_FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = runtime.getFixtureWorkspacePath(PDF_FIXTURE)
        const harness = createPdfToolHarness(runtime, {
          humanRuntimeOverrides: { modelContextWindowTokens: 100 }
        })
        try {
          return await harness.invoke<
            PdfFailure & { decisionHint?: { code?: string; detail?: unknown } }
          >('pdf_read_pages', {
            sourcePath,
            selection: { type: 'page_numbers', pageNumbers: [1] }
          })
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.ok === false && result.decisionHint?.code === 'hand_tool_result_too_large',
          {
            name: 'pdf-large-result-returns-shared-decision-hint',
            message: 'PDF 工具结果过大时应复用 hand_tool_result_too_large。',
            data: result
          }
        )
      }
    })
  })
})
