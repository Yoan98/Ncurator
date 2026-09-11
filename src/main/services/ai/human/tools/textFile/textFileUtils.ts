import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveToolPath } from '../terminal/commandPolicy'

export type DecodedTextFile = {
  bom: boolean
  content: string
  normalizedContent: string
  lineEnding: '\n' | '\r\n'
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

export const calculateBufferChecksum = (buffer: Buffer): string =>
  createHash('sha256').update(buffer).digest('hex')

export const normalizeToLf = (text: string): string =>
  text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

export const detectLineEnding = (text: string): '\n' | '\r\n' => {
  const firstLf = text.indexOf('\n')
  if (firstLf > 0 && text[firstLf - 1] === '\r') return '\r\n'
  return '\n'
}

export const restoreLineEnding = (text: string, lineEnding: '\n' | '\r\n'): string =>
  lineEnding === '\r\n' ? text.replace(/\n/g, '\r\n') : text

export const decodeTextFile = (buffer: Buffer, sourcePath: string): DecodedTextFile => {
  if (buffer.includes(0)) {
    throw new Error(`无法读取 ${sourcePath}：不支持二进制文件。`)
  }
  const bom = buffer.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)
  const body = bom ? buffer.subarray(UTF8_BOM.length) : buffer
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    throw new Error(`无法读取 ${sourcePath}：文件不是有效的 UTF-8 文本。`)
  }
  return {
    bom,
    content,
    normalizedContent: normalizeToLf(content),
    lineEnding: detectLineEnding(content)
  }
}

export const encodeTextFile = (input: {
  normalizedContent: string
  lineEnding: '\n' | '\r\n'
  bom: boolean
}): Buffer => {
  const body = Buffer.from(restoreLineEnding(input.normalizedContent, input.lineEnding), 'utf-8')
  return input.bom ? Buffer.concat([UTF8_BOM, body]) : body
}

const findExistingAncestor = async (targetPath: string): Promise<string> => {
  let candidate = targetPath
  while (true) {
    try {
      await fs.lstat(candidate)
      return candidate
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      const parent = path.dirname(candidate)
      if (parent === candidate) return candidate
      candidate = parent
    }
  }
}

export const resolveSafeTextFilePath = async (input: {
  sourcePath: string
  allowMissing: boolean
}): Promise<string> => {
  const resolved = resolveToolPath(input.sourcePath)
  if (!resolved) throw new Error(`无效的文件路径：${input.sourcePath}。`)

  const existingAncestor = await findExistingAncestor(
    input.allowMissing ? path.dirname(resolved) : resolved
  )
  await fs.realpath(existingAncestor)

  if (!input.allowMissing) {
    const stats = await fs.lstat(resolved)
    if (stats.isSymbolicLink())
      throw new Error(`无法访问 ${input.sourcePath}：不支持符号链接。`)
    if (!stats.isFile())
      throw new Error(`无法访问 ${input.sourcePath}：路径不是普通文件。`)
    await fs.realpath(resolved)
  }

  return resolved
}

const mutationQueues = new Map<string, Promise<void>>()

export const withTextFileMutationQueue = async <T>(
  sourcePath: string,
  operation: () => Promise<T>
): Promise<T> => {
  const previous = mutationQueues.get(sourcePath) || Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => undefined).then(() => current)
  mutationQueues.set(sourcePath, tail)
  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
    if (mutationQueues.get(sourcePath) === tail) mutationQueues.delete(sourcePath)
  }
}
