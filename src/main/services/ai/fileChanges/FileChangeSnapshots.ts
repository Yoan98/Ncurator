import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getPartnerRuntimeDir } from '../../assets/WorkspaceAssetService'
import type { AiFileChangeRecordStore } from './AiFileChangeService'
import type { FileChangeSession } from './FileChangeSession'

export const getFileChangeDirectory = (
  partnerId: string,
  runId: string,
  changeId: string
): string => {
  for (const id of [runId, changeId]) {
    if (!id || id === '.' || id === '..' || /[\\/]/.test(id))
      throw new Error('文件修改记录 ID 无效')
  }
  return path.join(getPartnerRuntimeDir(partnerId), 'file-changes', runId, changeId)
}

export const saveFileChangeSnapshot = async (
  directory: string,
  name: string,
  content: Buffer
): Promise<{ objectPath: string; hash: string }> => {
  await fs.mkdir(directory, { recursive: true })
  const objectPath = path.join(directory, name)
  const hash = createHash('sha256').update(content).digest('hex')
  try {
    await fs.writeFile(objectPath, content, { flag: 'wx' })
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    if (!(await fs.readFile(objectPath)).equals(content)) throw new Error('文件备份校验不一致')
  }
  return { objectPath, hash }
}

/** Copy existing checkpoints without rebuilding historical reviews or changing their dates. */
export const consolidatePartnerSnapshots = async (
  partnerId: string,
  store: AiFileChangeRecordStore,
  minimumCreatedAt = -Infinity
): Promise<void> => {
  for (const record of (await store.listRecords({ partnerId })).items) {
    if (record.createdAt < minimumCreatedAt) continue
    const directory = getFileChangeDirectory(partnerId, record.runId, record.id)
    const extension = path.extname(record.fileName) || '.bin'
    const updated = { ...record }
    let changed = false
    for (const side of ['before', 'after'] as const) {
      const key = side === 'before' ? 'beforeSnapshotPath' : 'afterSnapshotPath'
      const source = record[key]
      const destination = path.join(directory, `${side}${extension}`)
      if (
        !source ||
        source === destination ||
        (side === 'after' && path.dirname(source) === directory)
      )
        continue
      const content = await fs.readFile(source).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (!content) continue
      const checksum = side === 'before' ? record.beforeChecksum : record.afterChecksum
      if (checksum && createHash('sha256').update(content).digest('hex') !== checksum)
        throw new Error('历史文件备份校验不一致')
      await saveFileChangeSnapshot(directory, `${side}${extension}`, content)
      updated[key] = destination
      changed = true
    }
    if (changed) await store.saveRecord(updated)
    const pendingPath = path.join(directory, 'pending.json')
    const pending = await fs.readFile(pendingPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (pending) {
      const session = JSON.parse(pending) as FileChangeSession
      if (session.record.id !== record.id || session.version !== 1)
        throw new Error('无效的文件审核会话')
      if (
        session.record.beforeSnapshotPath !== updated.beforeSnapshotPath ||
        session.record.afterSnapshotPath !== updated.afterSnapshotPath
      )
        await fs.writeFile(
          pendingPath,
          JSON.stringify({
            ...session,
            record: {
              ...session.record,
              beforeSnapshotPath: updated.beforeSnapshotPath,
              afterSnapshotPath: updated.afterSnapshotPath
            }
          })
        )
    }
  }
}
