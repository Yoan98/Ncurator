import type { DocxReplayNode, DocxReplaySession } from '../types'
import { projectReplayNodes } from './replayTree'

export const projectWorkingView = (session: DocxReplaySession): DocxReplayNode[] =>
  projectReplayNodes(session, 'working')

export const projectReviewView = (session: DocxReplaySession): DocxReplayNode[] =>
  projectReplayNodes(session, 'review')

export const projectCommittedView = (session: DocxReplaySession): DocxReplayNode[] =>
  projectReplayNodes(session, 'committed')
