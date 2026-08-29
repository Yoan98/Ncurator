import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AiRunContext } from '../../types'
import { getWorkspaceToolResultDir } from '../../../assets/WorkspaceAssetService'

export const TOOL_RESULT_INLINE_MAX_CHARS = 32_000
export const TOOL_RESULT_HEAD_MAX_CHARS = 6_000
export const TOOL_RESULT_TAIL_MAX_CHARS = 2_000

export const countUnicodeCharacters = (value: string): number => Array.from(value).length

export const sliceUnicodeCharacters = (value: string, maxChars: number): string =>
  Array.from(value).slice(0, maxChars).join('')

export const sliceUnicodeCharactersFromEnd = (value: string, maxChars: number): string => {
  const characters = Array.from(value)
  return characters.slice(Math.max(0, characters.length - maxChars)).join('')
}

export const countUtf8Bytes = (value: string): number => Buffer.byteLength(value, 'utf8')

export const countPhysicalLines = (value: string): number => value.split(/\r\n|\r|\n/u).length

export const buildTruncatedToolResultMessage = (input: {
  filePath: string
  head: string
  tail: string
  totalChars: number
  totalBytes: number
  totalLines: number
}): string =>
  [
    'Result too large to include inline.',
    `Full result: ${input.filePath}`,
    `You MUST call text_file_read tool to read the full result. Do not use the terminal to open or search this file.`,
    `Size: ${input.totalChars.toLocaleString('en-US')} characters; ${input.totalBytes.toLocaleString('en-US')} UTF-8 bytes; ${input.totalLines.toLocaleString('en-US')} lines.`,
    'Preview (head):',
    input.head,
    '... [content omitted] ...',
    'Preview (tail):',
    input.tail
  ].join('\n')

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
  const filePath = path.join(directoryPath, `${resultRef}.txt`)
  await fs.mkdir(directoryPath, { recursive: true })
  await fs.writeFile(filePath, input.content, 'utf8')
  return { filePath, totalChars: countUnicodeCharacters(input.content) }
}

export const cleanupToolResultDir = async (ctx: AiRunContext): Promise<void> => {
  const directoryPath = resolvePersistedDir(ctx)
  if (!directoryPath) return
  await fs.rm(directoryPath, { recursive: true, force: true }).catch(() => undefined)
}
