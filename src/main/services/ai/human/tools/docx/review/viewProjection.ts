import path from 'node:path'
import { getPartnerRuntimeDir } from '../../../../../assets/WorkspaceAssetService'
import { sanitizeFileNameForPath } from '../../../../utils/fileNamePolicy'

export type DocxApplyArtifactPaths = {
  workDir: string
  workingArtifactPath: string
  diffArtifactPath: string
  beforeSnapshotPath: string
}

export const buildDocxApplyArtifactPaths = (input: {
  partnerId: string
  runId: string
  applyId: string
  sourceName: string
}): DocxApplyArtifactPaths => {
  const workDir = path.join(getPartnerRuntimeDir(input.partnerId), 'file-changes', input.runId)
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
