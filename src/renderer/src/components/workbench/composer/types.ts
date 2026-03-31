import type { SelectedReference } from '../../../../../shared/types'

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

export type ComposerNode = ComposerTextNode | ComposerScopeNode

export type ComposerDraftValue = {
  input: string
  selectedReferences: SelectedReference[]
}
