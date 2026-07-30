import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
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
type PdfReadVisualsResult = {
  sourcePath: string
  results: Array<{ index: number; text?: string; error?: string }>
}

const sha256 = async (filePath: string): Promise<string> =>
  createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex')

const startVisionServer = async (): Promise<{ baseUrl: string; close: () => Promise<void> }> => {
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(
      JSON.stringify({
        id: 'chatcmpl-pdf-visuals',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-5',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                supports_image_recognition: true,
                result: '第9页 Overfit 图显示训练曲线继续改善，但验证曲线变差。'
              })
            },
            finish_reason: 'stop'
          }
        ]
      })
    )
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    close: async () => {
      sockets.forEach((socket) => socket.destroy())
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
}

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

  it('pdf-read-visuals-contract', async () => {
    await runBackendCase({
      caseId: 'pdf-read-visuals-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['pdf'],
      description:
        '验证 PDF 页面视觉读取会返回结构化识别结果，且不修改源 PDF、不产生普通 artifact。',
      fixtures: [PDF_FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
        const visionServer = await startVisionServer()
        const sourcePath = runtime.getFixtureWorkspacePath(PDF_FIXTURE)
        try {
          await runtime.seedLlmConfig({
            id: 'ai-live-config',
            name: 'PDF 视觉读取测试配置',
            providerKind: 'openai-compatible',
            base_url: visionServer.baseUrl,
            model_name: 'gpt-5',
            api_key: 'test-key'
          })
          const beforeHash = await sha256(sourcePath)
          const harness = createPdfToolHarness(runtime, { modelName: 'gpt-5' })
          try {
            const visual = await harness.invoke<PdfReadVisualsResult>('pdf_read_visuals', {
              sourcePath,
              requests: [
                { index: 9, instruction: '说明页面中的 Overfit 图形差异。' },
                { index: 99, instruction: '说明页面视觉内容。' }
              ]
            })
            return {
              visual,
              beforeHash,
              afterHash: await sha256(sourcePath),
              artifactCount: runtime.eventCollector
                .snapshot()
                .filter((event) => event.type === 'file_artifact').length
            }
          } finally {
            await harness.release()
          }
        } finally {
          await visionServer.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.visual.results.length === 2 &&
            result.visual.results[0]?.index === 9 &&
            result.visual.results[0]?.text?.includes('验证曲线') === true &&
            result.visual.results[1]?.index === 99 &&
            typeof result.visual.results[1]?.error === 'string' &&
            result.visual.results[1]?.error?.includes('页码超出范围') === true,
          {
            name: 'pdf-read-visuals-returns-per-request-results',
            message: 'pdf_read_visuals 应按请求顺序返回成功 text 或失败 error。',
            data: result.visual
          }
        )
        runtime.assertThat(result.beforeHash === result.afterHash && result.artifactCount === 0, {
          name: 'pdf-read-visuals-does-not-mutate-source-or-emit-artifact',
          message: '读取页面视觉内容不能修改源 PDF，也不能产生普通 file artifact。',
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
          const corrupt = await harness.invoke<PdfFailure>('pdf_inspect', {
            sourcePath: corruptPath
          })
          const outside = await harness.invoke<PdfFailure>('pdf_inspect', {
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
