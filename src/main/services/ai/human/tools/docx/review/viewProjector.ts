import type { DocxReplayNode, DocxReplaySession } from '../types'
import { projectReplayNodes } from './replayTree'
import { normalizeReviewNodes } from './reviewNormalizer'

export const projectWorkingView = (session: DocxReplaySession): DocxReplayNode[] =>
  projectReplayNodes(session, 'working')

export const projectReviewView = (session: DocxReplaySession): DocxReplayNode[] =>
  normalizeReviewNodes(projectReplayNodes(session, 'review'))

export const projectCommittedView = (session: DocxReplaySession): DocxReplayNode[] =>
  projectReplayNodes(session, 'committed')
