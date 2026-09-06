import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import type {
  AiFileChangeOperation,
  AiFileChangeRecord,
  AiToolCallResult,
  IpcJsonObject,
  JsonObject
} from '../../../../../../shared/types'
import { emitFileArtifactEvent } from '../../../events/fileArtifacts'
import type { WorkspaceCapabilityBuildInput } from '../types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import {
  TEXT_FILE_EDIT_TOOL_SPEC,
  TEXT_FILE_READ_MAX_BYTES,
  TEXT_FILE_READ_MAX_LINE_CHARS,
  TEXT_FILE_READ_MAX_LINES,
  TEXT_FILE_READ_TOOL_SPEC,
  type FileEditInput,
  type FileReadInput,
  type FileReadOutput
} from './toolSpecs'
import { countTextFileDiffLines, createTextFileDiffArtifact } from './textDiff'
import {
  calculateBufferChecksum,
  decodeTextFile,
  encodeTextFile,
  normalizeToLf,
  resolveSafeTextFilePath,
  withTextFileMutationQueue
} from './textFileUtils'
import { getPartnerRuntimeDir } from '../../../../assets/WorkspaceAssetService'
import { buildTextFileSearchTool } from './textFileSearch'

type TextFileToolFailure = Error & {
  resultData?: JsonObject
}

type AppliedEdit = {
  message: string
  record?: AiFileChangeRecord
}

type MatchedReplacement = {
  start: number
  end: number
  newText: string
  editIndex?: number
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
    // Activity events must not change the file operation result.
  }
}

const countOccurrences = (content: string, search: string): number => {
  let count = 0
  let offset = 0
  while (offset <= content.length - search.length) {
    const match = content.indexOf(search, offset)
    if (match < 0) break
    count += 1
    offset = match + search.length
  }
  return count
}

const findAllOccurrences = (content: string, search: string): number[] => {
  const matches: number[] = []
  let offset = 0
  while (offset <= content.length - search.length) {
    const match = content.indexOf(search, offset)
    if (match < 0) break
    matches.push(match)
    offset = match + search.length
  }
  return matches
}

const applyReplacements = (content: string, replacements: MatchedReplacement[]): string => {
  let next = content
  for (const replacement of replacements.slice().sort((left, right) => right.start - left.start)) {
    next = `${next.slice(0, replacement.start)}${replacement.newText}${next.slice(replacement.end)}`
  }
  return next
}

const applyUniqueEdits = (
  content: string,
  edits: Extract<FileEditInput, { action: 'edit' }>['edits'],
  sourcePath: string
): { content: string; changeCount: number } => {
  const replacements: MatchedReplacement[] = edits.map((edit, editIndex) => {
    const oldText = normalizeToLf(edit.oldText)
    const newText = normalizeToLf(edit.newText)
    const occurrences = countOccurrences(content, oldText)
    if (occurrences === 0) {
      throw new Error(
        `在 ${sourcePath} 中找不到 edits[${editIndex}].oldText 对应的文本，必须精确匹配。`
      )
    }
    if (occurrences > 1) {
      throw new Error(
        `在 ${sourcePath} 中 edits[${editIndex}].oldText 匹配到 ${occurrences} 处，每个 oldText 必须恰好匹配一处。`
      )
    }
    const start = content.indexOf(oldText)
    return {
      start,
      end: start + oldText.length,
      newText,
      editIndex
    }
  })

  const ordered = replacements.slice().sort((left, right) => left.start - right.start)
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    if (previous && current && previous.end > current.start) {
      throw new Error(
        `在 ${sourcePath} 中 edits[${previous.editIndex}] 与 edits[${current.editIndex}] 的修改范围重叠。`
      )
    }
  }

  const nextContent = applyReplacements(content, replacements)
  if (nextContent === content) throw new Error(`在 ${sourcePath} 中未产生任何修改。`)
  return { content: nextContent, changeCount: edits.length }
}

const applyReplaceAll = (input: {
  content: string
  oldText: string
  newText: string
  sourcePath: string
}): { content: string; changeCount: number } => {
  const oldText = normalizeToLf(input.oldText)
  const newText = normalizeToLf(input.newText)
  if (oldText === newText) throw new Error(`在 ${input.sourcePath} 中未产生任何修改。`)
  const matches = findAllOccurrences(input.content, oldText)
  if (matches.length === 0) {
    throw new Error(`在 ${input.sourcePath} 中找不到 oldText 对应的文本。`)
  }
  const replacements = matches.map((start) => ({
    start,
    end: start + oldText.length,
    newText
  }))
  return {
    content: applyReplacements(input.content, replacements),
    changeCount: matches.length
  }
}

