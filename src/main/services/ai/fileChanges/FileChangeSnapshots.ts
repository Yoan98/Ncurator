import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getPartnerRuntimeDir } from '../../assets/WorkspaceAssetService'

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
): Promise<{ snapshotPath: string; hash: string }> => {
  await fs.mkdir(directory, { recursive: true })
  const snapshotPath = path.join(directory, name)
  const hash = createHash('sha256').update(content).digest('hex')
  try {
    await fs.writeFile(snapshotPath, content, { flag: 'wx' })
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    if (!(await fs.readFile(snapshotPath)).equals(content)) throw new Error('文件备份校验不一致')
  }
  return { snapshotPath, hash }
}
