import { z } from 'zod'

export const reviewLocationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('docx'),
    part: z.string(),
    paragraph: z.number().int().positive(),
    text: z.string(),
    previous: z.string(),
    next: z.string(),
    quote: z.string().optional(),
    container: z.boolean()
  }),
  z.object({
    kind: z.literal('ppt'),
    slideId: z.number().int().positive(),
    shapeId: z.number().int().positive().optional(),
    text: z.string(),
    container: z.boolean()
  }),
  z.object({
    kind: z.literal('excel'),
    sheet: z.string(),
    address: z.string().regex(/^\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?$/),
    value: z.string(),
    container: z.boolean()
  })
])
export type ReviewLocation = z.infer<typeof reviewLocationSchema>
export const reviewRegionSchema = z.object({
  id: z.string().min(1),
  surface: z.string(),
  key: z.string(),
  target: reviewLocationSchema.nullable()
})
export type ReviewRegion = z.infer<typeof reviewRegionSchema>
export const officeReviewIndexSchema = z.object({
  version: z.literal(1),
  afterChecksum: z.string(),
  regions: z.array(reviewRegionSchema)
})
export type OfficeReviewIndex = z.infer<typeof officeReviewIndexSchema>
export const textReviewSchema = z.object({
  version: z.literal(4),
  before: z.string(),
  after: z.string()
})
export type FileReviewContent =
  | { kind: 'text'; before: string; after: string }
  | { kind: 'office'; previewPath: string; index: OfficeReviewIndex }
export type GetFileReviewResponse =
  | { success: true; content: FileReviewContent }
  | { success: false; error: string }
export type ReviewNavigationResult = {
  status: 'located' | 'container' | 'opened' | 'failed'
  reason?: string
}
export type OpenFileReviewLocationRequest = { changeRecordId: string; regionId: string }

export const isWpsApplication = (application: { id?: string; name?: string }): boolean => {
  const id = (application.id || '').toLowerCase(),
    name = (application.name || '').toLowerCase()
  return (
    id.includes('wpsoffice') ||
    id.includes('kingsoft') ||
    name.includes('wpsoffice') ||
    /(^|[^a-z])wps([^a-z]|$)/.test(name) ||
    /wps办公|wps文字|wps表格|wps演示|金山wps/i.test(name)
  )
}
export const openWithExtension = (filePath: string): string => {
  const name = filePath.replace(/\\/g, '/').split('/').pop() || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export type OfficeReviewSelection =
  | { kind: 'docx'; start: number; end: number }
  | { kind: 'ppt'; slideId: number; shapeId?: number }
  | { kind: 'excel'; sheet: string; address: string }
