import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AiRunContext } from '../../types'
import { getWorkspaceToolResultDir } from '../../../assets/WorkspaceAssetService'

export const TOOL_RESULT_INLINE_MAX_CHARS = 32_000
export const TOOL_RESULT_HEAD_MAX_CHARS = 8_000

export const countUnicodeCharacters = (value: string): number => Array.from(value).length

export const sliceUnicodeCharacters = (value: string, maxChars: number): string =>
  Array.from(value).slice(0, maxChars).join('')

export const buildTruncatedToolResultMessage = (input: {
  filePath: string
  head: string
  totalChars: number
}): string =>
  JSON.stringify({
    truncated: true,
    filePath: input.filePath,
    totalChars: input.totalChars,
    head: input.head
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
  return { filePath, totalChars: countUnicodeCharacters(input.content) }
}

export const cleanupToolResultDir = async (ctx: AiRunContext): Promise<void> => {
  const directoryPath = resolvePersistedDir(ctx)
  if (!directoryPath) return
  await fs.rm(directoryPath, { recursive: true, force: true }).catch(() => undefined)
}
