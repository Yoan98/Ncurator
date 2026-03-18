import fs from 'node:fs/promises'
import type {
  DocxDetailedBlock,
  DocxDetailedTableBlock,
  DocxOutlineBlock
} from '../../../../src/main/services/ai/tools/docx/types'
import type { AiRunEvent, DocumentRecord, SearchResult } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { BackendTestRuntime, TestCaseDefinition } from '../../../harness/backend/test-types'

type AiToolCaseDefinition<TResult> = Omit<TestCaseDefinition<TResult>, 'domain' | 'layer' | 'suite'>

export const defineAiToolCase = <TResult>(definition: AiToolCaseDefinition<TResult>): void => {
  it(definition.caseId, async () => {
    await runBackendCase({
      ...definition,
      domain: 'ai',
      layer: 'backend',
      suite: 'tools'
    })
  })
}

export const getCollectedEvents = (runtime: BackendTestRuntime): AiRunEvent[] =>
  runtime.eventCollector.snapshot()

export const getEventsByType = <TType extends AiRunEvent['type']>(
  runtime: BackendTestRuntime,
  type: TType
): Array<Extract<AiRunEvent, { type: TType }>> => {
  return getCollectedEvents(runtime).filter((event) => event.type === type) as Array<
    Extract<AiRunEvent, { type: TType }>
  >
}

export const findOutlineBlockContaining = (
  blocks: readonly DocxOutlineBlock[],
  text: string
): DocxOutlineBlock | undefined => {
  return blocks.find((block) => {
    if (block.type === 'table') {
      return block.preview.includes(text)
    }
    return block.text.includes(text)
  })
}

export const findParagraphBlockContaining = (
  blocks: readonly DocxOutlineBlock[],
  text: string
): Extract<DocxOutlineBlock, { type: 'paragraph' }> | undefined => {
  return blocks.find((block) => block.type === 'paragraph' && block.text.includes(text)) as
    | Extract<DocxOutlineBlock, { type: 'paragraph' }>
    | undefined
}

export const findCellBlockContaining = (
  blocks: readonly DocxOutlineBlock[],
  text: string
): Extract<DocxOutlineBlock, { type: 'table_cell' }> | undefined => {
  return blocks.find((block) => block.type === 'table_cell' && block.text.includes(text)) as
    | Extract<DocxOutlineBlock, { type: 'table_cell' }>
    | undefined
}

export const asTableBlock = (
  block: DocxDetailedBlock
): Extract<DocxDetailedBlock, { type: 'table' }> | null => {
  if (block.type !== 'table') return null
  return block as DocxDetailedTableBlock
}

export const readWorkspaceText = async (filePath: string): Promise<string> =>
  await fs.readFile(filePath, 'utf8')

export const createDocumentRecord = (input: {
  id: string
  name: string
  sourceType?: 'file' | 'web'
}): DocumentRecord => ({
  id: input.id,
  name: input.name,
  source_type: input.sourceType || 'file',
  created_at: 1,
  import_status: 2
})

export const createSearchResult = (input: {
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
  _score: input.score
})
