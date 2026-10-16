import { diffArrays } from 'diff'
import type { TextFileDiffArtifact } from '../../../../../../shared/types'
const lines = (text: string): string[] => (text ? text.split('\n') : [])
export const createTextFileDiffArtifact = (input: {
  before: string
  after: string
}): TextFileDiffArtifact => ({ version: 4, ...input })
export const countTextFileDiffLines = (
  artifact: TextFileDiffArtifact
): { insertCount: number; deleteCount: number } => {
  let insertCount = 0,
    deleteCount = 0
  for (const change of diffArrays(lines(artifact.before), lines(artifact.after))) {
    if (change.added) insertCount += change.value.length
    if (change.removed) deleteCount += change.value.length
  }
  return { insertCount, deleteCount }
}
