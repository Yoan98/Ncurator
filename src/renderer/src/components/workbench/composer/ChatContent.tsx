import { useContext } from 'react'
import type { ChatMessageContentNode } from '../../../../../shared/types'
import { selectionLabel } from '../../../../../shared/chatContent'
import ReferenceInlineToken from './ReferenceInlineToken'
import { DocumentSelectionContext } from './DocumentSelectionContext'

export default function ChatContent({ nodes }: { nodes: ChatMessageContentNode[] }) {
  const selections = useContext(DocumentSelectionContext)
  return nodes.map((node, index) => {
    if (node.kind === 'text') return <span key={index}>{node.text}</span>
    if (node.kind === 'reference')
      return <ReferenceInlineToken key={index} reference={node.reference} className="mx-[1px]" />
    return (
      <span key={node.id}>
        <button
          type="button"
          title={node.selectedText}
          className="mx-[1px] rounded bg-[#E8F0FE] px-1 text-[#2457A7] hover:bg-[#D8E7FD]"
          onClick={() => selections?.navigate(node)}
        >
          [{selectionLabel(node)}]
        </button>{' '}
        <ChatContent nodes={node.children} />
      </span>
    )
  })
}
