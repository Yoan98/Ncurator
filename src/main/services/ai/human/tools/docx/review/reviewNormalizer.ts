import type { DocxReplayNode } from '../types'

const shouldHideGeneratedReviewNode = (node: DocxReplayNode): boolean =>
  node.sourceOrigin === 'generated' &&
  (node.reviewState === 'deleted' || node.reviewState === 'replaced-old')

export const normalizeReviewNodes = (nodes: DocxReplayNode[]): DocxReplayNode[] =>
  nodes.filter((node) => !shouldHideGeneratedReviewNode(node))
