import type { DocxEditSession } from '../types'

export const createEditSession = (input: {
  sourcePath: string
  targetMode?: DocxEditSession['targetMode']
  sourceDocId: string
  stats: DocxEditSession['stats']
  diskFingerprint: DocxEditSession['diskFingerprint']
}): DocxEditSession => ({
  sourcePath: input.sourcePath,
  targetMode: input.targetMode || 'update',
  sourceDocId: input.sourceDocId,
  activeDocId: input.sourceDocId,
  activeRevisionRef: 'v1',
  nextRevisionNumber: 2,
  stats: input.stats,
  diskFingerprint: input.diskFingerprint,
  docIdByRevisionRef: new Map([['v1', input.sourceDocId]]),
  revisionRefByDocId: new Map([[input.sourceDocId, 'v1']])
})
