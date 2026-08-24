import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AiRunContext } from '../../types'
import { getWorkspaceToolResultDir } from '../../../assets/WorkspaceAssetService'

// 工具结果过大时不再硬失败：完整结果落盘到 runtime/toolresult 一次性目录，
// 模型侧只收到截断后的前缀 head（与 maxChars 相同长度），需要完整内容时通过 text-file-read 读取落盘文件。
// 字符串数量上限（而非 token 估算）：通过变量统一控制。
export const TOOL_RESULT_MAX_CHARS = 80_000

// 组装模型侧收到的截断工具结果消息（完整结果已落盘，head 为与 maxChars 同长的前缀）。
export const buildTruncatedToolResultMessage = (input: {
  toolName: string
  filePath: string
  head: string
  totalChars: number
}): string =>
  JSON.stringify({
    truncated: true,
    toolName: input.toolName,
    filePath: input.filePath,
    maxChars: TOOL_RESULT_MAX_CHARS,
    totalChars: input.totalChars,
    head: input.head,
    hint: `结果超过 ${TOOL_RESULT_MAX_CHARS} 字符（truncated），完整内容已落盘到 ${input.filePath}（共 ${input.totalChars} 字符）。需要剩余内容时可用 text-file-read 读取该文件，配合 startLine/lineCount 分段读取。`
  })

const getResultRef = (toolCallId: string): string =>
  path.basename(String(toolCallId || '').trim()).replace(/\.(?:json|log)$/i, '')

const resolvePersistedDir = (ctx: AiRunContext): string | undefined => {
  const rootPath = ctx.workspace?.rootPath
  if (!rootPath) return undefined
  return path.join(getWorkspaceToolResultDir(rootPath), ctx.runId)
}

export const persistToolResult = async (input: {
  ctx: AiRunContext
  toolCallId: string
  content: string
}): Promise<{ filePath: string; totalChars: number } | undefined> => {
  const directoryPath = resolvePersistedDir(input.ctx)
  if (!directoryPath) return undefined
  const resultRef = getResultRef(input.toolCallId)
  const filePath = path.join(directoryPath, `${resultRef}.log`)
  await fs.mkdir(directoryPath, { recursive: true })
  await fs.writeFile(filePath, input.content, 'utf8')
  return { filePath, totalChars: input.content.length }
}

export const cleanupToolResultDir = async (ctx: AiRunContext): Promise<void> => {
  const directoryPath = resolvePersistedDir(ctx)
  if (!directoryPath) return
  await fs.rm(directoryPath, { recursive: true, force: true }).catch(() => undefined)
}
