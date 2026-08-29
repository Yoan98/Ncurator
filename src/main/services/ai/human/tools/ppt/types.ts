import type { PresentationData } from 'pptx-kit'
import type { AiFileChangeRecord, JsonObject } from '../../../../../../shared/types'
import type { WorkspaceCapabilityBuildInput } from '../types'

export type PptBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type PptRuntimeDocument = {
  changeId: string
  sourcePath: string
  sourceName: string
  beforeBytes?: Uint8Array
  lastPersistedBytes?: Uint8Array
  presentation: PresentationData
  dirty: boolean
  movedSlideIds: Set<string>
  replacedSlideIds: Set<string>
  movedElementIds: Set<string>
  elementLineage: Map<string, string>
}

export type PptCapabilityToolsInput = WorkspaceCapabilityBuildInput

export type PptReadbackElement = {
  elementId: string
  type: string
  zIndex: number
  bounds?: PptBounds
  text?: string
  latex?: string
  style?: JsonObject
  details?: JsonObject
}

export type PptReadbackSlide = {
  slideId: string
  slideIndex: number
  title?: string
  text: string
  notes?: string
  elements?: PptReadbackElement[]
}

export type PptOutlineItem = Omit<PptReadbackSlide, 'elements'> & {
  elementCount: number
}

export type PptDiffFrame = {
  index: number
  svg: string
}

export type PptDiffElementSnapshot = {
  elementId: string
  fingerprint: string
  zIndex: number
}

export type PptDiffSlideSnapshot = {
  slideId: string
  index: number
  pageFingerprint: string
  elements: PptDiffElementSnapshot[]
}

export type PptDiffElementChange = {
  kind: 'added' | 'deleted' | 'modified'
  beforeElementId?: string
  afterElementId?: string
}

export type PptDiffSlide = {
  slideId: string
  changed: boolean
  changes: Array<'added' | 'deleted' | 'modified' | 'moved'>
  elementChanges: PptDiffElementChange[]
  positiveCount: number
  negativeCount: number
  before?: PptDiffFrame
  after?: PptDiffFrame
}

export type PptDiffManifest = {
  version: 4
  operation: 'created' | 'updated'
  positiveCount: number
  negativeCount: number
  slides: PptDiffSlide[]
}

export type PptToolRuntime = {
  input: PptCapabilityToolsInput
  documents: Map<string, PptRuntimeDocument>
  outline: (args: unknown) => Promise<Record<string, unknown>>
  readSlides: (args: unknown) => Promise<Record<string, unknown>>
  search: (args: unknown) => Promise<Record<string, unknown>>
  render: (args: unknown) => Promise<Record<string, unknown>>
  edit: (args: unknown) => Promise<Record<string, unknown>>
  commitAll: () => Promise<AiFileChangeRecord[]>
}
