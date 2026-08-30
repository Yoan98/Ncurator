export type LearnSkillOutput = Record<string, never>

export type UpdatePlanOutput = Record<string, never>

export type ReadImageItem = {
  path: string
  mimeType: string
  sizeBytes: number
  width: number
  height: number
}

export type ReadImageOutput = {
  images: ReadImageItem[]
}
