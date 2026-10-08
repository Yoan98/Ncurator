import type {
  ChatAttachment,
  ChatMessageContentNode,
  DocumentSelectionNode,
  SelectedReference
} from '../../../../../shared/types'

export type ComposerTextNode = {
  id: string
  kind: 'text'
  text: string
}

export type ComposerScopeNode = {
  id: string
  kind: 'scope'
  scope: SelectedReference
}

export type ComposerNode =
  | ComposerTextNode
  | ComposerScopeNode
  | { id: string; kind: 'selection'; selection: DocumentSelectionNode }

export type ComposerDraftValue = {
  input: string
  contentNodes: ChatMessageContentNode[]
  selectedReferences: SelectedReference[]
  attachments: ChatAttachment[]
  assetBucketId?: string | null
}
