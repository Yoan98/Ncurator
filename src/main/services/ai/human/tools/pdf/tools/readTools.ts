import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { JsonObject } from '../../../../../../../shared/types'
import { withToolLifecycle } from '../../utils/lifecycle'
import { checkToolResultSize } from '../../utils/resultSizeGuard'
import {
  PdfToolRuntimeError,
  type PdfToolFailure,
  type PdfToolResourceContext,
  type PdfToolRuntime
} from '../runtime'
import {
  PDF_INSPECT_TOOL_SPEC,
  PDF_READ_PAGES_TOOL_SPEC,
  PDF_READ_VISUALS_TOOL_SPEC,
  PDF_SEARCH_TOOL_SPEC
} from '../toolSpecs'
import { createVisualRecognitionService } from '../../visualRecognition/service'

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
    const size = checkToolResultSize({
      toolName: input.toolName,
      value: result,
      modelContextWindowTokens: input.runtime.input.modelContextWindowTokens
    })
    if (size.tooLarge) {
      return input.runtime.emitFailure({
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        reason: 'result_too_large',
        error: `PDF 工具结果过大：预计 ${String(size.estimatedTokens)} tokens，限制 ${String(size.limit)} tokens`,
        decisionHint: size.decisionHint,
        resourceContext
      })
    }
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
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export const buildPdfReadTools = (runtime: PdfToolRuntime): StructuredToolInterface[] => {
  const visualRecognitionService = createVisualRecognitionService(runtime.input.ctx)
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
              encrypted: document.encrypted,
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
                pagesWithSuspiciousTextCount: response.payload.pagesWithSuspiciousTextCount,
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
              return {
                sourcePath: document.sourcePath,
                pageCount: document.pageCount,
                pages: response.payload.pages,
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

  const readVisualsTool = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: runtime.toolEvents,
        toolName: PDF_READ_VISUALS_TOOL_SPEC.name,
        args: args as JsonObject,
        execute: async ({ toolCallId }) =>
          await runTool({
            runtime,
            toolName: PDF_READ_VISUALS_TOOL_SPEC.name,
            toolCallId,
            sourcePath: args.sourcePath,
            effectKind: 'read',
            execute: async (document) => {
              const validRequests = args.requests.filter(
                (request) => request.index <= document.pageCount
              )
              const invalidResults = args.requests
                .filter((request) => request.index > document.pageCount)
                .map((request) => ({
                  index: request.index,
                  error: `页码超出范围：PDF 共 ${String(document.pageCount)} 页`
                }))

              let recognitionResults: Awaited<
                ReturnType<typeof visualRecognitionService.recognizeImages>
              > = []
              if (validRequests.length > 0) {
                const response = await runtime.callWorker({
                  action: 'render_pages',
                  payload: {
                    docId: document.docId,
                    workspaceRootPath: runtime.workspaceRootPath,
                    pageNumbers: uniquePageNumbers(validRequests.map((request) => request.index))
                  }
                })
                const resourceContext = runtime.buildResourceContext(document.sourcePath, 'read')
                if (!response.ok) {
                  return runtime.emitWorkerFailure({
                    toolName: PDF_READ_VISUALS_TOOL_SPEC.name,
                    toolCallId,
                    response,
                    resourceContext
                  })
                }
                if (response.payload.action !== 'render_pages')
                  throw new Error('PDF worker 协议错误（render_pages）')
                recognitionResults = await visualRecognitionService.recognizeImages({
                  images: response.payload.images.map((image) => ({
                    index: image.pageNumber,
                    path: image.path,
                    mimeType: image.mimeType
                  })),
                  requests: validRequests
                })
              }

              let recognitionIndex = 0
              const results = args.requests.map((request) => {
                if (request.index > document.pageCount) {
                  return invalidResults.shift()!
                }
                const result = recognitionResults[recognitionIndex]
                recognitionIndex += 1
                return result || { index: request.index, error: '页面识别结果缺失' }
              })
              return {
                sourcePath: document.sourcePath,
                results
              }
            }
          })
      }),
    {
      name: PDF_READ_VISUALS_TOOL_SPEC.name,
      description: PDF_READ_VISUALS_TOOL_SPEC.promptSpec.description,
      schema: PDF_READ_VISUALS_TOOL_SPEC.inputSchema
    }
  )

  return [inspectTool, searchTool, readPagesTool, readVisualsTool]
}
