import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import type {
  AiFileArtifactOperation,
  IpcJsonObject,
  IpcJsonValue
} from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import { emitFileArtifactEvent } from '../../events/fileArtifacts'
import { resolveWorkspacePath } from '../terminal_exec/terminalPolicy'
import type { DocxOp } from './types'
import { getDocxWorkerClient } from './worker/docxWorkerClient'
import type { DocxWorkerRequest } from './worker/protocol'

type EmitActivityInput = {
  actionType: string
  status: 'started' | 'completed' | 'failed'
  summary: string
}

type DocxCapabilityToolsInput = {
  ctx: AiRunContext
  runId: string
  taskId: string
  workspaceRootPath: string
  safePreviewChars: number
  emitActivity: (input: EmitActivityInput) => void
}

export type DocxCapabilityToolsRuntimeState = {
  lastDocId?: string
  sourcePathByDocId: Map<string, string>
}

const clipText = (text: string, maxChars: number) => {
  const raw = String(text || '')
  if (raw.length <= maxChars) return raw
  return raw.slice(0, maxChars)
}

const resolveDocxPath = (input: {
  workspaceRootPath: string
  cwd: string
  rawPath: string
}): string | null => {
  const resolved = resolveWorkspacePath({
    rawPath: input.rawPath,
    cwd: input.cwd,
    rootPath: input.workspaceRootPath
  })
  if (!resolved) return null
  if (!resolved.toLowerCase().endsWith('.docx')) return null
  return resolved
}

const runSpecSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: z.string().optional()
})

const paragraphSpecSchema = z.object({
  kind: z.literal('paragraph'),
  style: z.string().optional(),
  runs: z.array(runSpecSchema).min(1)
})

const tableCellSpecSchema = z.object({
  paragraphs: z.array(paragraphSpecSchema).min(1)
})

const tableSpecSchema = z.object({
  kind: z.literal('table'),
  rows: z.array(z.array(tableCellSpecSchema).min(1)).min(1)
})

const blockSpecSchema = z.union([paragraphSpecSchema, tableSpecSchema])

const docOpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('replace_block'),
    blockId: z.string().min(1),
    content: blockSpecSchema
  }),
  z.object({
    type: z.literal('insert_after'),
    anchorBlockId: z.string().min(1),
    content: z.array(blockSpecSchema).min(1)
  }),
  z.object({
    type: z.literal('insert_before'),
    anchorBlockId: z.string().min(1),
    content: z.array(blockSpecSchema).min(1)
  }),
  z.object({
    type: z.literal('delete_block'),
    blockId: z.string().min(1)
  }),
  z.object({
    type: z.literal('update_table_cell'),
    blockId: z.string().min(1),
    content: z.array(paragraphSpecSchema).min(1)
  }),
  z.object({
    type: z.literal('replace_text'),
    query: z.string().min(1),
    replace: z.string(),
    replaceAll: z.boolean().optional(),
    blockIds: z.array(z.string().min(1)).optional()
  })
])

const openSchema = z.object({
  sourcePath: z.string().min(1)
})

const outlineSchema = z.object({
  docId: z.string().min(1),
  maxBlocks: z.number().int().min(1).max(2000).optional(),
  includeTables: z.boolean().optional(),
  includeCells: z.boolean().optional()
})

const getBlockSchema = z.object({
  docId: z.string().min(1),
  blockId: z.string().min(1)
})

const searchSchema = z.object({
  docId: z.string().min(1),
  query: z.string().min(1),
  mode: z.enum(['literal', 'regex', 'semantic']),
  scope: z
    .object({
      blockIds: z.array(z.string().min(1)).optional()
    })
    .optional()
})

const applyOpsSchema = z.object({
  docId: z.string().min(1),
  ops: z.array(docOpSchema).min(1)
})

const renderPreviewSchema = z.object({
  docId: z.string().min(1),
  format: z.enum(['html', 'png', 'pdf']),
  range: z
    .object({
      fromBlockId: z.string().optional(),
      toBlockId: z.string().optional()
    })
    .optional()
})

const saveSchema = z.object({
  docId: z.string().min(1),
  outPath: z.string().min(1),
  overwrite: z.boolean().optional()
})

const validateSchema = z.object({
  docId: z.string().min(1)
})

const toFailure = (input: {
  code: 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  error: string
  warnings?: string[]
}) => {
  return {
    ok: false,
    code: input.code,
    summary: input.error,
    error: input.error,
    warnings: input.warnings || []
  }
}

