import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const writeJsonAtomically = async (file: string, payload: object): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(payload), 'utf8')
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}
