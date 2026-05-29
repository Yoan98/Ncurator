import path from 'node:path'
import { sanitizeFileNameForPath } from '../../../../utils/fileNamePolicy'

export type DocxApplyArtifactPaths = {
  workDir: string
  committedArtifactPath: string
  beforeSnapshotPath: string
}

export const buildDocxApplyArtifactPaths = (input: {
  workspaceRootPath: string
  applyId: string
  sourceName: string
}): DocxApplyArtifactPaths => {
  const workDir = path.join(
    path.resolve(input.workspaceRootPath),
    '.ncurator',
    'docx-applies',
    input.applyId
  )
  const baseName = sanitizeFileNameForPath({
    value: input.sourceName,
    fallback: 'document.docx'
  })
  return {
    workDir,
    committedArtifactPath: path.join(workDir, `committed-${baseName}`),
    beforeSnapshotPath: path.join(workDir, `before-${baseName}`)
  }
}
