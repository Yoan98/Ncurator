export type DocxVisualKind = 'image' | 'chart' | 'diagram' | 'shape' | 'embedded_object'

export type DocxLength = {
  value: number
  unit: 'pt' | 'percent'
}

export type DocxBorder = {
  style: 'none' | 'single' | 'dashed' | 'dotted' | 'double'
  color?: string
  size?: number
}

export type DocxBorders = Partial<
  Record<'top' | 'right' | 'bottom' | 'left' | 'insideHorizontal' | 'insideVertical', DocxBorder>
>

export type DocxRunStyle = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  highlight?: string
  fontFamily?: string
  fontSize?: number
}

export type DocxParagraphStyle = {
  styleName?: string
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indent?: {
    left?: number
    right?: number
    firstLine?: number
    hanging?: number
  }
  spacing?: {
    before?: number
    after?: number
    line?: number
  }
  keepWithNext?: boolean
  pageBreakBefore?: boolean
}

export type DocxTableStyle = {
  alignment?: 'left' | 'center' | 'right'
  width?: DocxLength
  layout?: 'fixed' | 'autofit'
  borders?: DocxBorders
}

export type DocxTableRowStyle = {
  height?: number
  repeatHeader?: boolean
  cantSplit?: boolean
}

export type DocxTableCellStyle = {
  width?: DocxLength
  verticalAlignment?: 'top' | 'center' | 'bottom'
  shading?: string
  margins?: {
    top?: number
    right?: number
    bottom?: number
    left?: number
  }
  borders?: DocxBorders
}

export type DocxCreateTextNode = { type: 'text'; text: string }
export type DocxCreateTabNode = { type: 'tab' }
export type DocxCreateBreakNode = { type: 'break'; kind?: 'line' | 'page' | 'column' }

export type DocxCreateRunNode = {
  type: 'run'
  style?: DocxRunStyle
  children: Array<DocxCreateTextNode | DocxCreateTabNode | DocxCreateBreakNode>
}

export type DocxCreateHyperlinkNode = {
  type: 'hyperlink'
  target?: string
  anchor?: string
  children: DocxCreateRunNode[]
}

export type DocxCreateParagraphNode = {
  type: 'paragraph'
  style?: DocxParagraphStyle
  children: Array<DocxCreateRunNode | DocxCreateHyperlinkNode>
}

export type DocxCreateTableCellNode = {
  type: 'table_cell'
  style?: DocxTableCellStyle
  children: DocxCreateBlockNode[]
}

export type DocxCreateTableRowNode = {
  type: 'table_row'
  style?: DocxTableRowStyle
  children: DocxCreateTableCellNode[]
}

export type DocxCreateTableNode = {
  type: 'table'
  style?: DocxTableStyle
  children: DocxCreateTableRowNode[]
}

export type DocxCreateBlockNode = DocxCreateParagraphNode | DocxCreateTableNode
export type DocxCreateNode =
  | DocxCreateBlockNode
  | DocxCreateTableRowNode
  | DocxCreateTableCellNode
  | DocxCreateRunNode
  | DocxCreateHyperlinkNode
  | DocxCreateTextNode
  | DocxCreateTabNode
  | DocxCreateBreakNode

export type DocxReadTextNode = { type: 'text'; text: string }
export type DocxReadTabNode = { type: 'tab' }
export type DocxReadBreakNode = { type: 'break'; kind: 'line' | 'page' | 'column' }

export type DocxReadRunNode = {
  type: 'run'
  nodeId: string
  style?: DocxRunStyle
  children: DocxReadRunChildNode[]
}

export type DocxReadHyperlinkNode = {
  type: 'hyperlink'
  target?: string
  anchor?: string
  children: DocxReadRunNode[]
}

export type DocxReadContentControlNode = {
  type: 'content_control'
  tag?: string
  children: DocxReadNode[]
}

export type DocxReadRevisionNode = {
  type: 'revision'
  kind: 'insert' | 'delete' | 'move_from' | 'move_to'
  children: DocxReadNode[]
}

export type DocxReadFieldNode = {
  type: 'field'
  instruction: string
  children: DocxReadNode[]
}

export type DocxReadVisualNode = {
  type: 'visual'
  visualId: string
  kind: DocxVisualKind
  altText?: string
  children?: DocxReadBlockNode[]
}

export type DocxReadRunChildNode =
  | DocxReadTextNode
  | DocxReadTabNode
  | DocxReadBreakNode
  | DocxReadVisualNode

export type DocxReadParagraphNode = {
  type: 'paragraph'
  nodeId: string
  style?: DocxParagraphStyle
  text: string
  children: DocxReadInlineNode[]
}

export type DocxReadTableCellNode = {
  type: 'table_cell'
  blockId?: string
  nodeId?: string
  row: number
  col: number
  style?: DocxTableCellStyle
  text: string
  children: DocxReadBlockNode[]
}

export type DocxReadTableRowNode = {
  type: 'table_row'
  nodeId: string
  row: number
  style?: DocxTableRowStyle
  children: DocxReadTableCellNode[]
}

export type DocxReadTableNode = {
  type: 'table'
  nodeId: string
  style?: DocxTableStyle
  rows: number
  cols: number
  text: string
  children: DocxReadTableRowNode[]
}

export type DocxReadInlineNode =
  | DocxReadRunNode
  | DocxReadHyperlinkNode
  | DocxReadContentControlNode
  | DocxReadRevisionNode
  | DocxReadFieldNode

export type DocxReadBlockNode =
  | DocxReadParagraphNode
  | DocxReadTableNode
  | DocxReadContentControlNode
  | DocxReadRevisionNode

