import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createElement } from 'react'
import { Document, Image, Page, renderToBuffer } from '@react-pdf/renderer'
import { describe, it } from 'vitest'
import { createPdfToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const PDF_FIXTURE = path.resolve('tests/fixtures/workspace/学习笔记/深度学习.pdf')

type PdfFailure = { ok: false; error: string; reason: string }
type PdfOutlineResult = {
  pageCount: number
  metadata: { title?: string }
  outline: Array<{ title: string; pageNumber: number; depth: number }>
}
type PdfReadResult = {
  pages: Array<{
    pageNumber: number
    text: string
    textStatus: 'available' | 'empty' | 'suspicious'
    imageCount: number
    pageImagePath: string
  }>
}
type PdfSearchResult = {
  totalMatchCount: number
  returnedMatchCount: number
  matches: Array<{ pageNumber: number; matchedText: string; snippet: string }>
}
const sha256 = async (filePath: string): Promise<string> =>
  createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex')

describe('ai tool pdf backend', () => {
  it('pdf-image-only-page-contract', async () => {
    await runBackendCase({
      caseId: 'pdf-image-only-page-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['pdf'],
      description: '验证没有文本层的扫描 PDF 仍返回可读取的整页图片。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const imagePath = path.join(runtime.workspaceRoot, 'scan.png')
        const sourcePath = path.join(runtime.workspaceRoot, 'scan.pdf')
        await fs.writeFile(
          imagePath,
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64'
          )
        )
        const document = createElement(
          Document,
          null,
          createElement(Page, { size: [200, 200] }, createElement(Image, { src: imagePath }))
        )
        await fs.writeFile(sourcePath, await renderToBuffer(document))
        const harness = createPdfToolHarness(runtime)
        try {
          return await harness.invoke<PdfReadResult>('pdf_read_pages', {
            sourcePath,
            selection: { type: 'page_numbers', pageNumbers: [1] }
          })
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const page = result.pages[0]
        const imageExists = page?.pageImagePath
          ? await fs.access(page.pageImagePath).then(() => true).catch(() => false)
          : false
        runtime.assertThat(
          page?.text === '' && page.textStatus === 'empty' && imageExists,
          {
            name: 'pdf-image-only-page-remains-readable',
            message: '纯扫描 PDF 应标记为空文本，同时返回存在的 pageImagePath。',
            data: result
          }
        )
      }
    })
  })

  it('pdf-outline-read-search-contract', async () => {
    await runBackendCase({
      caseId: 'pdf-outline-read-search-contract',
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
          const inspect = await harness.invoke<PdfOutlineResult>('pdf_outline', { sourcePath })
          const read = await harness.invoke<PdfReadResult>('pdf_read_pages', {
            sourcePath,
            selection: { type: 'page_numbers', pageNumbers: [1, 9] }
          })
          const search = await harness.invoke<PdfSearchResult>('pdf_search', {
            sourcePath,
            query: '过度拟合',
            mode: 'literal'
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
            name: 'pdf-outline-returns-real-metadata',
            message: 'pdf_outline 应返回 fixture 的真实页数和标题。',
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

  it('pdf-read-pages-image-contract', async () => {
    await runBackendCase({
      caseId: 'pdf-read-pages-image-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['pdf'],
      description: '验证 PDF 页面读取返回页面渲染图片路径。',
      fixtures: [PDF_FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = runtime.getFixtureWorkspacePath(PDF_FIXTURE)
        const beforeHash = await sha256(sourcePath)
        const harness = createPdfToolHarness(runtime)
        try {
          const read = await harness.invoke<PdfReadResult>('pdf_read_pages', {
            sourcePath,
            selection: { type: 'page_numbers', pageNumbers: [9] }
          })
          return {
            read,
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
        const page = result.read.pages[0]
        const imageExists = page?.pageImagePath
          ? await fs
              .access(page.pageImagePath)
              .then(() => true)
              .catch(() => false)
          : false
        runtime.assertThat(
          page?.pageNumber === 9 &&
            imageExists &&
            /\.ncurator[\\/]runtime[\\/]assets[\\/]pdf_read_pages-[^\\/]+[\\/][a-f0-9]{64}\./u.test(
              (page.pageImagePath || '').replace(/\\/g, '/')
            ),
          {
            name: 'pdf-read-pages-returns-page-image-path',
            message: 'pdf_read_pages 应返回内容哈希命名的页面图片路径。',
            data: result.read
          }
        )
        runtime.assertThat(result.beforeHash === result.afterHash && result.artifactCount === 0, {
          name: 'pdf-read-pages-does-not-mutate-source-or-emit-artifact',
          message: '读取页面不能修改源 PDF，也不能产生普通 file artifact。',
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
      description: '验证越界页码、非法 regex、伪 PDF 会明确失败，工作区外 PDF 可读取。',
      fixtures: [PDF_FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = runtime.getFixtureWorkspacePath(PDF_FIXTURE)
        const corruptPath = path.join(runtime.workspaceRoot, 'corrupt.pdf')
        const outsideDirectory = path.join(
          path.dirname(runtime.workspaceRoot),
          `${path.basename(runtime.workspaceRoot)}-outside`
        )
        const outsidePath = path.join(outsideDirectory, 'outside-pdf.pdf')
        const symlinkPath = path.join(runtime.workspaceRoot, 'outside-link')
        const escapedPdfPath = path.join(symlinkPath, 'outside-pdf.pdf')
        await fs.writeFile(corruptPath, 'not a pdf')
        await fs.mkdir(outsideDirectory, { recursive: true })
        await fs.copyFile(sourcePath, outsidePath)
        await fs.symlink(
          outsideDirectory,
          symlinkPath,
          process.platform === 'win32' ? 'junction' : 'dir'
        )
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
          const corrupt = await harness.invoke<PdfFailure>('pdf_outline', {
            sourcePath: corruptPath
          })
          const outside = await harness.invoke<Record<string, unknown>>('pdf_outline', {
            sourcePath: escapedPdfPath
          })
          return { outOfRange, badRegex, oversizedRange, corrupt, outside }
        } finally {
          await harness.release()
          await fs.rm(outsideDirectory, { recursive: true, force: true })
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          [result.outOfRange, result.badRegex, result.oversizedRange, result.corrupt].every(
            (failure) => failure.ok === false && failure.error.length > 0
          ) &&
            typeof result.outside.pageCount === 'number' &&
            result.outside.pageCount > 0,
          {
            name: 'pdf-invalid-inputs-fail-explicitly',
            message: 'PDF 非法输入应明确失败，工作区外 PDF 应可读取。',
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
      description: '验证 PDF 正文过大时不再硬失败，完整结果直接返回，由 hand 层统一截断落盘。',
      fixtures: [PDF_FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = runtime.getFixtureWorkspacePath(PDF_FIXTURE)
        const harness = createPdfToolHarness(runtime, {
          humanRuntimeOverrides: { modelContextWindowTokens: 100 }
        })
        try {
          return await harness.invoke<PdfFailure>('pdf_read_pages', {
            sourcePath,
            selection: { type: 'page_numbers', pageNumbers: [1] }
          })
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          Array.isArray(result.pages) &&
            result.pages.length > 0 &&
            typeof result.pages[0]?.text === 'string' &&
            result.pages[0].text.length > 0,
          {
            name: 'pdf-large-result-returns-full-content',
            message: 'PDF 工具结果过大时不再硬失败，完整正文由 hand 层统一截断落盘。',
            data: result
          }
        )
      }
    })
  })
})
