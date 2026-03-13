import type { JsonObject, JsonValue } from '../../../../../shared/types'
import { isJsonObject } from '../../../../utils/aiCapabilityUtils'
import type { HumanObservation } from './types'

type RetrievalDocumentRef = {
  documentName?: string
  documentId?: string
}

const GENERIC_DOCUMENT_NAME_VALUES = new Set([
  'knowledge-base',
  'knowledge base',
  'local-kb',
  'local kb',
  'local-knowledge-base',
  'local knowledge base'
])

const toTrimmedString = (value: JsonValue | undefined): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized : undefined
}

const normalizeComparableText = (value: string): string => {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

const isGenericDocumentName = (value: string | undefined): boolean => {
  if (!value) return false
  return GENERIC_DOCUMENT_NAME_VALUES.has(normalizeComparableText(value))
}

const extractDocumentRefFromRecord = (value: JsonObject): RetrievalDocumentRef | null => {
  const searchDocumentName = toTrimmedString(value.document_name)
  const searchDocumentId = toTrimmedString(value.document_id)
  if (searchDocumentName || searchDocumentId) {
    return {
      documentName: searchDocumentName,
      documentId: searchDocumentId
    }
  }

  const listedDocumentName = toTrimmedString(value.name)
  const listedDocumentId = listedDocumentName ? toTrimmedString(value.id) : undefined
  if (listedDocumentName || listedDocumentId) {
    return {
      documentName: listedDocumentName,
      documentId: listedDocumentId
    }
  }

  return null
}

const extractDocumentRefsFromValue = (value: JsonValue | undefined): RetrievalDocumentRef[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractDocumentRefsFromValue(item))
  }

  if (!isJsonObject(value)) return []

  const refs: RetrievalDocumentRef[] = []
  const directRef = extractDocumentRefFromRecord(value)
  if (directRef) refs.push(directRef)

  const nestedItems = value.items
  if (Array.isArray(nestedItems)) {
    refs.push(...extractDocumentRefsFromValue(nestedItems))
  }

  return refs
}

const dedupeDocumentRefs = (refs: RetrievalDocumentRef[]): RetrievalDocumentRef[] => {
  const seen = new Set<string>()
  const unique: RetrievalDocumentRef[] = []

  for (const ref of refs) {
    const key = `${ref.documentId || ''}::${ref.documentName || ''}`
    if (!ref.documentId && !ref.documentName) continue
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(ref)
  }

  return unique
}

const resolveUniqueDocumentRef = (value: JsonValue | undefined): RetrievalDocumentRef | undefined => {
  const refs = dedupeDocumentRefs(extractDocumentRefsFromValue(value))
  if (refs.length !== 1) return undefined
  return refs[0]
}

const matchesDocumentRef = (value: string | undefined, ref: RetrievalDocumentRef): boolean => {
  if (!value) return false
  const normalized = normalizeComparableText(value)
  return [ref.documentName, ref.documentId]
    .filter((item): item is string => Boolean(item))
    .some((item) => normalizeComparableText(item) === normalized)
}

export const enrichCompleteTaskResultData = (input: {
  resultData?: JsonObject
  lastObservation?: HumanObservation
}): JsonObject | undefined => {
  if (!input.resultData) return undefined
  if (!input.lastObservation || input.lastObservation.kind !== 'tool_result') {
    return input.resultData
  }

  const uniqueRef = resolveUniqueDocumentRef(input.lastObservation.data)
  if (!uniqueRef) return input.resultData

  const nextResultData: JsonObject = { ...input.resultData }
  const currentDocumentName = toTrimmedString(nextResultData.document_name)
  const currentDocumentId = toTrimmedString(nextResultData.document_id)

  if (
    (!currentDocumentName || isGenericDocumentName(currentDocumentName)) &&
    (uniqueRef.documentName || uniqueRef.documentId)
  ) {
    nextResultData.document_name = uniqueRef.documentName || uniqueRef.documentId || nextResultData.document_name
  }

  if (
    uniqueRef.documentId &&
    (!currentDocumentId || isGenericDocumentName(currentDocumentId)) &&
    !matchesDocumentRef(currentDocumentId, uniqueRef)
  ) {
    nextResultData.document_id = uniqueRef.documentId
  }

  return nextResultData
}