export type DocxReadNode =
  | DocxReadBlockNode
  | DocxReadTableRowNode
  | DocxReadTableCellNode
  | DocxReadInlineNode
  | DocxReadRunChildNode

// Public read nodes deliberately exclude internal summaries and layout facts. The
// unions are split by parent so an output schema cannot admit impossible trees.
export type DocxPublicReadTextNode = { type: 'text'; text: string }
export type DocxPublicReadTabNode = { type: 'tab' }
export type DocxPublicReadBreakNode = {
  type: 'break'
  kind: 'line' | 'page' | 'column'
}
export type DocxPublicReadVisualNode = {
  type: 'visual'
  visualId: string
  kind: DocxVisualKind
  altText?: string
  children?: DocxPublicReadVisualBlockNode[]
}
export type DocxPublicReadRunChildNode =
  | DocxPublicReadTextNode
  | DocxPublicReadTabNode
  | DocxPublicReadBreakNode
  | DocxPublicReadVisualNode
export type DocxPublicReadRunNode = {
  type: 'run'
  nodeId: string
  style?: DocxRunStyle
  children: DocxPublicReadRunChildNode[]
}
export type DocxPublicReadHyperlinkNode = {
  type: 'hyperlink'
  target?: string
  anchor?: string
  children: DocxPublicReadRunNode[]
}
export type DocxPublicReadInlineContentControlNode = {
  type: 'content_control'
  tag?: string
  children: DocxPublicReadInlineNode[]
}
export type DocxPublicReadInlineRevisionNode = {
  type: 'revision'
  kind: 'insert' | 'delete' | 'move_from' | 'move_to'
  children: DocxPublicReadInlineNode[]
}
export type DocxPublicReadFieldNode = {
  type: 'field'
  instruction: string
  children: DocxPublicReadInlineNode[]
}
export type DocxPublicReadInlineNode =
  | DocxPublicReadRunNode
  | DocxPublicReadHyperlinkNode
  | DocxPublicReadInlineContentControlNode
  | DocxPublicReadInlineRevisionNode
  | DocxPublicReadFieldNode
export type DocxPublicReadNestedParagraphNode = {
  type: 'paragraph'
  nodeId: string
  style?: DocxParagraphStyle
  children: DocxPublicReadInlineNode[]
}
export type DocxPublicReadNestedTableCellNode = {
  type: 'table_cell'
  nodeId: string
  row: number
  col: number
  style?: DocxTableCellStyle
  children: DocxPublicReadNestedBlockNode[]
}
export type DocxPublicReadTableCellBlockNode = {
  type: 'table_cell'
  blockId: string
  row: number
  col: number
  style?: DocxTableCellStyle
  children: DocxPublicReadNestedBlockNode[]
}
export type DocxPublicReadTableRowNode = {
  type: 'table_row'
  nodeId: string
  row: number
  style?: DocxTableRowStyle
  children: Array<DocxPublicReadNestedTableCellNode | DocxPublicReadTableCellBlockNode>
}
export type DocxPublicReadNestedTableNode = {
  type: 'table'
  nodeId: string
  style?: DocxTableStyle
  children: DocxPublicReadTableRowNode[]
}
export type DocxPublicReadBlockContentControlNode = {
  type: 'content_control'
  tag?: string
  children: DocxPublicReadNestedBlockNode[]
}
export type DocxPublicReadBlockRevisionNode = {
  type: 'revision'
  kind: 'insert' | 'delete' | 'move_from' | 'move_to'
  children: DocxPublicReadNestedBlockNode[]
}
export type DocxPublicReadNestedBlockNode =
  | DocxPublicReadNestedParagraphNode
  | DocxPublicReadNestedTableNode
  | DocxPublicReadBlockContentControlNode
  | DocxPublicReadBlockRevisionNode
export type DocxPublicReadVisualBlockNode =
  | DocxPublicReadNestedParagraphNode
  | DocxPublicReadNestedTableNode
export type DocxPublicReadRootParagraphNode = Omit<DocxPublicReadNestedParagraphNode, 'nodeId'> & {
  blockId: string
  blockIndex: number
}
export type DocxPublicReadRootTableNode = Omit<DocxPublicReadNestedTableNode, 'nodeId'> & {
  blockId: string
  blockIndex: number
}
export type DocxPublicReadRootCellNode = Omit<DocxPublicReadTableCellBlockNode, 'row' | 'col'> & {
  blockIndex: number
  tableBlockId: string
  row: number
  col: number
}
export type DocxPublicReadRootWrapperNode =
  | {
      type: 'content_control'
      tag?: string
      children: DocxPublicReadRootNode[]
    }
  | {
      type: 'revision'
      kind: 'insert' | 'move_to'
      children: DocxPublicReadRootNode[]
    }
export type DocxPublicReadRootNode =
  | DocxPublicReadRootParagraphNode
  | DocxPublicReadRootTableNode
  | DocxPublicReadRootCellNode
  | DocxPublicReadRootWrapperNode

export type DocxStylePatch =
  | ({ kind: 'run' } & { [K in keyof DocxRunStyle]?: DocxRunStyle[K] | null })
  | ({ kind: 'paragraph' } & {
      [K in keyof DocxParagraphStyle]?: DocxParagraphStyle[K] | null
    })
  | ({ kind: 'table' } & { [K in keyof DocxTableStyle]?: DocxTableStyle[K] | null })
  | ({ kind: 'table_row' } & {
      [K in keyof DocxTableRowStyle]?: DocxTableRowStyle[K] | null
    })
  | ({ kind: 'table_cell' } & {
      [K in keyof DocxTableCellStyle]?: DocxTableCellStyle[K] | null
    })
