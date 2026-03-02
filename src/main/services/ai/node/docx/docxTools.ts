import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import type { AiTaskResultCode } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import { emitFileArtifactEvent } from '../../../../utils/fileArtifacts'
import { resolveWorkspacePath } from '../terminal_exec/terminalPolicy'
import { applyDocxEdits, inspectDocx, saveDocxFromText } from './docxAdapters'

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

export type DocxToolFinishState = {
  done: boolean
  success: boolean
  summary?: string
  resultCode?: AiTaskResultCode
}

export type DocxCapabilityToolsRuntimeState = {
  /** docx_finish 调用后的完成状态。 */
  finish: DocxToolFinishState
  /** 当前加载并可编辑的源文件路径（workspace 内绝对路径）。 */
  sourcePath?: string
  /** 当前内存编辑文本快照。 */
  workingText?: string
  /** 最近一次成功保存的输出路径。 */
  outputPath?: string
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

const docxEditSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('replace_text'),
    find: z.string(),
    replace: z.string(),
    replaceAll: z.boolean().optional()
  }),
  z.object({
    type: z.literal('append_paragraph'),
    text: z.string()
  })
])

const docxInspectSchema = z.object({
  sourcePath: z.string()
})

const docxApplySchema = z.object({
  sourcePath: z.string().optional(),
  edits: z.array(docxEditSchema).min(1)
})

const docxSaveSchema = z.object({
  outputPath: z.string(),
  overwrite: z.boolean().optional()
})

const docxFinishSchema = z.object({
  success: z.boolean(),
  summary: z.string().optional(),
  resultCode: z
    .enum(['ok', 'failed', 'approval_denied', 'bounded_loop_error', 'invalid_input'])
    .optional()
})

