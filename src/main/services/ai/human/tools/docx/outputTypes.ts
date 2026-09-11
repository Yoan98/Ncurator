import type { JsonValue } from '../../../../../../shared/types'

export type DocxOutlineStory =
  | 'body'
  | 'header'
  | 'footer'
  | 'footnote'
  | 'endnote'
  | 'textbox'

export type DocxOutlineSegmentOutput = {
  story: DocxOutlineStory
  fromNodeIndex: number
  toNodeIndex: number
  textMap: string
}

export type DocxOutlineOutput = {
  fromPercent: number
  toPercent: number
  fromNodeIndex: number
  toNodeIndex: number
  totalRootCount: number
  segments: DocxOutlineSegmentOutput[]
}

export type DocxSearchNodeType =
  | 'paragraph'
  | 'table'
  | 'table_cell'
  | 'content_control'
  | 'revision'

export type DocxSearchMatchOutput = {
  nodeId: string
  nodeIndex: number
  type: DocxSearchNodeType
  story: DocxOutlineStory
  matchText: string
  textContext: string
  tableNodeId?: string
  node: JsonValue
  beforeNodes?: JsonValue[]
  afterNodes?: JsonValue[]
}

export type DocxSearchOutput = {
  totalMatchCount: number
  returnedMatchCount: number
  matches: DocxSearchMatchOutput[]
}

export type DocxReadOutput = {
  nodes: JsonValue[]
}

export type DocxMutationOutput = {
  createdIds?: string[]
}
