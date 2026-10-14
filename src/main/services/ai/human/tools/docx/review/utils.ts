import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'

export const calculateFileStats = async (
  filePath: string
): Promise<{ checksum: string; byteSize: number; modifiedAt: number }> => {
  const [stat, buffer] = await Promise.all([fs.stat(filePath), fs.readFile(filePath)])
  return {
    checksum: createHash('sha256').update(buffer).digest('hex'),
    byteSize: buffer.byteLength,
    modifiedAt: Math.trunc(stat.mtimeMs)
  }
}

export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
