import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { withOfficeFileWrite, notifyOfficeFileWritten } from '../wps/officeFileWriteNotify'
import type { WriteDocxFileRequest, WriteTextFileResponse } from '../../../shared/types'

const checksum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export async function writeDocxFile(input: WriteDocxFileRequest): Promise<WriteTextFileResponse> {
  const filePath = path.resolve(input.filePath)
  if (
    path.extname(filePath).toLowerCase() !== '.docx' ||
    !/^[a-f0-9]{64}$/.test(input.expectedHash) ||
    !(input.bytes instanceof Uint8Array)
  )
    return { success: false, error: 'Invalid DOCX save request' }
  const conflict = { success: false, conflict: true, error: '文件已被修改，当前编辑仍保留。' }
  const matchesExpected = async () => {
    try {
      return checksum(await fs.readFile(filePath)) === input.expectedHash
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  if (!(await matchesExpected())) return conflict
  return withOfficeFileWrite(filePath, async () => {
    const temp = path.join(path.dirname(filePath), '.ncurator-docx-' + randomUUID() + '.tmp')
    try {
      const stat = await fs.stat(filePath)
      await fs.access(filePath, fs.constants.W_OK)
      await fs.writeFile(temp, input.bytes, { flag: 'wx', mode: stat.mode })
      if (!(await matchesExpected())) {
        notifyOfficeFileWritten(filePath)
        return conflict
      }
      await fs.rename(temp, filePath)
      notifyOfficeFileWritten(filePath)
      return { success: true, hash: checksum(input.bytes) }
    } finally {
      await fs.rm(temp, { force: true })
    }
  })
}
