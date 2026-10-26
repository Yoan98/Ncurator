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
import { PDF_SEARCH_MAX_MATCHES } from '../constants'
import { PDF_OUTLINE_TOOL_SPEC, PDF_READ_PAGES_TOOL_SPEC, PDF_SEARCH_TOOL_SPEC } from '../toolSpecs'

const uniquePageNumbers = (pageNumbers: number[]): number[] => [...new Set(pageNumbers)]

const isPdfToolFailure = (value: JsonObject | PdfToolFailure): value is PdfToolFailure =>
  'error' in value && typeof value.error === 'string'

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
    if (isPdfToolFailure(result)) return result
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
  const outlineTool = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: runtime.toolEvents,
        toolName: PDF_OUTLINE_TOOL_SPEC.name,
        args: args as JsonObject,
        execute: async ({ toolCallId }) =>
          await runTool({
            runtime,
            toolName: PDF_OUTLINE_TOOL_SPEC.name,
            toolCallId,
            sourcePath: args.sourcePath,
            effectKind: 'inspected',
            execute: async (document) => ({
              pageCount: document.pageCount,
              metadata: document.metadata,
              outline: document.outline
            })
          })
      }),
    {
      name: PDF_OUTLINE_TOOL_SPEC.name,
      description: PDF_OUTLINE_TOOL_SPEC.promptSpec.description,
      schema: PDF_OUTLINE_TOOL_SPEC.inputSchema
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
                  maxMatches: PDF_SEARCH_MAX_MATCHES
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
                throw new Error('PDF worker protocol error (search)')
              return {
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
                  throw new Error('fromPage must not exceed toPage')
                }
                const pageCount = selection.toPage - selection.fromPage + 1
                if (pageCount > 50) throw new Error('At most 50 pages can be read per call')
                pageNumbers = Array.from(
                  { length: pageCount },
                  (_, index) => selection.fromPage + index
                )
              }
              if (pageNumbers.length === 0 || pageNumbers.length > 50) {
                throw new Error(
                  'At most 50 pages can be read per call, and the page range must not be empty'
                )
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
                throw new Error('PDF worker protocol error (read_pages)')
              const rendered = await runtime.callWorker({
                action: 'materialize_pages',
                payload: {
                  docId: document.docId,
                  partnerId: runtime.input.partnerId,
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
                throw new Error('PDF worker protocol error (materialize_pages)')
              const imageByPage = new Map(
                rendered.payload.images.map((image) => [image.pageNumber, image.path])
              )
              return {
                pages: response.payload.pages.map((page) => {
                  const pageImagePath = imageByPage.get(page.pageNumber)
                  if (!pageImagePath)
                    throw new Error(`The rendered PDF page is missing: ${String(page.pageNumber)}`)
                  return {
                    pageNumber: page.pageNumber,
                    text: page.text,
                    textStatus: page.textStatus,
                    imageCount: page.imageCount,
                    pageImagePath
                  }
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

  return [outlineTool, searchTool, readPagesTool]
}