export const buildDocxCapabilityTools = (input: DocxCapabilityToolsInput) => {
  const state: DocxCapabilityToolsRuntimeState = {
    finish: {
      done: false,
      success: false
    }
  }

  const workspaceRootPath = path.resolve(input.workspaceRootPath)

  const emitStarted = (toolName: string, args: unknown) => {
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

  const emitResult = (toolName: string, toolCallId: string, outputPreview: unknown, error?: string) => {
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

  const docxInspectTool = tool(
    async (args) => {
      const toolName = 'docx_inspect'
      const toolCallId = emitStarted(toolName, args)
      try {
        input.ctx.checkCancelled()
        const sourcePath = resolveDocxPath({
          workspaceRootPath,
          cwd: workspaceRootPath,
          rawPath: args.sourcePath
        })
        if (!sourcePath) {
          const out = {
            ok: false,
            code: 'invalid_input' as const,
            error: 'sourcePath must be a workspace-bound .docx path'
          }
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (!fs.existsSync(sourcePath)) {
          const out = {
            ok: false,
            code: 'invalid_input' as const,
            error: 'sourcePath not found'
          }
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        input.emitActivity({
          actionType: 'docx_inspect',
          status: 'started',
          summary: `检查文档: ${sourcePath}`
        })

        const inspection = await inspectDocx(sourcePath, input.safePreviewChars)
        state.sourcePath = sourcePath
        state.workingText = inspection.text

        const out = {
          ok: true,
          sourcePath: inspection.sourcePath,
          charCount: inspection.charCount,
          paragraphCount: inspection.paragraphCount,
          preview: inspection.preview,
          truncated: inspection.preview.length < inspection.text.length
        }
        emitResult(toolName, toolCallId, out)
        input.emitActivity({
          actionType: 'docx_inspect',
          status: 'completed',
          summary: `文档解析完成: ${inspection.paragraphCount} 段`
        })
        return out
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        emitResult(toolName, toolCallId, { ok: false, code: 'failed', error: msg }, msg)
        input.emitActivity({
          actionType: 'docx_inspect',
          status: 'failed',
          summary: `文档解析失败: ${msg}`
        })
        throw error
      }
    },
    {
      name: 'docx_inspect',
      description:
        'Inspect a workspace-bound .docx file and load deterministic editable text representation for subsequent edits.',
      schema: docxInspectSchema
    }
  )

  const docxApplyEditsTool = tool(
    async (args) => {
      const toolName = 'docx_apply_edits'
      const toolCallId = emitStarted(toolName, args)
      try {
        input.ctx.checkCancelled()

        if (!state.workingText || !state.sourcePath) {
          const sourcePath = String(args.sourcePath || '').trim()
          if (!sourcePath) {
            const out = {
              ok: false,
              code: 'invalid_input' as const,
              error: 'docx_inspect must run before docx_apply_edits'
            }
            emitResult(toolName, toolCallId, out, out.error)
            return out
          }
          const resolved = resolveDocxPath({
            workspaceRootPath,
            cwd: workspaceRootPath,
            rawPath: sourcePath
          })
          if (!resolved || !fs.existsSync(resolved)) {
            const out = {
              ok: false,
              code: 'invalid_input' as const,
              error: 'sourcePath not found or outside workspace'
            }
            emitResult(toolName, toolCallId, out, out.error)
            return out
          }
          const inspection = await inspectDocx(resolved, input.safePreviewChars)
          state.sourcePath = inspection.sourcePath
          state.workingText = inspection.text
        }

        input.emitActivity({
          actionType: 'docx_apply_edits',
          status: 'started',
          summary: `应用编辑指令: ${args.edits.length} 条`
        })

        const applied = applyDocxEdits({
          currentText: state.workingText || '',
          edits: args.edits
        })
        state.workingText = applied.updatedText

        const out = {
          ok: true,
          appliedCount: applied.appliedCount,
          warningCount: applied.warnings.length,
          warnings: applied.warnings,
          charCount: applied.updatedText.length,
          preview: clipText(applied.updatedText, input.safePreviewChars),
          truncated: applied.updatedText.length > input.safePreviewChars
        }
        emitResult(toolName, toolCallId, out)
        input.emitActivity({
          actionType: 'docx_apply_edits',
          status: 'completed',
          summary: `文档编辑完成: ${applied.appliedCount} 条已应用`
        })
        return out
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        emitResult(toolName, toolCallId, { ok: false, code: 'failed', error: msg }, msg)
        input.emitActivity({
          actionType: 'docx_apply_edits',
          status: 'failed',
          summary: `文档编辑失败: ${msg}`
        })
        throw error
      }
    },
    {
      name: 'docx_apply_edits',
      description:
        'Apply deterministic edit operations to the in-memory docx text state (replace_text and append_paragraph).',
      schema: docxApplySchema
    }
  )

  const docxSaveOutputTool = tool(
    async (args) => {
      const toolName = 'docx_save_output'
      const toolCallId = emitStarted(toolName, args)
      try {
        input.ctx.checkCancelled()
        if (!state.workingText || !state.sourcePath) {
          const out = {
            ok: false,
            code: 'invalid_input' as const,
            error: 'docx_inspect/docx_apply_edits must run before save'
          }
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        const outputPath = resolveDocxPath({
          workspaceRootPath,
          cwd: path.dirname(state.sourcePath),
          rawPath: args.outputPath
        })
        if (!outputPath) {
          const out = {
            ok: false,
            code: 'invalid_input' as const,
            error: 'outputPath must be a workspace-bound .docx path'
          }
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        const existsBefore = fs.existsSync(outputPath)
        const overwriteRequested = Boolean(args.overwrite)
        if (existsBefore && !overwriteRequested) {
          const out = {
            ok: false,
            code: 'invalid_input' as const,
            error: 'outputPath already exists, pass overwrite=true or use another path'
          }
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        if (existsBefore || outputPath === state.sourcePath) {
          const decision = await input.ctx.requestApproval({
            runId: input.runId,
            taskId: input.taskId,
            command: `docx overwrite ${outputPath}`,
            riskLevel: 'medium',
            reason: 'docx save operation may overwrite existing content'
          })
          if (!decision.approved) {
            const denied = {
              ok: false,
              code: 'approval_denied' as const,
              error: decision.reason || 'approval denied for docx overwrite'
            }
            emitResult(toolName, toolCallId, denied, denied.error)
            return denied
          }
        }

        input.emitActivity({
          actionType: 'docx_save_output',
          status: 'started',
          summary: `保存文档: ${outputPath}`
        })

        const saved = await saveDocxFromText({
          outputPath,
          text: state.workingText
        })
        state.outputPath = outputPath

        const operation = existsBefore ? 'updated' : 'created'
        emitFileArtifactEvent({
          ctx: input.ctx,
          runId: input.runId,
          taskId: input.taskId,
          capability: 'docx',
          artifactPath: outputPath,
          operation,
          summary: `docx output saved (${operation})`,
          onNonFatalError: (reason) => {
            input.emitActivity({
              actionType: 'file_artifact',
              status: 'failed',
              summary: reason
            })
          }
        })

        const out = {
          ok: true,
          outputPath,
          byteSize: saved.byteSize,
          operation
        }
        emitResult(toolName, toolCallId, out)
        input.emitActivity({
          actionType: 'docx_save_output',
          status: 'completed',
          summary: `保存完成: ${path.basename(outputPath)}`
        })
        return out
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        emitResult(toolName, toolCallId, { ok: false, code: 'failed', error: msg }, msg)
        input.emitActivity({
          actionType: 'docx_save_output',
          status: 'failed',
          summary: `文档保存失败: ${msg}`
        })
        throw error
      }
    },
    {
      name: 'docx_save_output',
      description:
        'Save current edited docx text into a workspace-bound output .docx file with overwrite approval gating.',
      schema: docxSaveSchema
    }
  )

  const docxFinishTool = tool(
    async (args) => {
      const toolName = 'docx_finish'
      const toolCallId = emitStarted(toolName, args)
      const summary = String(args.summary || '').trim()
      state.finish = {
        done: true,
        success: Boolean(args.success),
        summary: summary || undefined,
        resultCode: args.resultCode
      }
      const result = {
        done: true,
        success: state.finish.success,
        summary: state.finish.summary,
        resultCode: state.finish.resultCode,
        outputPath: state.outputPath
      }
      emitResult(toolName, toolCallId, result)
      return result
    },
    {
      name: 'docx_finish',
      description:
        'Mark docx capability as finished after inspect/apply/save loop reaches goal or cannot continue.',
      schema: docxFinishSchema
    }
  )

  return {
    tools: [docxInspectTool, docxApplyEditsTool, docxSaveOutputTool, docxFinishTool],
    state
  }
}
