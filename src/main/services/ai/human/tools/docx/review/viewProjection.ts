import path from 'node:path'
import { sanitizeFileNameForPath } from '../../../../utils/fileNamePolicy'

export type DocxApplyArtifactPaths = {
  workDir: string
  workingArtifactPath: string
  diffArtifactPath: string
  beforeSnapshotPath: string
}

export const buildDocxApplyArtifactPaths = (input: {
  workspaceRootPath: string
  runId: string
  applyId: string
  sourceName: string
}): DocxApplyArtifactPaths => {
  const workDir = path.join(
    path.resolve(input.workspaceRootPath),
    '.ncurator',
    'file-changes',
    input.runId
  )
  const baseName = sanitizeFileNameForPath({
    value: input.sourceName,
    fallback: 'document.docx'
  })
  return {
    workDir,
    workingArtifactPath: path.join(workDir, `${input.applyId}-working-${baseName}`),
    diffArtifactPath: path.join(workDir, `${input.applyId}-diff-${baseName}`),
    beforeSnapshotPath: path.join(workDir, `${input.applyId}-before-${baseName}`)
  }
}
