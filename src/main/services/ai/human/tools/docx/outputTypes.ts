import type { DocxPublicReadRootNode } from './nodeTypes'
import type { SectionNode, SectionSlot } from './adapters/ooxml/sections'
import type { JsonValue } from '../../../../../../shared/types'

export type DocxOutlineStory = 'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'textbox'

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
  sections: Array<{ type: 'section'; nodeId: string; segments: DocxOutlineSegmentOutput[] }>
  segments: DocxOutlineSegmentOutput[]
}

export type DocxSearchNodeType = 'paragraph' | 'table' | 'table_cell' | 'content_control'

export type DocxSearchMatchOutput = {
  nodeId: string
  nodeIndex: number
  type: DocxSearchNodeType
  story: DocxOutlineStory
  sectionNodeIds?: string[]
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

export type HeaderFooterNode = SectionSlot & {
  type: 'header' | 'footer'
  sectionNodeId: string
  children: DocxPublicReadRootNode[]
}

export type DocxReadOutput = {
  nodes: Array<
    | SectionNode
    | HeaderFooterNode
    | (DocxPublicReadRootNode & { commentIds?: string[]; revisionIds?: string[] })
  >
}

export type DocxMutationOutput = {
  createdIds?: string[]
}
