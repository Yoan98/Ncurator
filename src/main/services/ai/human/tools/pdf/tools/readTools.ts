import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonObject } from '../../../../../../../shared/types'
import { withToolLifecycle } from '../../utils/lifecycle'
import {
  PdfToolRuntimeError,
  type PdfToolFailure,
  type PdfToolResourceContext,
  type PdfToolRuntime
} from '../runtime'
import { PDF_INSPECT_TOOL_SPEC, PDF_READ_PAGES_TOOL_SPEC, PDF_SEARCH_TOOL_SPEC } from '../toolSpecs'

const uniquePageNumbers = (pageNumbers: number[]): number[] => [...new Set(pageNumbers)]

const runTool = async (input: {
  runtime: PdfToolRuntime
  toolName: string
  toolCallId: string
  sourcePath: string
  effectKind: PdfToolResourceContext['effectKind']
  execute: (
    session: Awaited<ReturnType<PdfToolRuntime['ensureDocument']>>
  ) => Promise<JsonObject | PdfToolFailure>
}): Promise<JsonObject | PdfToolFailure> => {
  try {
    input.runtime.input.ctx.checkCancelled()
    const document = await input.runtime.ensureDocument(input.sourcePath)
    const resourceContext = input.runtime.buildResourceContext(
      document.sourcePath,
      input.effectKind
    )
    const result = await input.execute(document)
    if ('ok' in result && result.ok === false) return result
    input.runtime.emitSuccess({
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      result,
      resourceContext
    })
    return result
  } catch (error) {
    return input.runtime.emitFailure({
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      reason: error instanceof PdfToolRuntimeError ? error.reason : 'invalid_input',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export const buildPdfReadTools = (runtime: PdfToolRuntime): StructuredToolInterface[] => {
  const inspectTool = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: runtime.toolEvents,
        toolName: PDF_INSPECT_TOOL_SPEC.name,
        args: args as JsonObject,
        execute: async ({ toolCallId }) =>
          await runTool({
            runtime,
            toolName: PDF_INSPECT_TOOL_SPEC.name,
            toolCallId,
            sourcePath: args.sourcePath,
            effectKind: 'inspected',
            execute: async (document) => ({
              sourcePath: document.sourcePath,
              pageCount: document.pageCount,
              metadata: document.metadata,
              outline: document.outline,
              encrypted: document.encrypted
            })
          })
      }),
    {
      name: PDF_INSPECT_TOOL_SPEC.name,
      description: PDF_INSPECT_TOOL_SPEC.promptSpec.description,
      schema: PDF_INSPECT_TOOL_SPEC.inputSchema
    }
  )

  const searchTool = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: runtime.toolEvents,
        toolName: PDF_SEARCH_TOOL_SPEC.name,
        args: args as JsonObject,
        execute: async ({ toolCallId }) =>
          await runTool({
            runtime,
            toolName: PDF_SEARCH_TOOL_SPEC.name,
            toolCallId,
            sourcePath: args.sourcePath,
            effectKind: 'searched',
            execute: async (document) => {
              const fromPage = args.pageRange?.fromPage ?? 1
              const toPage = args.pageRange?.toPage ?? document.pageCount
              const response = await runtime.callWorker({
                action: 'search',
                payload: {
                  docId: document.docId,
                  query: args.query,
                  mode: args.mode || 'literal',
                  fromPage,
                  toPage,
                  maxMatches: args.maxMatches || 20
                }
              })
              const resourceContext = runtime.buildResourceContext(document.sourcePath, 'searched')
              if (!response.ok) {
                return runtime.emitWorkerFailure({
                  toolName: PDF_SEARCH_TOOL_SPEC.name,
                  toolCallId,
                  response,
                  resourceContext
                })
              }
              if (response.payload.action !== 'search')
                throw new Error('PDF worker 协议错误（search）')
              return {
                sourcePath: document.sourcePath,
                pageCount: document.pageCount,
                query: args.query,
                mode: args.mode || 'literal',
                pageRange: { fromPage, toPage },
                totalMatchCount: response.payload.totalMatchCount,
                returnedMatchCount: response.payload.matches.length,
                matches: response.payload.matches,
                pagesWithNoTextCount: response.payload.pagesWithNoTextCount,
                pagesWithSuspiciousTextCount: response.payload.pagesWithSuspiciousTextCount
              }
            }
          })
      }),
    {
      name: PDF_SEARCH_TOOL_SPEC.name,
      description: PDF_SEARCH_TOOL_SPEC.promptSpec.description,
      schema: PDF_SEARCH_TOOL_SPEC.inputSchema
    }
  )

  const readPagesTool = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: runtime.toolEvents,
        toolName: PDF_READ_PAGES_TOOL_SPEC.name,
        args: args as JsonObject,
        execute: async ({ toolCallId }) =>
          await runTool({
            runtime,
            toolName: PDF_READ_PAGES_TOOL_SPEC.name,
            toolCallId,
            sourcePath: args.sourcePath,
            effectKind: 'read',
            execute: async (document) => {
              const selection = args.selection
              let pageNumbers: number[]
              if (selection.type === 'page_numbers') {
                pageNumbers = uniquePageNumbers(selection.pageNumbers)
              } else {
                if (selection.fromPage > selection.toPage) {
                  throw new Error('fromPage 不能大于 toPage')
                }
                const pageCount = selection.toPage - selection.fromPage + 1
                if (pageCount > 50) throw new Error('单次最多读取 50 页')
                pageNumbers = Array.from(
                  { length: pageCount },
                  (_, index) => selection.fromPage + index
                )
              }
              if (pageNumbers.length === 0 || pageNumbers.length > 50) {
                throw new Error('单次最多读取 50 页，且页码范围不能为空')
              }
              const response = await runtime.callWorker({
                action: 'read_pages',
                payload: { docId: document.docId, pageNumbers }
              })
              const resourceContext = runtime.buildResourceContext(document.sourcePath, 'read')
              if (!response.ok) {
                return runtime.emitWorkerFailure({
                  toolName: PDF_READ_PAGES_TOOL_SPEC.name,
                  toolCallId,
                  response,
                  resourceContext
                })
              }
              if (response.payload.action !== 'read_pages')
                throw new Error('PDF worker 协议错误（read_pages）')
              const rendered = await runtime.callWorker({
                action: 'materialize_pages',
                payload: {
                  docId: document.docId,
                  workspaceRootPath: runtime.workspaceRootPath,
                  pageNumbers
                }
              })
              if (!rendered.ok) {
                return runtime.emitWorkerFailure({
                  toolName: PDF_READ_PAGES_TOOL_SPEC.name,
                  toolCallId,
                  response: rendered,
                  resourceContext
                })
              }
              if (rendered.payload.action !== 'materialize_pages')
                throw new Error('PDF worker 协议错误（materialize_pages）')
              const imageByPage = new Map(
                rendered.payload.images.map((image) => [image.pageNumber, image.path])
              )
              return {
                sourcePath: document.sourcePath,
                pageCount: document.pageCount,
                pages: response.payload.pages.map((page) => {
                  const pageImagePath = imageByPage.get(page.pageNumber)
                  if (!pageImagePath)
                    throw new Error(`PDF 第 ${String(page.pageNumber)} 页渲染缺失`)
                  return { ...page, pageImagePath }
                })
              }
            }
          })
      }),
    {
      name: PDF_READ_PAGES_TOOL_SPEC.name,
      description: PDF_READ_PAGES_TOOL_SPEC.promptSpec.description,
      schema: PDF_READ_PAGES_TOOL_SPEC.inputSchema
    }
  )

  return [inspectTool, searchTool, readPagesTool]
}
