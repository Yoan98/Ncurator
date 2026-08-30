import fs from 'node:fs/promises'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import type { AiToolCallResult, IpcJsonObject } from '../../../../../../shared/types'
import type { WorkspaceCapabilityBuildInput } from '../types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import {
  TEXT_FILE_SEARCH_CONTEXT_CHARS,
  TEXT_FILE_SEARCH_MATCH_TEXT_MAX_CHARS,
  TEXT_FILE_SEARCH_MAX_MATCHES,
  TEXT_FILE_SEARCH_TOOL_SPEC,
  type FileSearchInput,
  type FileSearchOutput
} from './toolSpecs'
import { decodeTextFile, resolveSafeTextFilePath } from './textFileUtils'

type TextFileToolFailure = Error & {
  resultData?: { error: string }
}

type MatchEntry = {
  jsIndex: number
  matchText: string
}

const toToolResult = (input: {
  toolName: string
  ok: boolean
  data: AiToolCallResult['data']
}): AiToolCallResult => ({
  toolName: input.toolName,
  ok: input.ok,
  data: input.data
})

const safeEmitActivity = (
  input: WorkspaceCapabilityBuildInput,
  activity: Parameters<WorkspaceCapabilityBuildInput['emitActivity']>[0]
): void => {
  try {
    input.emitActivity(activity)
  } catch {
    // Activity events must not change the search result.
  }
}

const clipText = (text: string, maxChars: number): { text: string; truncated: boolean } => {
  const chars = Array.from(text)
  if (chars.length <= maxChars) return { text, truncated: false }
  return { text: chars.slice(0, maxChars).join(''), truncated: true }
}

const collectMatches = (input: {
  content: string
  query: string
  mode: 'literal' | 'regex'
}): { totalMatchCount: number; matches: MatchEntry[] } => {
  if (input.mode === 'regex') {
    let regex: RegExp
    try {
      regex = new RegExp(input.query, 'g')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`正则表达式无效：${message}`)
    }
    const matches: MatchEntry[] = []
    let totalMatchCount = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(input.content)) !== null) {
      totalMatchCount += 1
      if (matches.length < TEXT_FILE_SEARCH_MAX_MATCHES) {
        matches.push({ jsIndex: match.index, matchText: match[0] })
      }
      if (match[0].length === 0) regex.lastIndex += 1
    }
    return { totalMatchCount, matches }
  }

  const matches: MatchEntry[] = []
  let totalMatchCount = 0
  let from = 0
  while (true) {
    const index = input.content.indexOf(input.query, from)
    if (index < 0) break
    totalMatchCount += 1
    if (matches.length < TEXT_FILE_SEARCH_MAX_MATCHES) {
      matches.push({ jsIndex: index, matchText: input.query })
    }
    from = index + input.query.length
  }
  return { totalMatchCount, matches }
}

export const searchTextFile = async (args: FileSearchInput): Promise<FileSearchOutput> => {
  const sourcePath = await resolveSafeTextFilePath({
    sourcePath: args.sourcePath,
    allowMissing: false
  })
  const decoded = decodeTextFile(await fs.readFile(sourcePath), args.sourcePath)
  const content = decoded.normalizedContent
  const mode = args.mode || 'literal'
  const collected = collectMatches({ content, query: args.query, mode })
  let scanJsOffset = 0
  let line = 1
  let lineStartJsOffset = 0

  const matches = collected.matches.map((match) => {
    while (scanJsOffset < match.jsIndex) {
      const codePoint = content.codePointAt(scanJsOffset)
      if (codePoint === undefined) break
      const width = codePoint > 0xffff ? 2 : 1
      scanJsOffset += width
      if (codePoint === 10) {
        line += 1
        lineStartJsOffset = scanJsOffset
      }
    }
    const lineEndJsOffset = content.indexOf('\n', match.jsIndex)
    const lineText = content.slice(
      lineStartJsOffset,
      lineEndJsOffset < 0 ? content.length : lineEndJsOffset
    )
    const lineInnerCpOffset = Array.from(content.slice(lineStartJsOffset, match.jsIndex)).length
    const clippedMatch = clipText(match.matchText, TEXT_FILE_SEARCH_MATCH_TEXT_MAX_CHARS)

    const lineChars = Array.from(lineText)
    let textContext = lineText
    let contextTruncated = false
    if (lineChars.length > TEXT_FILE_SEARCH_CONTEXT_CHARS) {
      const half = Math.floor(TEXT_FILE_SEARCH_CONTEXT_CHARS / 2)
      const from = Math.max(0, lineInnerCpOffset - half)
      const to = Math.min(lineChars.length, lineInnerCpOffset + half)
      textContext = lineChars.slice(from, to).join('')
      contextTruncated = true
    }

    return {
      line,
      matchText: clippedMatch.text,
      textContext,
      truncated: clippedMatch.truncated || contextTruncated
    }
  })

  return {
    totalMatchCount: collected.totalMatchCount,
    returnedMatchCount: matches.length,
    matches
  }
}

export const buildTextFileSearchTool = (
  buildInput: WorkspaceCapabilityBuildInput
): StructuredToolInterface => {
  const toolEvents = createToolEventEmitter({
    ctx: buildInput.ctx,
    runId: buildInput.runId,
    taskId: buildInput.taskId
  })

  return tool(
    async (rawArgs) => {
      const args = rawArgs as FileSearchInput
      safeEmitActivity(buildInput, {
        actionType: 'text_file_search',
        status: 'started',
        summary: `${args.sourcePath} / ${args.query}`
      })
      return await withToolLifecycle({
        emitter: toolEvents,
        toolName: TEXT_FILE_SEARCH_TOOL_SPEC.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          const payload = await searchTextFile(args)
          session.succeed(
            undefined,
            toToolResult({ toolName: TEXT_FILE_SEARCH_TOOL_SPEC.name, ok: true, data: payload })
          )
          safeEmitActivity(buildInput, {
            actionType: 'text_file_search',
            status: 'completed',
            summary: `${args.sourcePath} 命中 ${payload.returnedMatchCount} 处`
          })
          return payload
        },
        onError: (error, session) => {
          const failure = error as TextFileToolFailure
          session.fail(
            error.message,
            undefined,
            toToolResult({
              toolName: TEXT_FILE_SEARCH_TOOL_SPEC.name,
              ok: false,
              data: failure.resultData || { error: error.message }
            })
          )
          safeEmitActivity(buildInput, {
            actionType: 'text_file_search',
            status: 'failed',
            summary: error.message
          })
        }
      })
    },
    {
      name: TEXT_FILE_SEARCH_TOOL_SPEC.name,
      description: TEXT_FILE_SEARCH_TOOL_SPEC.promptSpec.description,
      schema: TEXT_FILE_SEARCH_TOOL_SPEC.inputSchema
    }
  )
}
