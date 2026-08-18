import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export type TextFileWriteResult = {
  ok: boolean
  conflict?: boolean
  error?: string
  hash?: string
}

const sha256Hex = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

/**
 * 原子写入 UTF-8 文本文件（临时文件 + rename）。
 * - 校验内容可无损按 UTF-8 编码往返，拦截孤立代理对等非法序列。
 * - 传入 expectedHash 时与磁盘当前内容比对，不一致返回 conflict 拒绝覆盖。
 * - 写入成功返回最终文件 SHA-256。
 */
export const writeTextFileAtomically = (
  filePath: string,
  content: string,
  expectedHash?: string
): TextFileWriteResult => {
  const encoded = Buffer.from(content, 'utf8')
  if (encoded.toString('utf8') !== content) {
    return { ok: false, error: 'content is not valid UTF-8' }
  }

  if (expectedHash) {
    if (!fs.existsSync(filePath)) return { ok: false, error: 'file not found' }
    if (sha256Hex(fs.readFileSync(filePath)) !== expectedHash) {
      return { ok: false, conflict: true, error: '文件已被外部修改，请确认后覆盖' }
    }
  }

  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true })
  const temporaryPath = path.join(
    directory,
    `.ncurator-write-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  )
  try {
    fs.writeFileSync(temporaryPath, encoded, { mode: 0o644 })
    fs.renameSync(temporaryPath, filePath)
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true })
    }
  }

  return { ok: true, hash: sha256Hex(encoded) }
}
