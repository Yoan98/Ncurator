import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isPathInsideRoot, resolveWorkspacePath } from '../terminal/commandPolicy'

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
    throw new Error(`Cannot read ${sourcePath}: binary files are not supported.`)
  }
  const bom = buffer.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)
  const body = bom ? buffer.subarray(UTF8_BOM.length) : buffer
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    throw new Error(`Cannot read ${sourcePath}: the file is not valid UTF-8 text.`)
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
  workspaceRootPath: string
  allowMissing: boolean
}): Promise<string> => {
  const resolved = resolveWorkspacePath({
    rawPath: input.sourcePath,
    cwd: input.workspaceRootPath,
    rootPath: input.workspaceRootPath
  })
  if (!resolved) throw new Error(`Invalid file path: ${input.sourcePath}.`)

  const realRoot = await fs.realpath(input.workspaceRootPath)
  const existingAncestor = await findExistingAncestor(
    input.allowMissing ? path.dirname(resolved) : resolved
  )
  const realAncestor = await fs.realpath(existingAncestor)
  if (!isPathInsideRoot(realAncestor, realRoot)) {
    throw new Error(`Invalid file path: ${input.sourcePath}.`)
  }

  if (!input.allowMissing) {
    const stats = await fs.lstat(resolved)
    if (stats.isSymbolicLink())
      throw new Error(`Cannot access ${input.sourcePath}: symbolic links are not supported.`)
    if (!stats.isFile())
      throw new Error(`Cannot access ${input.sourcePath}: path is not a regular file.`)
    const realTarget = await fs.realpath(resolved)
    if (!isPathInsideRoot(realTarget, realRoot)) {
      throw new Error(`Invalid file path: ${input.sourcePath}.`)
    }
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
