import type { DocumentRecord, SearchResult } from '../../../../src/shared/types'
import type { AiRunEvent } from '../../../../src/shared/types'

export const createTestDocumentRecord = (input: {
  id: string
  name: string
  sourceType?: 'file' | 'web'
}): DocumentRecord => ({
  id: input.id,
  name: input.name,
  source_type: input.sourceType || 'file',
  created_at: Date.now(),
  import_status: 3
})

export const createTestSearchResult = (input: {
  id: string
  text: string
  documentId: string
  documentName: string
  sourceType?: 'file' | 'web'
  score?: number
}): SearchResult => ({
  id: input.id,
  text: input.text,
  document_id: input.documentId,
  document_name: input.documentName,
  source_type: input.sourceType || 'file',
  _score: input.score ?? 1
})

export const filterEventsByType = <TType extends AiRunEvent['type']>(
  events: readonly AiRunEvent[],
  type: TType
): Extract<AiRunEvent, { type: TType }>[] =>
  events.filter(
    (event): event is Extract<AiRunEvent, { type: TType }> => event.type === type
  )

export const findToolResultEvent = (
  events: readonly AiRunEvent[],
  toolName: string
): Extract<AiRunEvent, { type: 'tool_call_result' }> | undefined =>
  filterEventsByType(events, 'tool_call_result').find((event) => event.toolName === toolName)
