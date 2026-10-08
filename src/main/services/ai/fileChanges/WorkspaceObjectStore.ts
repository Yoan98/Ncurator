import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export class WorkspaceObjectStore {
  public constructor(private readonly objectsRootDir: string) {}
  public getObjectPath(hash: string): string {
    return path.join(this.objectsRootDir, 'sha256', hash.slice(0, 2), hash.slice(2))
  }
  public async putFile(filePath: string): Promise<{ hash: string; objectPath: string }> {
    return await this.putBuffer(await fs.readFile(filePath))
  }
  public async putBuffer(content: Buffer): Promise<{ hash: string; objectPath: string }> {
    const hash = createHash('sha256').update(content).digest('hex')
    const objectPath = this.getObjectPath(hash)
    await fs.mkdir(path.dirname(objectPath), { recursive: true })
    const existing = await fs.readFile(objectPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (existing) {
      if (!existing.equals(content)) throw new Error('content-addressed object checksum mismatch')
      return { hash, objectPath }
    }
    const tempPath = `${objectPath}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(tempPath, content, { flag: 'wx' })
      await fs.rename(tempPath, objectPath)
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }
    return { hash, objectPath }
  }
}
