import type { JsonObject } from '../../../../../../shared/types'

export type PptOutlineSlideOutput = {
  slideId: string
  slideIndex: number
  title?: string
  text?: string
  notes?: string
  elementCount?: number
}

export type PptReadSlideOutput = {
  slideId: string
  slideIndex: number
  title?: string
  text?: string
  notes?: string
  slideImagePath: string
  elements?: JsonObject[]
}

export type PptSearchMatchOutput = {
  slideId: string
  slideIndex: number
  matchedText: string
  text: string
  source: 'slide' | 'notes'
}

export type PptReadOutlineOutput = {
  slideCount: number
  slides: PptOutlineSlideOutput[]
}

export type PptReadSlidesOutput = {
  slides: PptReadSlideOutput[]
}

export type PptSearchOutput = {
  totalMatchCount: number
  returnedMatchCount: number
  truncated: boolean
  matches: PptSearchMatchOutput[]
}

export type PptEditOutput = {
  slideId?: string
  createdElementIds?: string[]
}
