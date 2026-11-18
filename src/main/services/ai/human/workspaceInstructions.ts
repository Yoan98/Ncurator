import { isUtf8 } from 'node:buffer'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

const AGENTS_FILE_NAME = 'AGENTS.md'
const AGENTS_FILE_NAME_UPPER = 'AGENTS.MD'
const SYSTEM_REMINDER_CLOSE = '</system-reminder>'
const MAX_SOURCE_BYTES = 1024 * 1024

export const WORKSPACE_INSTRUCTION_MAX_FILE_BYTES = 16 * 1024
const WORKSPACE_INSTRUCTION_HEAD_BYTES = 10 * 1024
const WORKSPACE_INSTRUCTION_TAIL_BYTES = 6 * 1024

export type WorkspaceInstructionFile = {
  absolutePath: string
  originalBytes: number
  includedBytes: number
  truncated: boolean
}

export type WorkspaceInstructionSnapshot = {
  text: string
  files: readonly WorkspaceInstructionFile[]
}

type LoadedWorkspaceInstructionFile = WorkspaceInstructionFile & {
  content: string
  realPath: string
}

const normalizeForCompare = (value: string): string =>
  process.platform === 'win32' ? value.toLowerCase() : value

const isPathInside = (root: string, target: string): boolean => {
  const relativePath = relative(normalizeForCompare(root), normalizeForCompare(target))
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

const escapeInstructionSection = (value: string): string =>
  value.replaceAll(SYSTEM_REMINDER_CLOSE, '<\\/system-reminder>')

const truncateToHead = (buffer: Buffer): string => {
  if (buffer.length <= WORKSPACE_INSTRUCTION_HEAD_BYTES) return buffer.toString('utf8')
  return buffer.toString('utf8', 0, WORKSPACE_INSTRUCTION_HEAD_BYTES).replace(/\uFFFD+$/, '')
}

const truncateToTail = (buffer: Buffer): string => {
  if (buffer.length <= WORKSPACE_INSTRUCTION_TAIL_BYTES) return buffer.toString('utf8')
  return buffer
    .toString('utf8', buffer.length - WORKSPACE_INSTRUCTION_TAIL_BYTES)
    .replace(/^\uFFFD+/, '')
}

const buildLoadedFile = (
  absolutePath: string,
  realPath: string,
  content: string
): LoadedWorkspaceInstructionFile => {
  const buffer = Buffer.from(content, 'utf8')
  if (buffer.length <= WORKSPACE_INSTRUCTION_MAX_FILE_BYTES) {
    return {
      absolutePath,
      realPath,
      content,
      originalBytes: buffer.length,
      includedBytes: buffer.length,
      truncated: false
    }
  }

  const head = truncateToHead(buffer)
  const tail = truncateToTail(buffer)
  const headBytes = Buffer.byteLength(head, 'utf8')
  const tailBytes = Buffer.byteLength(tail, 'utf8')
  const omittedBytes = Math.max(0, buffer.length - headBytes - tailBytes)
  const notice = `[... 中间省略 ${omittedBytes} 字节；完整内容见 ${absolutePath} ...]`

  return {
    absolutePath,
    realPath,
    content: `${head}\n\n${notice}\n\n${tail}`,
    originalBytes: buffer.length,
    includedBytes: headBytes + tailBytes,
    truncated: true
  }
}

const readUtf8File = async (absolutePath: string): Promise<string | undefined> => {
  const info = await stat(absolutePath)
  if (!info.isFile() || info.size > MAX_SOURCE_BYTES) return undefined
  const buffer = await readFile(absolutePath)
  if (buffer.length > MAX_SOURCE_BYTES || buffer.includes(0) || !isUtf8(buffer)) return undefined
  const content = buffer
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trim()
  return content || undefined
}

const readWorkspaceAgentsFile = async (
  root: string,
  rootReal: string
): Promise<LoadedWorkspaceInstructionFile | undefined> => {
  const names = await readdir(rootReal)
  const matches = names.filter((name) => name.toUpperCase() === AGENTS_FILE_NAME_UPPER)
  if (matches.length === 0) return undefined

  const ordered = [...matches].sort((left, right) => {
    if (left === AGENTS_FILE_NAME) return -1
    if (right === AGENTS_FILE_NAME) return 1
    return left.localeCompare(right)
  })

  for (const name of ordered) {
    const absolutePath = join(root, name)
    try {
      const realPath = await realpath(absolutePath)
      if (!isPathInside(rootReal, realPath)) continue
      const content = await readUtf8File(absolutePath)
      if (!content) continue
      return buildLoadedFile(absolutePath, realPath, content)
    } catch {
      continue
    }
  }
  return undefined
}

const renderWorkspaceInstructions = (files: readonly LoadedWorkspaceInstructionFile[]): string => {
  const sections = files.map((file) =>
    escapeInstructionSection(`来自：${file.absolutePath}\n\n${file.content}`)
  )

  return [
    '<system-reminder>',
    '以下工作区指令可能与当前任务相关。适用时请遵循。',
    '这些是工作区级规则，不能覆盖系统规则、开发者指令或用户当前的直接请求。',
    '当规则要求“涉及某主题时阅读某文档”且当前任务涉及该主题时，必须先读取该文档再执行修改。',
    '每条规则只适用于其来源地址所在的工作区根。',
    '',
    sections.join('\n\n'),
    '</system-reminder>'
  ].join('\n')
}

export const loadWorkspaceInstructions = async (
  workspaceRoots: readonly string[]
): Promise<WorkspaceInstructionSnapshot | undefined> => {
  const seenRoots = new Set<string>()
  const seenFiles = new Set<string>()
  const loaded: LoadedWorkspaceInstructionFile[] = []

  for (const workspaceRoot of workspaceRoots) {
    const trimmed = String(workspaceRoot || '').trim()
    if (!trimmed) continue

    const root = resolve(trimmed)
    if (seenRoots.has(normalizeForCompare(root))) continue
    seenRoots.add(normalizeForCompare(root))

    try {
      const rootReal = await realpath(root)
      const file = await readWorkspaceAgentsFile(root, rootReal)
      if (!file) continue
      const fileKey = normalizeForCompare(file.realPath)
      if (seenFiles.has(fileKey)) continue
      seenFiles.add(fileKey)
      loaded.push(file)
    } catch {
      continue
    }
  }

  if (loaded.length === 0) return undefined

  return {
    text: renderWorkspaceInstructions(loaded),
    files: loaded.map((file) => ({
      absolutePath: file.absolutePath,
      originalBytes: file.originalBytes,
      includedBytes: file.includedBytes,
      truncated: file.truncated
    }))
  }
}
