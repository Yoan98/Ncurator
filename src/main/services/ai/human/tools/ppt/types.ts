import type { PresentationData } from 'pptx-kit'
import type { AiFileChangeRecord, JsonObject } from '../../../../../../shared/types'
import type { WorkspaceCapabilityBuildInput } from '../types'

export type PptBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type PptElementStyle = {
  fill?: string
  stroke?: string
  strokeWidth?: number
  radius?: number
  opacity?: number
  rotation?: number
  shadow?: string
  color?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  italic?: boolean
  underline?: boolean
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  borders?: {
    top?: { color: string; width: number }
    right?: { color: string; width: number }
    bottom?: { color: string; width: number }
    left?: { color: string; width: number }
  }
}

export type PptCompiledElement = {
  sourceId: string
  type: 'text' | 'shape' | 'image' | 'svg' | 'table' | 'chart' | 'formula' | 'line'
  bounds: PptBounds
  style: PptElementStyle
  text?: string
  src?: string
  imageFit?: 'fill' | 'contain' | 'cover'
  svg?: string
  latex?: string
  rows?: string[][]
  chartType?: 'bar' | 'column' | 'line' | 'pie' | 'doughnut' | 'area'
  line?: { from: { x: number; y: number }; to: { x: number; y: number } }
  zIndex: number
}

export type PptCompiledSlide = {
  width: number
  height: number
  background: string
  notes?: string
  elements: PptCompiledElement[]
  warnings: string[]
}

export type PptRuntimeDocument = {
  changeId: string
  sourcePath: string
  sourceName: string
  beforeBytes?: Uint8Array
  lastPersistedBytes?: Uint8Array
  presentation: PresentationData
  dirty: boolean
  changedSlideIds: Set<string>
  warnings: string[]
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
  image: string
}

export type PptDiffSlide = {
  slideId: string
  changed: boolean
  changes: Array<'added' | 'deleted' | 'modified' | 'moved'>
  before?: PptDiffFrame
  after?: PptDiffFrame
}

export type PptDiffManifest = {
  version: 2
  operation: 'created' | 'updated'
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
