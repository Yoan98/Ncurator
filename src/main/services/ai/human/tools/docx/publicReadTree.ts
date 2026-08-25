import type {
  DocxDetailedNode,
  DocxPublicReadInlineNode,
  DocxPublicReadNestedNode,
  DocxPublicReadRootNode,
  DocxPublicReadRunChildNode,
  DocxPublicReadRunNode,
  DocxPublicReadTableRowNode,
  DocxPublicReadVisualContentNode,
  DocxReadContentNode,
  DocxReadInlineNode,
  DocxReadRunChildNode,
  DocxReadRunNode,
  DocxReadTableCellNode,
  DocxReadTableRowNode
} from './types'

const compact = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T

const projectVisualNode = (node: DocxReadContentNode): DocxPublicReadVisualContentNode => {
  if (node.type !== 'paragraph' && node.type !== 'table') {
    throw new Error(`visual children cannot contain ${node.type}`)
  }
  return projectNestedNode(node) as DocxPublicReadVisualContentNode
}

const projectRunChild = (node: DocxReadRunChildNode): DocxPublicReadRunChildNode => {
  if (node.type === 'text' || node.type === 'tab' || node.type === 'break') return node
  return compact({
    type: 'visual' as const,
    visualId: node.visualId,
    kind: node.kind,
    altText: node.altText,
    children: node.children?.map(projectVisualNode)
  })
}

const projectRun = (node: DocxReadRunNode): DocxPublicReadRunNode =>
  compact({
    type: 'run' as const,
    nodeId: node.nodeId,
    style: node.style,
    children: node.children.map(projectRunChild)
  })

const projectInline = (node: DocxReadInlineNode): DocxPublicReadInlineNode => {
  if (node.type === 'run') return projectRun(node)
  if (node.type === 'hyperlink') {
    return compact({
      type: 'hyperlink' as const,
      nodeId: node.nodeId,
      target: node.target,
      anchor: node.anchor,
      children: node.children.map(projectRun)
    })
  }
  if (node.type === 'field') {
    return {
      type: 'field',
      nodeId: node.nodeId,
      instruction: node.instruction,
      children: node.children.map((child) => projectInline(child as DocxReadInlineNode))
    }
  }
  if (node.type === 'bookmark' || node.type === 'math') return node
  if (node.type === 'opaque') {
    return {
      type: 'opaque',
      name: node.name,
      children: node.children.map((child) => projectInline(child as DocxReadInlineNode))
    }
  }
  return compact({
    type: node.type,
    nodeId: node.nodeId,
    ...(node.type === 'content_control'
      ? { tag: node.tag }
      : { revisionId: node.revisionId, kind: node.kind }),
    children: node.children.map((child) => projectInline(child as DocxReadInlineNode))
  }) as DocxPublicReadInlineNode
}

const projectCell = (node: DocxReadTableCellNode) =>
  compact({
    type: 'table_cell' as const,
    nodeId: node.nodeId,
    row: node.row,
    col: node.col,
    style: node.style,
    children: node.children.map(projectNestedNode)
  })

const projectRow = (node: DocxReadTableRowNode): DocxPublicReadTableRowNode =>
  compact({
    type: 'table_row' as const,
    nodeId: node.nodeId,
    row: node.row,
    style: node.style,
    children: node.children.map(projectCell)
  }) as DocxPublicReadTableRowNode

const projectNestedNode = (node: DocxReadContentNode): DocxPublicReadNestedNode => {
  if (node.type === 'paragraph') {
    return compact({
      type: 'paragraph' as const,
      nodeId: node.nodeId,
      style: node.style,
      children: node.children.map(projectInline)
    })
  }
  if (node.type === 'table') {
    return compact({
      type: 'table' as const,
      nodeId: node.nodeId,
      style: node.style,
      children: node.children.map(projectRow)
    })
  }
  if (node.type === 'opaque') {
    return {
      type: 'opaque',
      name: node.name,
      children: node.children.map((child) => projectNestedNode(child as DocxReadContentNode))
    }
  }
  return compact({
    type: node.type,
    nodeId: node.nodeId,
    ...(node.type === 'content_control'
      ? { tag: node.tag }
      : { revisionId: node.revisionId, kind: node.kind }),
    children: node.children.map((child) => projectNestedNode(child as DocxReadContentNode))
  }) as DocxPublicReadNestedNode
}

export const projectDocxReadNode = (node: DocxDetailedNode): DocxPublicReadRootNode => {
  if (node.type === 'paragraph') {
    return compact({
      type: 'paragraph' as const,
      nodeId: node.nodeId,
      story: node.story,
      style: node.style,
      children: node.children.map(projectInline)
    })
  }
  if (node.type === 'table') {
    return compact({
      type: 'table' as const,
      nodeId: node.nodeId,
      story: node.story,
      style: node.style,
      children: node.children.map(projectRow)
    })
  }
  if (node.type === 'content_control') {
    return compact({
      type: 'content_control' as const,
      nodeId: node.nodeId,
      story: node.story,
      tag: node.tag,
      children: node.children.map(projectNestedNode)
    })
  }
  if (node.type === 'revision') {
    return {
      type: 'revision',
      nodeId: node.nodeId,
      story: node.story,
      revisionId: node.revisionId || '',
      kind: node.revisionKind || 'insert',
      children: node.children.map(projectNestedNode)
    }
  }
  if (node.type !== 'table_cell') {
    throw new Error('unsupported DOCX root node')
  }
  return compact({
    type: 'table_cell' as const,
    nodeId: node.nodeId,
    story: node.story,
    tableNodeId: node.tableNodeId,
    row: node.row,
    col: node.col,
    style: node.style,
    children: node.children.map(projectNestedNode)
  })
}

export const projectDocxReadNodes = (
  nodes: readonly DocxDetailedNode[]
): DocxPublicReadRootNode[] => nodes.map(projectDocxReadNode)
