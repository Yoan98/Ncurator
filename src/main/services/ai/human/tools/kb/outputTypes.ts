import type { JsonObject } from '../../../../../../shared/types'

export type KbSearchResultItem = {
  id: string
  text: string
  documentName: string
  documentId?: string
  sourceType?: string
  filePath?: string
  sourceUrl?: string
  metadata?: string | JsonObject
  createdAt?: number
}

export type KbListDocumentItem = {
  id: string
  name: string
  sourceType: string
  workspaceId?: string
  filePath?: string
  createdAt: number
  importStatus: number
  sourceId?: string
  sourceUrl?: string
  sourceTitle?: string
  normalizedSourceUrl?: string
  fetchedAt?: number
  updatedAt?: number
  lastError?: string
}

export type KbSearchOutput = {
  items: KbSearchResultItem[]
  total: number
}

export type KbListDocumentsOutput = {
  items: KbListDocumentItem[]
  total: number
}
