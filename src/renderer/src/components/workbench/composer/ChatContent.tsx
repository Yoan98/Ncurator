import { useContext } from 'react'
import type { ChatMessageContentNode } from '../../../../../shared/types'
import ReferenceInlineToken from './ReferenceInlineToken'
import DocumentSelectionToken from './DocumentSelectionToken'
import { DocumentSelectionContext } from './DocumentSelectionContext'

export default function ChatContent({ nodes }: { nodes: ChatMessageContentNode[] }) {
  const selections = useContext(DocumentSelectionContext)
  return nodes.map((node, index) => {
    if (node.kind === 'text') return <span key={index}>{node.text}</span>
    if (node.kind === 'reference')
      return <ReferenceInlineToken key={index} reference={node.reference} />
    return (
      <span key={node.id}>
        <DocumentSelectionToken node={node} onClick={() => selections?.navigate(node)} />
        <ChatContent nodes={node.children} />
      </span>
    )
  })
}