export const buildDocxCapabilityTools = (input: DocxCapabilityToolsInput) => {
  const state: DocxCapabilityToolsRuntimeState = {
    sourcePathByDocId: new Map()
  }

  const workspaceRootPath = path.resolve(input.workspaceRootPath)

  const emitStarted = (toolName: string, args: IpcJsonObject) => {
    const toolCallId = randomUUID()
    input.ctx.sendEvent({
      type: 'tool_call_started',
      runId: input.runId,
      taskId: input.taskId,
      toolCallId,
      toolName,
      input: args,
      createdAt: Date.now()
    })
    return toolCallId
  }

  const emitResult = (
    toolName: string,
    toolCallId: string,
    outputPreview: IpcJsonValue,
    error?: string
  ) => {
    input.ctx.sendEvent({
      type: 'tool_call_result',
      runId: input.runId,
      taskId: input.taskId,
      toolCallId,
      toolName,
      outputPreview,
      completedAt: Date.now(),
      error
    })
  }

  const callWorker = async (request: Omit<DocxWorkerRequest, 'requestId' | 'runId'>) => {
    const client = getDocxWorkerClient()
    return await client.call({
      ...request,
      runId: input.runId
    } as DocxWorkerRequest, 45_000)
  }

  const docxOpenTool = tool(
    async (args) => {
      const toolName = 'docx_open'
      const toolCallId = emitStarted(toolName, args)
      try {
        input.ctx.checkCancelled()
        const sourcePath = resolveDocxPath({
          workspaceRootPath,
          cwd: workspaceRootPath,
          rawPath: args.sourcePath
        })
        if (!sourcePath) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'sourcePath must be a workspace-bound .docx path'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (!fs.existsSync(sourcePath)) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'sourcePath not found'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        input.emitActivity({
          actionType: 'docx_open',
          status: 'started',
          summary: `打开文档: ${sourcePath}`
        })

        const workerResponse = await callWorker({
          action: 'open',
          payload: {
            sourcePath
          }
        })
        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          input.emitActivity({
            actionType: 'docx_open',
            status: 'failed',
            summary: `文档打开失败: ${workerResponse.error}`
          })
          return out
        }

        if (workerResponse.payload.action !== 'open') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (open)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        state.lastDocId = workerResponse.payload.docId
        state.sourcePathByDocId.set(workerResponse.payload.docId, sourcePath)
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `doc opened: ${path.basename(sourcePath)}`,
          docId: workerResponse.payload.docId,
          meta: workerResponse.payload.meta,
          stats: workerResponse.payload.stats
        }
        emitResult(toolName, toolCallId, out)
        input.emitActivity({
          actionType: 'docx_open',
          status: 'completed',
          summary: `文档已打开: ${path.basename(sourcePath)}`
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({
          code: 'failed',
          error: msg
        })
        emitResult(toolName, toolCallId, out, out.error)
        input.emitActivity({
          actionType: 'docx_open',
          status: 'failed',
          summary: `文档打开异常: ${msg}`
        })
        throw error
      }
    },
    {
      name: 'docx_open',
      description: 'Open a workspace-bound docx file and register a docId for subsequent operations.',
      schema: openSchema
    }
  )

  const docxOutlineTool = tool(
    async (args) => {
      const toolName = 'docx_outline'
      const toolCallId = emitStarted(toolName, args)
      try {
        input.ctx.checkCancelled()
        input.emitActivity({
          actionType: 'docx_outline',
          status: 'started',
          summary: `提取结构: ${args.docId}`
        })
        const workerResponse = await callWorker({
          action: 'outline',
          payload: {
            docId: args.docId,
            maxBlocks: Number(args.maxBlocks || 200),
            includeTables: Boolean(args.includeTables ?? true),
            includeCells: Boolean(args.includeCells ?? true)
          }
        })

        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          input.emitActivity({
            actionType: 'docx_outline',
            status: 'failed',
            summary: out.summary
          })
          return out
        }

        if (workerResponse.payload.action !== 'outline') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (outline)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `outline ready (${workerResponse.payload.blocks.length} blocks)`,
          blocks: workerResponse.payload.blocks,
          truncated: workerResponse.payload.truncated
        }
        emitResult(toolName, toolCallId, {
          ok: out.ok,
          code: out.code,
          summary: out.summary,
          blockCount: out.blocks.length,
          truncated: out.truncated
        })
        input.emitActivity({
          actionType: 'docx_outline',
          status: 'completed',
          summary: `结构提取完成: ${out.blocks.length} blocks`
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_outline',
      description:
        'Extract a deterministic block outline for a previously opened doc (paragraph/table/table_cell).',
      schema: outlineSchema
    }
  )

  const docxGetBlockTool = tool(
    async (args) => {
      const toolName = 'docx_get_block'
      const toolCallId = emitStarted(toolName, args)
      try {
        const workerResponse = await callWorker({
          action: 'get_block',
          payload: {
            docId: args.docId,
            blockId: args.blockId
          }
        })
        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (workerResponse.payload.action !== 'get_block') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (get_block)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `block loaded: ${args.blockId}`,
          block: workerResponse.payload.block
        }
        emitResult(toolName, toolCallId, {
          ok: out.ok,
          code: out.code,
          summary: out.summary,
          blockType: out.block.type
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_get_block',
      description: 'Get one block by blockId with detailed structure.',
      schema: getBlockSchema
    }
  )

  const docxSearchTool = tool(
    async (args) => {
      const toolName = 'docx_search'
      const toolCallId = emitStarted(toolName, args)
      try {
        const workerResponse = await callWorker({
          action: 'search',
          payload: {
            docId: args.docId,
            query: args.query,
            mode: args.mode,
            scopeBlockIds: args.scope?.blockIds || []
          }
        })
        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (workerResponse.payload.action !== 'search') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (search)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `search done (${workerResponse.payload.matches.length} matches)`,
          matches: workerResponse.payload.matches,
          warnings: workerResponse.payload.warnings
        }
        emitResult(toolName, toolCallId, {
          ok: out.ok,
          code: out.code,
          summary: out.summary,
          matchCount: out.matches.length,
          warnings: out.warnings
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_search',
      description: 'Search blocks in a doc using literal/regex mode (semantic reserved for future release).',
      schema: searchSchema
    }
  )

  const docxApplyOpsTool = tool(
    async (args) => {
      const toolName = 'docx_apply_ops'
      const toolCallId = emitStarted(toolName, args)
      try {
        input.emitActivity({
          actionType: 'docx_apply_ops',
          status: 'started',
          summary: `应用操作: ${args.ops.length} 条`
        })
        const workerResponse = await callWorker({
          action: 'apply_ops',
          payload: {
            docId: args.docId,
            ops: args.ops as DocxOp[]
          }
        })

        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          input.emitActivity({
            actionType: 'docx_apply_ops',
            status: 'failed',
            summary: out.summary
          })
          return out
        }

        if (workerResponse.payload.action !== 'apply_ops') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (apply_ops)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        state.lastDocId = workerResponse.payload.newDocId
        const sourcePath = state.sourcePathByDocId.get(args.docId)
        if (sourcePath) state.sourcePathByDocId.set(workerResponse.payload.newDocId, sourcePath)
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `ops applied (${workerResponse.payload.changedBlocks.length} changes)`,
          newDocId: workerResponse.payload.newDocId,
          changedBlocks: workerResponse.payload.changedBlocks,
          warnings: workerResponse.payload.warnings
        }
        emitResult(toolName, toolCallId, {
          ok: out.ok,
          code: out.code,
          summary: out.summary,
          newDocId: out.newDocId,
          changedCount: out.changedBlocks.length,
          warnings: out.warnings
        })
        input.emitActivity({
          actionType: 'docx_apply_ops',
          status: 'completed',
          summary: `编辑完成: ${out.changedBlocks.length} 处变更`
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        input.emitActivity({
          actionType: 'docx_apply_ops',
          status: 'failed',
          summary: `编辑失败: ${msg}`
        })
        throw error
      }
    },
    {
      name: 'docx_apply_ops',
      description:
        'Apply structured docx operations and return a new immutable docId snapshot with changed blocks.',
      schema: applyOpsSchema
    }
  )

  const docxRenderPreviewTool = tool(
    async (args) => {
      const toolName = 'docx_render_preview'
      const toolCallId = emitStarted(toolName, args)
      try {
        const previewDir = path.join(workspaceRootPath, '.ncurator', 'docx-previews')
        const previewPath = path.join(
          previewDir,
          `${input.runId}-${args.docId}-${Date.now().toString(36)}.docx`
        )
        const existsBefore = fs.existsSync(previewPath)
        const workerResponse = await callWorker({
          action: 'render_preview',
          payload: {
            docId: args.docId,
            format: args.format,
            previewPath
          }
        })
        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (workerResponse.payload.action !== 'render_preview') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (render_preview)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        const operation: AiFileArtifactOperation = existsBefore ? 'updated' : 'created'
        emitFileArtifactEvent({
          ctx: input.ctx,
          runId: input.runId,
          taskId: input.taskId,
          capability: 'docx',
          artifactPath: workerResponse.payload.previewPath,
          operation,
          summary: `docx preview generated (${workerResponse.payload.renderer})`
        })

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `preview generated (${workerResponse.payload.format})`,
          format: workerResponse.payload.format,
          previewPath: workerResponse.payload.previewPath,
          renderer: workerResponse.payload.renderer
        }
        emitResult(toolName, toolCallId, out)
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_render_preview',
      description:
        'Render preview artifact for the current doc snapshot. html returns a preview docx artifact path for renderer.',
      schema: renderPreviewSchema
    }
  )

  const docxSaveTool = tool(
    async (args) => {
      const toolName = 'docx_save'
      const toolCallId = emitStarted(toolName, args)
      try {
        const sourcePath = state.sourcePathByDocId.get(args.docId)
        const cwd = sourcePath ? path.dirname(sourcePath) : workspaceRootPath
        const outPath = resolveDocxPath({
          workspaceRootPath,
          cwd,
          rawPath: args.outPath
        })
        if (!outPath) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'outPath must be a workspace-bound .docx path'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        const existsBefore = fs.existsSync(outPath)
        if (existsBefore && !args.overwrite) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'outPath already exists, pass overwrite=true or use another path'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        if (existsBefore) {
          const decision = await input.ctx.requestApproval({
            runId: input.runId,
            taskId: input.taskId,
            command: `docx overwrite ${outPath}`,
            riskLevel: 'medium',
            reason: 'docx save may overwrite an existing file'
          })
          if (!decision.approved) {
            const out = toFailure({
              code: 'approval_denied',
              error: decision.reason || 'approval denied for overwrite'
            })
            emitResult(toolName, toolCallId, out, out.error)
            return out
          }
        }

        const workerResponse = await callWorker({
          action: 'save',
          payload: {
            docId: args.docId,
            outPath
          }
        })
        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (workerResponse.payload.action !== 'save') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (save)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        const operation: AiFileArtifactOperation = existsBefore ? 'updated' : 'created'
        emitFileArtifactEvent({
          ctx: input.ctx,
          runId: input.runId,
          taskId: input.taskId,
          capability: 'docx',
          artifactPath: outPath,
          operation,
          summary: `docx saved (${operation})`
        })

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `doc saved: ${path.basename(outPath)}`,
          outPath,
          checksum: workerResponse.payload.checksum,
          operation,
          byteSize: workerResponse.payload.byteSize
        }
        emitResult(toolName, toolCallId, out)
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_save',
      description: 'Save doc snapshot to a workspace docx path with overwrite approval guard.',
      schema: saveSchema
    }
  )

  const docxValidateTool = tool(
    async (args) => {
      const toolName = 'docx_validate'
      const toolCallId = emitStarted(toolName, args)
      try {
        const workerResponse = await callWorker({
          action: 'validate',
          payload: {
            docId: args.docId
          }
        })
        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (workerResponse.payload.action !== 'validate') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (validate)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        const out = {
          ok: true,
          code: 'ok' as const,
          summary:
            workerResponse.payload.problems.length === 0
              ? 'docx validate ok'
              : `docx validate with ${workerResponse.payload.problems.length} problems`,
          problems: workerResponse.payload.problems
        }
        emitResult(toolName, toolCallId, {
          ok: out.ok,
          code: out.code,
          summary: out.summary,
          problemsPreview: clipText(JSON.stringify(out.problems), input.safePreviewChars)
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_validate',
      description: 'Validate current doc snapshot structure and relationship consistency.',
      schema: validateSchema
    }
  )

  return {
    tools: [
      docxOpenTool,
      docxOutlineTool,
      docxGetBlockTool,
      docxSearchTool,
      docxApplyOpsTool,
      docxRenderPreviewTool,
      docxSaveTool,
      docxValidateTool
    ],
    state
  }
}