const ensureCreateTargetAvailable = async (sourcePath: string): Promise<void> => {
  try {
    await fs.lstat(sourcePath)
    throw new Error(`无法创建 ${sourcePath}：文件已存在。`)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}

const atomicReplaceFile = async (input: {
  sourcePath: string
  content: Buffer
  mode: number
  operationId: string
}): Promise<void> => {
  const tempPath = path.join(
    path.dirname(input.sourcePath),
    `.${path.basename(input.sourcePath)}.${input.operationId}.tmp`
  )
  try {
    await fs.writeFile(tempPath, input.content, { flag: 'wx', mode: input.mode })
    await fs.chmod(tempPath, input.mode)
    await fs.rename(tempPath, input.sourcePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

const buildEditMessage = (input: {
  action: FileEditInput['action']
  sourcePath: string
  changeCount: number
}): string => {
  if (input.action === 'create') return `已创建文件：${input.sourcePath}。`
  if (input.action === 'rewrite') return `已完整改写文件：${input.sourcePath}。`
  if (input.action === 'edit') {
    return `已在 ${input.sourcePath} 中应用 ${input.changeCount} 处修改。`
  }
  return `已在 ${input.sourcePath} 中替换 ${input.changeCount} 处内容。`
}

const editTextFile = async (
  buildInput: WorkspaceCapabilityBuildInput,
  args: FileEditInput
): Promise<AppliedEdit> => {
  const allowMissing = args.action === 'create'
  const sourcePath = await resolveSafeTextFilePath({
    sourcePath: args.sourcePath,
    allowMissing
  })

  return await withTextFileMutationQueue(sourcePath, async () => {
    const existingRecord = (await buildInput.ctx.listFileChangeRecords({ runId: buildInput.runId }))
      .filter(
        (record) =>
          record.capability === 'text_file' &&
          record.path === sourcePath &&
          record.status === 'applied'
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    const operationId = existingRecord?.id || randomUUID()
    const operation: AiFileChangeOperation =
      existingRecord?.operation || (args.action === 'create' ? 'created' : 'updated')
    let beforeBuffer: Buffer | undefined
    let beforeChecksum: string | undefined
    let beforeMode = 0o644
    let beforeNormalized = ''
    let afterNormalized = ''
    let afterBuffer: Buffer
    let changeCount = 1

    if (args.action === 'create') {
      await fs.mkdir(path.dirname(sourcePath), { recursive: true })
      await resolveSafeTextFilePath({
        sourcePath: args.sourcePath,
        allowMissing: true
      })
      await ensureCreateTargetAvailable(sourcePath)
      afterNormalized = normalizeToLf(args.content)
      afterBuffer = Buffer.from(args.content, 'utf-8')
    } else {
      await resolveSafeTextFilePath({
        sourcePath: args.sourcePath,
        allowMissing: false
      })
      const stats = await fs.stat(sourcePath)
      beforeMode = stats.mode
      beforeBuffer = await fs.readFile(sourcePath)
      beforeChecksum = calculateBufferChecksum(beforeBuffer)
      const decoded = decodeTextFile(beforeBuffer, args.sourcePath)
      beforeNormalized = decoded.normalizedContent

      if (args.action === 'rewrite') {
        afterNormalized = normalizeToLf(args.content)
        changeCount = 1
      } else if (args.action === 'edit') {
        const applied = applyUniqueEdits(beforeNormalized, args.edits, args.sourcePath)
        afterNormalized = applied.content
        changeCount = applied.changeCount
      } else {
        const applied = applyReplaceAll({
          content: beforeNormalized,
          oldText: args.oldText,
          newText: args.newText,
          sourcePath: args.sourcePath
        })
        afterNormalized = applied.content
        changeCount = applied.changeCount
      }

      afterBuffer = encodeTextFile({
        normalizedContent: afterNormalized,
        lineEnding: decoded.lineEnding,
        bom: decoded.bom
      })
      if (beforeBuffer.equals(afterBuffer))
        throw new Error(`在 ${args.sourcePath} 中未产生任何修改。`)
    }

    if (afterNormalized.includes('\0')) {
      throw new Error(`无法写入 ${args.sourcePath}：不支持二进制文本。`)
    }

    let baselineNormalized = beforeNormalized
    let recordBeforeSnapshotPath = beforeBuffer
      ? path.join(
          getPartnerRuntimeDir(buildInput.partnerId),
          'file-changes',
          buildInput.runId,
          `${operationId}.before`
        )
      : undefined
    let recordBeforeChecksum = beforeChecksum
    if (existingRecord?.operation === 'created') {
      baselineNormalized = ''
      recordBeforeSnapshotPath = undefined
      recordBeforeChecksum = undefined
    } else if (existingRecord) {
      if (!existingRecord.beforeSnapshotPath) {
        throw new Error(`无法更新 ${args.sourcePath}：原始快照缺失。`)
      }
      const baselineBuffer = await fs.readFile(existingRecord.beforeSnapshotPath)
      baselineNormalized = decodeTextFile(baselineBuffer, args.sourcePath).normalizedContent
      recordBeforeSnapshotPath = existingRecord.beforeSnapshotPath
      recordBeforeChecksum = existingRecord.beforeChecksum
    }

    const diffArtifact = createTextFileDiffArtifact({
      before: baselineNormalized,
      after: afterNormalized
    })
    const { insertCount, deleteCount } = countTextFileDiffLines(diffArtifact)
    const artifactRoot = path.join(
      getPartnerRuntimeDir(buildInput.partnerId),
      'file-changes',
      buildInput.runId
    )
    const beforeSnapshotPath = recordBeforeSnapshotPath
    const afterChecksum = calculateBufferChecksum(afterBuffer)
    let targetWritten = false

    try {
      await fs.mkdir(artifactRoot, { recursive: true })
      if (!existingRecord && beforeBuffer && beforeSnapshotPath) {
        await fs.writeFile(beforeSnapshotPath, beforeBuffer)
      }

      if (args.action === 'create') {
        await fs.writeFile(sourcePath, afterBuffer, { flag: 'wx', mode: 0o644 })
      } else {
        const currentBuffer = await fs.readFile(sourcePath)
        if (calculateBufferChecksum(currentBuffer) !== beforeChecksum) {
          throw new Error(`无法写入 ${args.sourcePath}：文件在操作期间被其他进程修改。`)
        }
        await atomicReplaceFile({
          sourcePath,
          content: afterBuffer,
          mode: beforeMode,
          operationId
        })
      }
      targetWritten = true

      const now = Date.now()
      const record: AiFileChangeRecord = {
        id: operationId,
        partnerId: buildInput.partnerId,
        runId: buildInput.runId,
        status: 'applied',
        capability: 'text_file',
        path: sourcePath,
        fileName: path.basename(sourcePath),
        operation,
        source: 'text_tool',
        beforePath: operation === 'updated' ? sourcePath : undefined,
        afterPath: sourcePath,
        changeCount: (existingRecord?.changeCount || 0) + changeCount,
        insertCount,
        deleteCount,
        beforeSnapshotPath,
        beforeChecksum: recordBeforeChecksum,
        afterChecksum,
        createdAt: existingRecord?.createdAt || now,
        updatedAt: now
      }
      await buildInput.ctx.saveFileChangeRecord(record)

      emitFileArtifactEvent({
        ctx: buildInput.ctx,
        runId: buildInput.runId,
        taskId: buildInput.taskId,
        capability: 'text_file',
        artifactPath: sourcePath,
        operation,
        applyId: operationId,
        changeCount: record.changeCount,
        insertCount: record.insertCount,
        deleteCount: record.deleteCount
      })

      return {
        message: buildEditMessage({
          action: args.action,
          sourcePath: args.sourcePath,
          changeCount
        }),
        record
      }
    } catch (error) {
      if (targetWritten) {
        if (beforeBuffer) {
          await atomicReplaceFile({
            sourcePath,
            content: beforeBuffer,
            mode: beforeMode,
            operationId: `${operationId}.rollback`
          }).catch(() => undefined)
        } else {
          await fs.rm(sourcePath, { force: true }).catch(() => undefined)
        }
      }
      if (!existingRecord && beforeSnapshotPath)
        await fs.rm(beforeSnapshotPath, { force: true }).catch(() => undefined)
      throw error
    }
  })
}

const truncateTextFileLine = (value: string): string => {
  const characters = Array.from(value)
  if (characters.length <= TEXT_FILE_READ_MAX_LINE_CHARS) return value
  return `${characters.slice(0, TEXT_FILE_READ_MAX_LINE_CHARS).join('')}... (line truncated to ${TEXT_FILE_READ_MAX_LINE_CHARS} characters)`
}

const TEXT_FILE_READ_CONTENT_MAX_BYTES = TEXT_FILE_READ_MAX_BYTES - 3_200

const readTextFile = async (args: FileReadInput): Promise<FileReadOutput> => {
  const sourcePath = await resolveSafeTextFilePath({
    sourcePath: args.sourcePath,
    allowMissing: false
  })
  const decoded = decodeTextFile(await fs.readFile(sourcePath), args.sourcePath)

  const lines = decoded.normalizedContent.split('\n')
  const totalLines = lines.length
  const startLine = args.startLine || 1
  if (startLine > totalLines) {
    throw new Error(
      `startLine ${startLine} is out of range for ${args.sourcePath} (${totalLines} lines)`
    )
  }
  const requestedEndLine = Math.min(
    totalLines,
    startLine + (args.lineCount || TEXT_FILE_READ_MAX_LINES) - 1
  )
  const selected: string[] = []
  let selectedBytes = 0
  let endLine = startLine - 1
  for (let lineNumber = startLine; lineNumber <= requestedEndLine; lineNumber += 1) {
    const line = truncateTextFileLine(lines[lineNumber - 1] || '')
    const displayedBytes = Buffer.byteLength(`${lineNumber}: ${line}\n`, 'utf8')
    if (selected.length > 0 && selectedBytes + displayedBytes > TEXT_FILE_READ_CONTENT_MAX_BYTES)
      break
    selected.push(line)
    selectedBytes += displayedBytes
    endLine = lineNumber
  }
  const content = selected.join('\n')
  const nextStartLine = endLine < totalLines ? endLine + 1 : undefined
  return {
    content,
    startLine,
    endLine,
    totalLines,
    ...(nextStartLine ? { nextStartLine } : {})
  }
}

export const buildTextFileCapabilityTools = (
  buildInput: WorkspaceCapabilityBuildInput
): { tools: StructuredToolInterface[] } => {
  const toolEvents = createToolEventEmitter({
    ctx: buildInput.ctx,
    runId: buildInput.runId,
    taskId: buildInput.taskId
  })

  const fileRead = tool(
    async (rawArgs) => {
      const args = rawArgs as FileReadInput
      safeEmitActivity(buildInput, {
        actionType: 'text_file_read',
        status: 'started',
        summary: args.sourcePath
      })
      return await withToolLifecycle({
        emitter: toolEvents,
        toolName: TEXT_FILE_READ_TOOL_SPEC.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          const payload = await readTextFile(args)
          session.succeed(
            undefined,
            toToolResult({ toolName: TEXT_FILE_READ_TOOL_SPEC.name, ok: true, data: payload })
          )
          safeEmitActivity(buildInput, {
            actionType: 'text_file_read',
            status: 'completed',
            summary: args.sourcePath
          })
          return payload
        },
        onError: (error, session) => {
          const failure = error as TextFileToolFailure
          session.fail(
            error.message,
            undefined,
            toToolResult({
              toolName: TEXT_FILE_READ_TOOL_SPEC.name,
              ok: false,
              data: failure.resultData || { error: error.message }
            })
          )
          safeEmitActivity(buildInput, {
            actionType: 'text_file_read',
            status: 'failed',
            summary: error.message
          })
        }
      })
    },
    {
      name: TEXT_FILE_READ_TOOL_SPEC.name,
      description: TEXT_FILE_READ_TOOL_SPEC.promptSpec.description,
      schema: TEXT_FILE_READ_TOOL_SPEC.inputSchema
    }
  )

  const fileEdit = tool(
    async (rawArgs) => {
      const args = rawArgs as FileEditInput
      safeEmitActivity(buildInput, {
        actionType: 'text_file_edit',
        status: 'started',
        summary: `${args.action}: ${args.sourcePath}`
      })
      return await withToolLifecycle({
        emitter: toolEvents,
        toolName: TEXT_FILE_EDIT_TOOL_SPEC.name,
        args: args as IpcJsonObject,
        execute: async (session) => {
          const applied = await editTextFile(buildInput, args)
          const payload = {}
          session.succeed(
            undefined,
            toToolResult({
              toolName: TEXT_FILE_EDIT_TOOL_SPEC.name,
              ok: true,
              data: payload
            })
          )
          safeEmitActivity(buildInput, {
            actionType: 'text_file_edit',
            status: 'completed',
            summary: applied.message
          })
          return applied.message
        },
        onError: (error, session) => {
          session.fail(
            error.message,
            undefined,
            toToolResult({
              toolName: TEXT_FILE_EDIT_TOOL_SPEC.name,
              ok: false,
              data: { error: error.message }
            })
          )
          safeEmitActivity(buildInput, {
            actionType: 'text_file_edit',
            status: 'failed',
            summary: error.message
          })
        }
      })
    },
    {
      name: TEXT_FILE_EDIT_TOOL_SPEC.name,
      description: TEXT_FILE_EDIT_TOOL_SPEC.promptSpec.description,
      schema: TEXT_FILE_EDIT_TOOL_SPEC.inputSchema
    }
  )

  return { tools: [fileRead, buildTextFileSearchTool(buildInput), fileEdit] }
}
