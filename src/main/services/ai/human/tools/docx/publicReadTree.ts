import type {
  DocxDetailedBlock,
  DocxPublicReadInlineNode,
  DocxPublicReadNestedBlockNode,
  DocxPublicReadRootNode,
  DocxPublicReadRunChildNode,
  DocxPublicReadRunNode,
  DocxPublicReadTableRowNode,
  DocxPublicReadVisualBlockNode,
  DocxReadBlockNode,
  DocxReadInlineNode,
  DocxReadRunChildNode,
  DocxReadRunNode,
  DocxReadTableCellNode,
  DocxReadTableRowNode
} from './types'

const compact = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T

const projectVisualBlock = (node: DocxReadBlockNode): DocxPublicReadVisualBlockNode => {
  if (node.type !== 'paragraph' && node.type !== 'table') {
    throw new Error(`visual children cannot contain ${node.type}`)
  }
  return projectNestedBlock(node) as DocxPublicReadVisualBlockNode
}

const projectRunChild = (node: DocxReadRunChildNode): DocxPublicReadRunChildNode => {
  if (node.type === 'text' || node.type === 'tab' || node.type === 'break') return node
  return compact({
    type: 'visual' as const,
    visualId: node.visualId,
    kind: node.kind,
    altText: node.altText,
    children: node.children?.map(projectVisualBlock)
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
      target: node.target,
      anchor: node.anchor,
      children: node.children.map(projectRun)
    })
  }
  if (node.type === 'field') {
    return {
      type: 'field',
      instruction: node.instruction,
      children: node.children.map((child) => projectInline(child as DocxReadInlineNode))
    }
  }
  return compact({
    type: node.type,
    ...(node.type === 'content_control' ? { tag: node.tag } : { kind: node.kind }),
    children: node.children.map((child) => projectInline(child as DocxReadInlineNode))
  }) as DocxPublicReadInlineNode
}

const projectCell = (node: DocxReadTableCellNode) =>
  compact({
    type: 'table_cell' as const,
    ...(node.blockId ? { blockId: node.blockId } : { nodeId: node.nodeId! }),
    row: node.row,
    col: node.col,
    style: node.style,
    children: node.children.map(projectNestedBlock)
  })

const projectRow = (node: DocxReadTableRowNode): DocxPublicReadTableRowNode =>
  compact({
    type: 'table_row' as const,
    nodeId: node.nodeId,
    row: node.row,
    style: node.style,
    children: node.children.map(projectCell)
  }) as DocxPublicReadTableRowNode

const projectNestedBlock = (node: DocxReadBlockNode): DocxPublicReadNestedBlockNode => {
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
  return compact({
    type: node.type,
    ...(node.type === 'content_control' ? { tag: node.tag } : { kind: node.kind }),
    children: node.children.map((child) => projectNestedBlock(child as DocxReadBlockNode))
  }) as DocxPublicReadNestedBlockNode
}

export const projectDocxReadBlock = (block: DocxDetailedBlock): DocxPublicReadRootNode => {
  if (block.type === 'paragraph') {
    return compact({
      type: 'paragraph' as const,
      blockId: block.blockId,
      blockIndex: block.blockIndex,
      style: block.style,
      children: block.children.map(projectInline)
    })
  }
  if (block.type === 'table') {
    return compact({
      type: 'table' as const,
      blockId: block.blockId,
      blockIndex: block.blockIndex,
      style: block.style,
      children: block.children.map(projectRow)
    })
  }
  return compact({
    type: 'table_cell' as const,
    blockId: block.blockId,
    blockIndex: block.blockIndex,
    tableBlockId: block.tableBlockId,
    row: block.row,
    col: block.col,
    style: block.style,
    children: block.children.map(projectNestedBlock)
  })
}

type ProjectableBlock = {
  block: DocxDetailedBlock
  wrapperPath: NonNullable<DocxDetailedBlock['wrapperPath']>
}

const projectAtWrapperDepth = (
  items: readonly ProjectableBlock[],
  depth: number
): DocxPublicReadRootNode[] => {
  const output: DocxPublicReadRootNode[] = []
  let index = 0
  while (index < items.length) {
    const item = items[index]!
    const wrapper = item.wrapperPath[depth]
    if (!wrapper) {
      output.push(projectDocxReadBlock(item.block))
      index += 1
      continue
    }
    let end = index + 1
    while (end < items.length && items[end]!.wrapperPath[depth]?.key === wrapper.key) end += 1
    const children = projectAtWrapperDepth(items.slice(index, end), depth + 1)
    output.push(
      wrapper.type === 'content_control'
        ? compact({ type: 'content_control' as const, tag: wrapper.tag, children })
        : { type: 'revision', kind: wrapper.kind, children }
    )
    index = end
  }
  return output
}

export const projectDocxReadBlocks = (
  blocks: readonly DocxDetailedBlock[]
): DocxPublicReadRootNode[] =>
  projectAtWrapperDepth(
    blocks.map((block) => ({ block, wrapperPath: block.wrapperPath || [] })),
    0
  )
