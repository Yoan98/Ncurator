import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

const hashFile = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256')
  await pipeline(fs.createReadStream(filePath), hash)
  return hash.digest('hex')
}

export class WorkspaceObjectStore {
  public constructor(private readonly objectsRootDir: string) {}

  public getObjectPath(hash: string): string {
    return path.join(this.objectsRootDir, 'sha256', hash.slice(0, 2), hash.slice(2))
  }

  public async putFile(filePath: string): Promise<{ hash: string; objectPath: string }> {
    const hash = await hashFile(filePath)
    const objectPath = this.getObjectPath(hash)
    try {
      await fsPromises.access(objectPath)
      return { hash, objectPath }
    } catch {
      // Continue with an atomic content-addressed write.
    }

    await fsPromises.mkdir(path.dirname(objectPath), { recursive: true })
    const tempPath = `${objectPath}.${randomUUID()}.tmp`
    try {
      await fsPromises.copyFile(filePath, tempPath)
      await fsPromises.rename(tempPath, objectPath).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
    } finally {
      await fsPromises.rm(tempPath, { force: true }).catch(() => undefined)
    }
    return { hash, objectPath }
  }

  public async putBuffer(content: Buffer): Promise<{ hash: string; objectPath: string }> {
    const hash = createHash('sha256').update(content).digest('hex')
    const objectPath = this.getObjectPath(hash)
    try {
      await fsPromises.access(objectPath)
      return { hash, objectPath }
    } catch {
      await fsPromises.mkdir(path.dirname(objectPath), { recursive: true })
      await fsPromises
        .writeFile(objectPath, content, { flag: 'wx' })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error
        })
      return { hash, objectPath }
    }
  }
}
