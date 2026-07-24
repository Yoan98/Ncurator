import { z } from 'zod/v4'
import type { JsonObject } from '../../../../../../shared/types'
import { visualRecognitionRequestSchema } from '../visualRecognition/schemas'

const sourcePathSchema = z.string().trim().min(1)
const slideIdSchema = z.string().trim().min(1)
const slideIndexSchema = z.number().int().min(1)

const pptSlideHtmlSchema = z.string().min(1)

export const pptBoundsSchema = z
  .object({
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().positive(),
    height: z.number().positive()
  })
  .strict()

const pptPointSchema = z
  .object({
    x: z.number().min(0),
    y: z.number().min(0)
  })
  .strict()

export const pptElementStyleSchema = z
  .object({
    fill: z.string().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().min(0).optional(),
    color: z.string().optional(),
    fontFamily: z.string().optional(),
    fontSize: z.number().positive().optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    rotation: z.number().optional(),
    shadow: z.boolean().optional()
  })
  .strict()

export const pptSlideRangeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('slide_index'),
      fromSlideIndex: slideIndexSchema,
      toSlideIndex: slideIndexSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('slide_ids'),
      slideIds: z.array(slideIdSchema).min(1)
    })
    .strict()
])

const pptOutlineRangeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('percent'),
      fromPercent: z.number().min(0).max(100),
      toPercent: z.number().min(0).max(100)
    })
    .strict(),
  z
    .object({
      type: z.literal('slide_index'),
      fromSlideIndex: slideIndexSchema,
      toSlideIndex: slideIndexSchema
    })
    .strict()
])

export const pptOutlineSchema = z
  .object({
    sourcePath: sourcePathSchema,
    ranges: z.array(pptOutlineRangeSchema).min(1)
  })
  .strict()

export const pptReadSlidesSchema = z
  .object({
    sourcePath: sourcePathSchema,
    ranges: z.array(pptSlideRangeSchema).min(1)
  })
  .strict()

export const pptSearchSchema = z
  .object({
    sourcePath: sourcePathSchema,
    query: z.string().min(1),
    scope: z
      .object({
        slideIds: z.array(slideIdSchema).min(1)
      })
      .strict()
      .optional()
  })
  .strict()

export const pptRenderSchema = z
  .object({
    sourcePath: sourcePathSchema,
    ranges: z.array(pptSlideRangeSchema).min(1)
  })
  .strict()

export const pptReadVisualsSchema = z
  .object({
    sourcePath: sourcePathSchema,
    requests: z.array(visualRecognitionRequestSchema).min(1).max(10)
  })
  .strict()

const chartTypeSchema = z.enum(['bar', 'column', 'line', 'pie', 'doughnut', 'area'])
const chartSeriesSchema = z
  .object({
    name: z.string(),
    values: z.array(z.number()).min(1)
  })
  .strict()
const imageFitSchema = z.enum(['contain', 'cover', 'stretch'])

const pptElementSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('text'),
      text: z.string(),
      bounds: pptBoundsSchema,
      style: pptElementStyleSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('shape'),
      shape: z.enum(['rect', 'roundRect', 'ellipse', 'triangle', 'chevron', 'arrow']),
      bounds: pptBoundsSchema,
      text: z.string().optional(),
      style: pptElementStyleSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('line'),
      from: pptPointSchema,
      to: pptPointSchema,
      color: z.string().optional(),
      width: z.number().positive().optional(),
      arrowEnd: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('image'),
      assetPath: z.string().min(1),
      bounds: pptBoundsSchema,
      fit: imageFitSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('table'),
      bounds: pptBoundsSchema,
      rows: z.array(z.array(z.string()).min(1)).min(1)
    })
    .strict(),
  z
    .object({
      type: z.literal('chart'),
      bounds: pptBoundsSchema,
      chartType: chartTypeSchema,
      categories: z.array(z.string()).min(1),
      series: z.array(chartSeriesSchema).min(1),
      title: z.string().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('formula'),
      latex: z.string().min(1),
      bounds: pptBoundsSchema
    })
    .strict()
])

const pptElementOperationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('set_text'),
      elementId: z.string().min(1),
      text: z.string()
    })
    .strict(),
  z
    .object({
      type: z.literal('set_bounds'),
      elementId: z.string().min(1),
      bounds: pptBoundsSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('set_style'),
      elementId: z.string().min(1),
      style: pptElementStyleSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('set_z_order'),
      elementId: z.string().min(1),
      placement: z.enum(['front', 'back', 'forward', 'backward'])
    })
    .strict(),
  z
    .object({
      type: z.literal('delete_element'),
      elementId: z.string().min(1)
    })
    .strict(),
  z
    .object({
      type: z.literal('duplicate_element'),
      elementId: z.string().min(1)
    })
    .strict(),
  z
    .object({
      type: z.literal('add_element'),
      element: pptElementSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('replace_image'),
      elementId: z.string().min(1),
      assetPath: z.string().min(1),
      fit: imageFitSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('update_table'),
      elementId: z.string().min(1),
      cells: z
        .array(
          z
            .object({
              rowIndex: z.number().int().min(1),
              columnIndex: z.number().int().min(1),
              text: z.string()
            })
            .strict()
        )
        .min(1)
    })
    .strict(),
  z
    .object({
      type: z.literal('update_chart'),
      elementId: z.string().min(1),
      chartType: chartTypeSchema,
      categories: z.array(z.string()).min(1),
      series: z.array(chartSeriesSchema).min(1),
      title: z.string().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('update_formula'),
      elementId: z.string().min(1),
      latex: z.string().min(1)
    })
    .strict()
])

export const pptEditActionSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('create_presentation'), html: z.array(pptSlideHtmlSchema).min(1) })
    .strict(),
  z
    .object({
      type: z.literal('insert_slide'),
      beforeSlideId: slideIdSchema.optional(),
      html: pptSlideHtmlSchema
    })
    .strict(),
  z.object({ type: z.literal('delete_slides'), slideIds: z.array(slideIdSchema).min(1) }).strict(),
  z
    .object({
      type: z.literal('move_slide'),
      slideId: slideIdSchema,
      beforeSlideId: slideIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('duplicate_slide'),
      slideId: slideIdSchema,
      beforeSlideId: slideIdSchema.optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('replace_text'),
      query: z.string().min(1),
      replace: z.string(),
      slideIds: z.array(slideIdSchema).optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('edit_elements'),
      slideId: slideIdSchema,
      operations: z.array(pptElementOperationSchema).min(1)
    })
    .strict(),
  z
    .object({
      type: z.literal('set_notes'),
      slideId: slideIdSchema,
      text: z.string()
    })
    .strict()
])

export const pptEditSchema = z
  .object({
    sourcePath: sourcePathSchema,
    actions: z.array(pptEditActionSchema).min(1)
  })
  .strict()

export const pptToolOutputSchema = z.object({
  sourcePath: z.string(),
  slideCount: z.number().int().min(0).optional(),
  changedSlideIds: z.array(z.string()).optional(),
  slides: z.array(z.custom<JsonObject>()).optional(),
  matches: z.array(z.custom<JsonObject>()).optional(),
  totalMatchCount: z.number().int().min(0).optional(),
  returnedMatchCount: z.number().int().min(0).optional(),
  assetBucketId: z.string().optional(),
  images: z.array(z.custom<JsonObject>()).optional(),
  postWriteReadback: z.custom<JsonObject>().optional(),
  warnings: z.array(z.string()),
  ok: z.literal(false).optional(),
  error: z.string().optional()
})

export type PptOutlineInput = z.infer<typeof pptOutlineSchema>
export type PptReadSlidesInput = z.infer<typeof pptReadSlidesSchema>
export type PptSearchInput = z.infer<typeof pptSearchSchema>
export type PptRenderInput = z.infer<typeof pptRenderSchema>
export type PptEditInput = z.infer<typeof pptEditSchema>
export type PptSlideRange = z.infer<typeof pptSlideRangeSchema>
export type PptElementOperation = z.infer<typeof pptElementOperationSchema>
