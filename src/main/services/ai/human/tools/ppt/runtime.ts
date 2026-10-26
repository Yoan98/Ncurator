import { pptSlideIdentities, writeReviewIndex } from '../../../fileChanges/reviewNavigationIndex'
import type { ReviewRegion } from '../../../../../../shared/fileReview'
import type { FileChangeIdentity } from '../../../fileChanges/FileChangeSession'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import {
  addBlankSlide,
  addSlideChart,
  addSlideImage,
  addSlideLine,
  addSlideShape,
  addSlideTable,
  addSlideTextBox,
  bringShapeForward,
  bringShapeToFront,
  clearShapeEffects,
  copyShape,
  createPresentation,
  duplicateSlide,
  emu,
  findShapeById,
  getShapeBoundsResolved,
  getGroupChildren,
  getShapeDescription,
  getShapeEffects,
  getShapeFillColor,
  getShapeChartSpec,
  getShapeImageBrightness,
  getShapeImageBytes,
  getShapeImageContrast,
  getShapeImageCrop,
  getShapeImageOpacity,
  getShapeId,
  getShapeKind,
  getShapePreset,
  getShapeRotation,
  getShapeRunFormat,
  getShapeStrokeColor,
  getShapeStrokeWidth,
  getShapeText,
  getShapeTextAnchor,
  getShapeParagraphCount,
  getShapeRunCount,
  getShapeRunFormatEffective,
  getParagraphAlignment,
  hasShapeText,
  getShapeTextAutoFit,
  getShapeTextMargins,
  getShapeTextWrap,
  getShapeZIndex,
  getSlideBackground,
  getSlideBackgroundImageBytes,
  getSlideNotes,
  getSlideCharts,
  getSlidePartName,
  getSlideShapes,
  getSlideSize,
  getSlideText,
  getSlideTitle,
  getSlides,
  getTableCell,
  getTableCells,
  getTableCellText,
  getTableCellParagraphs,
  getTableColumnWidths,
  getTableRowHeights,
  isChartShape,
  isTableShape,
  loadPresentation,
  moveSlide,
  removeShape,
  removeSlide,
  replaceTextInPresentation,
  savePresentation,
  sendShapeBackward,
  sendShapeToBack,
  setChartSpec,
  setShapeBounds,
  setShapeDescription,
  setShapeFill,
  setShapeImage,
  setShapeImageCrop,
  setShapeNoFill,
  setShapeNoStroke,
  setShapeRotation,
  setShapeShadow,
  setShapeStroke,
  setShapeStrokeArrow,
  setShapeText,
  setShapeTextAnchor,
  setShapeTextAutoFit,
  setShapeTextFormat,
  setShapeTextMargins,
  setShapeTextWrap,
  setShapeZIndex,
  setShapeAlignment,
  setSlideBackground,
  setSlideNotes,
  setTableCellText,
  setTableCellTextFormat,
  setTableColumnWidth,
  setTableRowHeight,
  validatePresentation,
  type ChartKind,
  type PresentationData,
  type SlideData,
  type SlideShapeData
} from 'pptx-kit'
import { assertPptTableFits, renderPptSlideSvg } from './textLayout'
import type { JsonObject, JsonValue } from '../../../../../../shared/types'
import { fileExists } from '../docx/review/utils'
import { resolveToolPath } from '../terminal/commandPolicy'
import { getPartnerAssetsRootDir } from '../../../../assets/WorkspaceAssetService'
import { PPT_SEARCH_MAX_MATCHES } from './constants'
import { normalizePptColor, PPT_CANVAS_HEIGHT, PPT_CANVAS_WIDTH } from './color'
import { renderLatexToSvg } from './formula'
import { buildPptDiffManifest } from './diff'
import {
  applyPptSlideDefaults,
  assertPptElementInCanvas,
  assertPptElementSpec,
  assertPptTextFitsBounds,
  PPT_DEFAULT_TEXT_FONT_SIZE_PT,
  pptEditSchema,
  pptOutlineSchema,
  pptReadSlidesSchema,
  pptSearchSchema,
  type PptElement,
  type PptElementOperation,
  type PptSlideDefaults,
  type PptSlideRange
} from './toolSchemas'
import type {
  PptBounds,
  PptDiffFrame,
  PptDiffSlideSnapshot,
  PptOutlineItem,
  PptReadbackElement,
  PptReadbackSlide,
  PptRuntimeDocument,
  PptToolRuntime
} from './types'

export { buildPptDiffManifest } from './diff'

const DEFAULT_WIDTH = PPT_CANVAS_WIDTH
const DEFAULT_HEIGHT = PPT_CANVAS_HEIGHT

const hashBytes = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex')

const normalizeHex = (value: string | undefined, fallback = '#FFFFFF'): string => {
  return normalizePptColor(value, fallback) || fallback
}

const getSlideDimensions = (presentation: PresentationData): { width: number; height: number } => {
  const size = getSlideSize(presentation)
  return {
    width: Number(size?.width || 12_192_000),
    height: Number(size?.height || 6_858_000)
  }
}

const boundsToEmu = (
  presentation: PresentationData,
  bounds: PptBounds,
  sourceWidth = DEFAULT_WIDTH,
  sourceHeight = DEFAULT_HEIGHT
) => {
  const slide = getSlideDimensions(presentation)
  return {
    x: emu(Math.round((bounds.x / sourceWidth) * slide.width)),
    y: emu(Math.round((bounds.y / sourceHeight) * slide.height)),
    w: emu(Math.round((bounds.width / sourceWidth) * slide.width)),
    h: emu(Math.round((bounds.height / sourceHeight) * slide.height))
  }
}

const boundsFromEmu = (
  presentation: PresentationData,
  bounds: { x: number; y: number; w: number; h: number } | null
): PptBounds | undefined => {
  if (!bounds) return undefined
  const slide = getSlideDimensions(presentation)
  return {
    x: Math.round((Number(bounds.x) / slide.width) * DEFAULT_WIDTH),
    y: Math.round((Number(bounds.y) / slide.height) * DEFAULT_HEIGHT),
    width: Math.round((Number(bounds.w) / slide.width) * DEFAULT_WIDTH),
    height: Math.round((Number(bounds.h) / slide.height) * DEFAULT_HEIGHT)
  }
}

const slideIdOf = (slide: SlideData): string => getSlidePartName(slide)
const elementIdOf = (slide: SlideData, shape: SlideShapeData): string =>
  `${slideIdOf(slide)}#${getShapeId(shape)}`

const parseElementId = (elementId: string): { slideId: string; shapeId: number } | null => {
  const separator = elementId.lastIndexOf('#')
  if (separator <= 0) return null
  const shapeId = Number(elementId.slice(separator + 1))
  if (!Number.isInteger(shapeId)) return null
  return { slideId: elementId.slice(0, separator), shapeId }
}

const findSlide = (presentation: PresentationData, slideId: string): SlideData => {
  const slide = getSlides(presentation).find((item) => slideIdOf(item) === slideId)
  if (!slide) throw new Error(`Slide not found: slideId=${slideId}`)
  return slide
}

const findElement = (
  presentation: PresentationData,
  expectedSlide: SlideData,
  elementId: string
): SlideShapeData => {
  const parsed = parseElementId(elementId)
  if (!parsed || parsed.slideId !== slideIdOf(expectedSlide)) {
    throw new Error(`elementId does not belong to the current slide: ${elementId}`)
  }
  const shape = findShapeById(expectedSlide, parsed.shapeId)
  if (!shape) throw new Error(`Element not found: elementId=${elementId}`)
  void presentation
  return shape
}

const ensureAssetDirectory = async (partnerId: string, changeId: string) => {
  const root = path.join(getPartnerAssetsRootDir(partnerId), changeId)
  const media = path.join(root, 'media')
  const render = path.join(root, 'ppt-render')
  const diff = path.join(root, 'ppt-diff')
  const before = path.join(diff, 'before')
  const after = path.join(diff, 'after')
  await Promise.all(
    [media, render, before, after].map((directory) => fs.mkdir(directory, { recursive: true }))
  )
  return { root, media, render, before, after, manifest: path.join(diff, 'manifest.json') }
}

const decodeDataUrl = (value: string): Uint8Array | null => {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value)
  if (!match) return null
  return new Uint8Array(
    match[2]
      ? Buffer.from(match[3] || '', 'base64')
      : Buffer.from(decodeURIComponent(match[3] || ''), 'utf8')
  )
}

const escapeXml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ||
      character
  )

const createRemoteImagePlaceholder = (url: string): Uint8Array => {
  const displayUrl = url.length > 96 ? `${url.slice(0, 93)}...` : url
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#F3F4F6"/><rect x="3" y="3" width="634" height="354" fill="none" stroke="#9CA3AF" stroke-width="6"/><path d="M150 250l92-96 64 64 56-56 140 140H150z" fill="#D1D5DB"/><circle cx="448" cy="128" r="32" fill="#D1D5DB"/><text x="320" y="50" text-anchor="middle" font-family="Microsoft YaHei,Arial,sans-serif" font-size="24" fill="#4B5563">远程图片加载失败</text><text x="320" y="330" text-anchor="middle" font-family="Microsoft YaHei,Arial,sans-serif" font-size="16" fill="#6B7280">${escapeXml(displayUrl)}</text></svg>`
  return new Uint8Array(new Resvg(svg).render().asPng())
}

const isLikelyImageBytes = (bytes: Uint8Array): boolean => {
  const buffer = Buffer.from(bytes)
  return (
    (buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) ||
    buffer.toString('utf8', 0, 256).includes('<svg') ||
    buffer.subarray(0, 4).toString('ascii') === 'RIFF'
  )
}

const resolveAssetBytes = async (input: { rawPath: string }): Promise<Uint8Array> => {
  const data = decodeDataUrl(input.rawPath)
  if (data) return data
  if (/^https?:\/\//i.test(input.rawPath)) {
    try {
      const response = await fetch(input.rawPath, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length === 0 || !isLikelyImageBytes(bytes))
        throw new Error('invalid image response')
      return bytes
    } catch {
      return createRemoteImagePlaceholder(input.rawPath)
    }
  }
  let rawPath = input.rawPath
  if (/^file:/i.test(rawPath)) {
    try {
      rawPath = fileURLToPath(rawPath)
    } catch {
      throw new Error(`Invalid local file URL: ${input.rawPath}`)
    }
  }
  const resolved = resolveToolPath(rawPath)
  if (!resolved) throw new Error(`Invalid resource path: ${input.rawPath}`)
  return new Uint8Array(await fs.readFile(resolved))
}

const persistMedia = async (input: {
  document: PptRuntimeDocument
  workspaceRootPath: string
  bytes: Uint8Array
  extension: string
}): Promise<string> => {
  const dirs = await ensureAssetDirectory(input.workspaceRootPath, input.document.changeId)
  const target = path.join(dirs.media, `${hashBytes(input.bytes).slice(0, 20)}.${input.extension}`)
  await fs.writeFile(target, input.bytes)
  return target
}

type PptShapeStyle = {
  fill?: string
  stroke?: string
  strokeWidth?: number
  color?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  italic?: boolean
  underline?: boolean
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  rotation?: number
  shadow?: boolean | string
}

const applyShapeStyle = (shape: SlideShapeData, style: PptShapeStyle, textShape = false) => {
  if (style.fill) setShapeFill(shape, normalizeHex(style.fill))
  else if (textShape) setShapeNoFill(shape)
  if (style.stroke && Number(style.strokeWidth || 0) > 0) {
    setShapeStroke(shape, {
      color: normalizeHex(style.stroke, '#000000'),
      widthEmu: Math.round(Number(style.strokeWidth) * 12_700)
    })
  } else {
    setShapeNoStroke(shape)
  }
  if (style.rotation) setShapeRotation(shape, style.rotation)
  if (style.shadow) {
    setShapeShadow(shape, { opacity: 0.22, blurEmu: 50_800, offsetEmu: 25_400 })
  }
  if (textShape) {
    const usesDefaultFont =
      !style.fontFamily ||
      /^(arial|helvetica|sans-serif|times new roman|segoe ui|calibri|aptos|inter|roboto|system-ui)$/i.test(
        style.fontFamily
      )
    const textFont = usesDefaultFont ? 'Microsoft YaHei' : style.fontFamily || 'Microsoft YaHei'
    setShapeTextFormat(shape, {
      font: textFont,
      fontEastAsian: textFont,
      size: Math.max(8, style.fontSize || 18),
      color: normalizeHex(style.color, '#222222'),
      bold: (style.fontWeight || 400) >= 600,
      italic: style.italic,
      underline: style.underline
    })
    setShapeAlignment(shape, style.textAlign || 'left')
    if (style.verticalAlign) {
      setShapeTextAnchor(shape, style.verticalAlign === 'middle' ? 'center' : style.verticalAlign)
    }
    setShapeTextMargins(shape, { left: 0, right: 0, top: 0, bottom: 0 })
    setShapeTextWrap(shape, 'square')
    setShapeTextAutoFit(shape, 'normal')
  }
}

const placeSlide = (
  presentation: PresentationData,
  slide: SlideData,
  location?: { slideId: string; position: 'before' | 'after' }
): number => {
  const slides = getSlides(presentation)
  const sourceIndex = slides.findIndex((item) => item === slide)
  if (sourceIndex < 0) throw new Error('The target slide was not found')
  if (!location) {
    const targetIndex = slides.length - 1
    moveSlide(presentation, slide, targetIndex)
    return targetIndex
  }
  const anchorIndex = slides.findIndex((item) => slideIdOf(item) === location.slideId)
  if (anchorIndex < 0) throw new Error(`Slide not found: location.slideId=${location.slideId}`)
  const insertionIndex = location.position === 'before' ? anchorIndex : anchorIndex + 1
  const targetIndex = sourceIndex < insertionIndex ? insertionIndex - 1 : insertionIndex
  moveSlide(presentation, slide, targetIndex)
  return targetIndex
}

const definedObject = (input: Record<string, unknown>): JsonObject =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as JsonObject

const readShapeStyle = (shape: SlideShapeData): JsonObject | undefined => {
  let runFormat: ReturnType<typeof getShapeRunFormat> | undefined
  try {
    if (getShapeText(shape)) runFormat = getShapeRunFormat(shape, 0, 0) || undefined
  } catch {
    runFormat = undefined
  }
  const style = definedObject({
    fill: getShapeFillColor(shape) || undefined,
    stroke: getShapeStrokeColor(shape) || undefined,
    strokeWidth: getShapeStrokeWidth(shape)
      ? Math.round((Number(getShapeStrokeWidth(shape)) / 12_700) * 100) / 100
      : undefined,
    color: runFormat?.color || undefined,
    fontFamily: runFormat?.font || undefined,
    fontSize: runFormat?.size,
    bold: runFormat?.bold,
    italic: runFormat?.italic,
    underline: Boolean(runFormat?.underline) || undefined,
    verticalAlign:
      getShapeTextAnchor(shape) === 'center' ? 'middle' : getShapeTextAnchor(shape) || undefined,
    rotation: getShapeRotation(shape) || undefined
  })
  return Object.keys(style).length > 0 ? style : undefined
}

type TableLayout = {
  columnWidths?: number[]
  rowHeights?: number[]
  fontSize?: number
  fontFamily?: string
}

const applyTableLayout = (
  presentation: PresentationData,
  table: SlideShapeData,
  layout: TableLayout
): void => {
  const bounds = getShapeBoundsResolved(presentation, table)
  const size = getSlideSize(presentation)
  if (!bounds || !size) throw new Error('Cannot read the table or slide dimensions')
  const updateDimensions = (
    values: number[] | undefined,
    existing: readonly number[],
    extent: number,
    canvasExtent: number,
    slideExtent: number,
    label: string,
    setter: typeof setTableColumnWidth
  ): void => {
    if (!values) return
    const target = (extent * canvasExtent) / slideExtent
    if (
      values.length !== existing.length ||
      Math.abs(values.reduce((sum, value) => sum + value, 0) - target) > 0.1
    ) {
      throw new Error(
        `The table must have ${existing.length} ${label} values totaling ${target.toFixed(2)}pt`
      )
    }
    values.forEach((value, index) =>
      setter(table, index, emu(Math.round((value * slideExtent) / canvasExtent)))
    )
  }
  updateDimensions(
    layout.columnWidths,
    getTableColumnWidths(table),
    bounds.w,
    DEFAULT_WIDTH,
    size.width,
    'column width',
    setTableColumnWidth
  )
  updateDimensions(
    layout.rowHeights,
    getTableRowHeights(table),
    bounds.h,
    DEFAULT_HEIGHT,
    size.height,
    'row height',
    setTableRowHeight
  )
  if (layout.fontSize !== undefined || layout.fontFamily !== undefined) {
    for (const row of getTableCells(table)) {
      for (const cell of row) {
        setTableCellTextFormat(cell, {
          size: layout.fontSize,
          font: layout.fontFamily,
          fontEastAsian: layout.fontFamily
        })
      }
    }
  }
}

const readShapeDetails = (shape: SlideShapeData, slide: SlideData): JsonObject | undefined => {
  if (getShapeKind(shape) === 'group') {
    return { childElementIds: getGroupChildren(shape).map((child) => elementIdOf(slide, child)) }
  }
  if (isTableShape(shape)) {
    return {
      rows: getTableCells(shape).map((row) => row.map((cell) => getTableCellText(cell))),
      columnWidths: getTableColumnWidths(shape).map((width) => Number(width) / 12700),
      rowHeights: getTableRowHeights(shape).map((height) => Number(height) / 12700),
      paragraphs: JSON.parse(
        JSON.stringify(
          getTableCells(shape).map((row) => row.map((cell) => getTableCellParagraphs(cell)))
        )
      ) as JsonValue
    }
  }
  if (isChartShape(shape)) {
    const spec = getShapeChartSpec(shape)
    return spec
      ? definedObject({
          chartType: spec.kind,
          categories: [...spec.categories],
          series: spec.series.map((series) => ({
            name: series.name,
            values: [...series.values]
          })),
          title: spec.title
        })
      : undefined
  }
  const preset = getShapePreset(shape)
  return preset ? { shape: preset } : undefined
}

const readShapeType = (shape: SlideShapeData): string => {
  const description = getShapeDescription(shape) || ''
  if (description.startsWith('ppt-latex:')) return 'formula'
  if (isTableShape(shape)) return 'table'
  if (isChartShape(shape)) return 'chart'
  return getShapeKind(shape)
}

const canonicalize = (value: unknown): unknown => {
  if (value === undefined) return null
  if (value instanceof Uint8Array) return hashBytes(value)
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
  return value
}

const fingerprint = (value: unknown): string => hashBytes(JSON.stringify(canonicalize(value)))

const createPptDiffSlideSnapshots = (presentation: PresentationData): PptDiffSlideSnapshot[] =>
  getSlides(presentation).map((slide, index) => ({
    slideId: slideIdOf(slide),
    index: index + 1,
    pageFingerprint: fingerprint({
      background: getSlideBackground(slide),
      backgroundImage: getSlideBackgroundImageBytes(slide),
      notes: getSlideNotes(slide) || ''
    }),
    elements: getSlideShapes(slide).map((shape) => ({
      elementId: elementIdOf(slide, shape),
      fingerprint: fingerprint({
        type: readShapeType(shape),
        text: getShapeText(shape),
        description: getShapeDescription(shape),
        bounds: boundsFromEmu(presentation, getShapeBoundsResolved(presentation, shape)),
        style: readShapeStyle(shape),
        details: readShapeDetails(shape, slide),
        effects: getShapeEffects(presentation, shape),
        textMargins: getShapeTextMargins(shape),
        textWrap: getShapeTextWrap(shape),
        textAutoFit: getShapeTextAutoFit(shape),
        textAnchor: getShapeTextAnchor(shape),
        paragraphs: hasShapeText(shape)
          ? Array.from({ length: getShapeParagraphCount(shape) }, (_, paragraphIndex) => ({
              alignment: getParagraphAlignment(shape, paragraphIndex),
              formats: Array.from(
                { length: getShapeRunCount(shape, paragraphIndex) },
                (_, runIndex) =>
                  getShapeRunFormatEffective(presentation, shape, paragraphIndex, runIndex)
              )
            }))
          : [],
        image: getShapeImageBytes(shape),
        imageCrop: getShapeImageCrop(shape),
        imageOpacity: getShapeImageOpacity(shape),
        imageBrightness: getShapeImageBrightness(shape),
        imageContrast: getShapeImageContrast(shape)
      }),
      zIndex: getShapeZIndex(shape)
    }))
  }))

const slideReadback = (
  presentation: PresentationData,
  slide: SlideData,
  index: number,
  includeElements: boolean
): PptReadbackSlide => {
  const elements: PptReadbackElement[] | undefined = includeElements
    ? getSlideShapes(slide).map((shape) => {
        const description = getShapeDescription(shape) || ''
        const latex = description.startsWith('ppt-latex:')
          ? description.slice('ppt-latex:'.length)
          : undefined
        return {
          elementId: elementIdOf(slide, shape),
          type: readShapeType(shape),
          zIndex: getShapeZIndex(shape),
          bounds: boundsFromEmu(presentation, getShapeBoundsResolved(presentation, shape)),
          text: getShapeText(shape) || undefined,
          latex,
          style: readShapeStyle(shape),
          details: readShapeDetails(shape, slide)
        }
      })
    : undefined
  return {
    slideId: slideIdOf(slide),
    slideIndex: index + 1,
    title: getSlideTitle(slide) || undefined,
    text: getSlideText(slide),
    notes: getSlideNotes(slide) || undefined,
    elements
  }
}

const outlineItem = (
  presentation: PresentationData,
  slide: SlideData,
  index: number
): PptOutlineItem => ({
  ...slideReadback(presentation, slide, index, false),
  elementCount: getSlideShapes(slide).length
})

const assertIndexRange = (fromSlideIndex: number, toSlideIndex: number): void => {
  if (fromSlideIndex > toSlideIndex) {
    throw new Error('fromSlideIndex must not exceed toSlideIndex')
  }
}

const resolveSlideIndices = (slides: readonly SlideData[], ranges: readonly PptSlideRange[]) => {
  const indices = new Set<number>()
  for (const range of ranges) {
    if (range.type === 'slide_index') {
      assertIndexRange(range.fromSlideIndex, range.toSlideIndex)
      const to = Math.min(slides.length, range.toSlideIndex)
      for (let index = range.fromSlideIndex - 1; index < to; index += 1) {
        if (index >= 0) indices.add(index)
      }
      continue
    }
    for (const slideId of range.slideIds) {
      const index = slides.findIndex((slide) => slideIdOf(slide) === slideId)
      if (index < 0) throw new Error(`Slide not found: slideId=${slideId}`)
      indices.add(index)
    }
  }
  return [...indices].sort((left, right) => left - right)
}

const renderPresentationSlides = async (input: {
  presentation: PresentationData
  slideIds: string[]
  previewDir: string
  prefix: string
}): Promise<Map<string, PptDiffFrame & { hash: string }>> => {
  await fs.mkdir(input.previewDir, { recursive: true })
  const slides = getSlides(input.presentation)
  const output = new Map<string, PptDiffFrame & { hash: string }>()
  for (const slideId of input.slideIds) {
    const index = slides.findIndex((slide) => slideIdOf(slide) === slideId)
    if (index < 0) continue
    const svg = await renderPptSlideSvg(input.presentation, slides[index]!, true)
    const hash = hashBytes(svg)
    const svgPath = path.join(input.previewDir, `${input.prefix}-${hash.slice(0, 20)}.svg`)
    await fs.writeFile(svgPath, svg, 'utf8')
    output.set(slideId, { index: index + 1, svg: svgPath, hash })
  }
  return output
}

const readImageDimensions = (bytes: Uint8Array): { width: number; height: number } | null => {
  const buffer = Buffer.from(bytes)
  if (buffer.length >= 24 && buffer.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]!
      const length = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xc3 && length >= 7) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
      }
      offset += Math.max(2, length + 2)
    }
  }
  return null
}

function applyCoverCrop(shape: SlideShapeData, bytes: Uint8Array, bounds: PptBounds): void {
  const dimensions = readImageDimensions(bytes)
  if (!dimensions) return
  const imageAspect = dimensions.width / dimensions.height
  const boxAspect = bounds.width / bounds.height
  if (imageAspect > boxAspect) {
    const crop = (1 - boxAspect / imageAspect) / 2
    setShapeImageCrop(shape, { left: crop, right: crop })
  } else if (imageAspect < boxAspect) {
    const crop = (1 - imageAspect / boxAspect) / 2
    setShapeImageCrop(shape, { top: crop, bottom: crop })
  }
}

const resolveAndPersistAsset = async (input: {
  rawPath: string
  document: PptRuntimeDocument
  workspaceRootPath: string
}): Promise<Uint8Array> => {
  const bytes = await resolveAssetBytes({
    rawPath: input.rawPath
  })
  await persistMedia({
    document: input.document,
    workspaceRootPath: input.workspaceRootPath,
    bytes,
    extension: path.extname(input.rawPath).slice(1) || 'bin'
  })
  return bytes
}

const addFormulaShape = async (input: {
  slide: SlideData
  document: PptRuntimeDocument
  workspaceRootPath: string
  latex: string
  bounds: PptBounds
}): Promise<SlideShapeData> => {
  const svg = new Uint8Array(Buffer.from(renderLatexToSvg(input.latex), 'utf8'))
  await persistMedia({
    document: input.document,
    workspaceRootPath: input.workspaceRootPath,
    bytes: svg,
    extension: 'svg'
  })
  const shape = addSlideImage(input.slide, svg, {
    ...boundsToEmu(input.document.presentation, input.bounds),
    format: 'svg',
    fit: 'contain'
  })
  setShapeDescription(shape, `ppt-latex:${input.latex}`)
  return shape
}

const applyElementOperation = async (input: {
  operation: PptElementOperation
  document: PptRuntimeDocument
  slide: SlideData
  workspaceRootPath: string
  onReplaceElement: (beforeElementId: string, afterElementId: string) => void
}) => {
  const op = input.operation
  if (op.type === 'set_text') {
    setShapeText(findElement(input.document.presentation, input.slide, op.elementId), op.text)
    return
  }
  if (op.type === 'set_bounds') {
    assertPptElementInCanvas({ type: 'text', text: '', bounds: op.bounds })
    const shape = findElement(input.document.presentation, input.slide, op.elementId)
    const existingText = getShapeText(shape)
    if (existingText) {
      const runFormat = getShapeRunFormat(shape, 0, 0)
      assertPptTextFitsBounds({
        fontSize: runFormat?.size ?? PPT_DEFAULT_TEXT_FONT_SIZE_PT,
        boundsHeight: op.bounds.height
      })
    }
    setShapeBounds(shape, boundsToEmu(input.document.presentation, op.bounds))
    return
  }
  if (op.type === 'set_style') {
    const shape = findElement(input.document.presentation, input.slide, op.elementId)
    if (op.style.fontSize !== undefined) {
      const bounds = boundsFromEmu(
        input.document.presentation,
        getShapeBoundsResolved(input.document.presentation, shape)
      )
      if (bounds) {
        assertPptTextFitsBounds({
          fontSize: op.style.fontSize,
          boundsHeight: bounds.height
        })
      }
    }
    if (op.style.fill !== undefined) setShapeFill(shape, normalizeHex(op.style.fill))
    if (op.style.stroke !== undefined || op.style.strokeWidth !== undefined) {
      setShapeStroke(shape, {
        color: op.style.stroke ? normalizeHex(op.style.stroke, '#000000') : undefined,
        widthEmu:
          op.style.strokeWidth === undefined ? undefined : Math.round(op.style.strokeWidth * 12_700)
      })
    }
    if (
      op.style.color !== undefined ||
      op.style.fontFamily !== undefined ||
      op.style.fontSize !== undefined ||
      op.style.bold !== undefined ||
      op.style.italic !== undefined ||
      op.style.underline !== undefined
    ) {
      setShapeTextFormat(shape, {
        color: op.style.color ? normalizeHex(op.style.color, '#222222') : undefined,
        font: op.style.fontFamily,
        fontEastAsian: op.style.fontFamily,
        size: op.style.fontSize,
        bold: op.style.bold,
        italic: op.style.italic,
        underline: op.style.underline
      })
    }
    if (op.style.textAlign !== undefined) setShapeAlignment(shape, op.style.textAlign)
    if (op.style.verticalAlign !== undefined) {
      setShapeTextAnchor(
        shape,
        op.style.verticalAlign === 'middle' ? 'center' : op.style.verticalAlign
      )
    }
    if (op.style.rotation !== undefined) setShapeRotation(shape, op.style.rotation)
    if (op.style.shadow === true) setShapeShadow(shape)
    if (op.style.shadow === false) clearShapeEffects(shape)
    return
  }
  if (op.type === 'set_z_order') {
    const shape = findElement(input.document.presentation, input.slide, op.elementId)
    if (op.placement === 'front') bringShapeToFront(shape)
    else if (op.placement === 'back') sendShapeToBack(shape)
    else if (op.placement === 'forward') bringShapeForward(shape)
    else sendShapeBackward(shape)
    return
  }
  if (op.type === 'delete_element') {
    removeShape(findElement(input.document.presentation, input.slide, op.elementId))
    return
  }
  if (op.type === 'duplicate_element') {
    copyShape(input.slide, findElement(input.document.presentation, input.slide, op.elementId))
    return
  }
  if (op.type === 'replace_image') {
    const shape = findElement(input.document.presentation, input.slide, op.elementId)
    const bytes = await resolveAndPersistAsset({
      rawPath: op.assetPath,
      document: input.document,
      workspaceRootPath: input.workspaceRootPath
    })
    setShapeImage(shape, bytes, { fit: op.fit === 'contain' ? 'contain' : 'fill' })
    if (op.fit === 'cover') {
      const bounds = boundsFromEmu(
        input.document.presentation,
        getShapeBoundsResolved(input.document.presentation, shape)
      )
      if (bounds) applyCoverCrop(shape, bytes, bounds)
    } else {
      setShapeImageCrop(shape, null)
    }
    return
  }
  if (op.type === 'update_table') {
    const table = findElement(input.document.presentation, input.slide, op.elementId)
    if (!isTableShape(table)) throw new Error(`elementId is not a table: ${op.elementId}`)
    for (const cell of op.cells || []) {
      setTableCellText(getTableCell(table, cell.rowIndex - 1, cell.columnIndex - 1), cell.text)
    }
    applyTableLayout(input.document.presentation, table, op)
    await assertPptTableFits(input.document.presentation, input.slide, table)
    return
  }
  if (op.type === 'update_chart') {
    const shape = findElement(input.document.presentation, input.slide, op.elementId)
    const chart = getSlideCharts(input.slide).find(
      (item) => getShapeId(item.shape) === getShapeId(shape)
    )
    if (!chart) throw new Error(`elementId is not a chart: ${op.elementId}`)
    setChartSpec(chart, {
      kind: op.chartType as ChartKind,
      categories: op.categories,
      series: op.series,
      title: op.title
    })
    return
  }
  if (op.type === 'update_formula') {
    const oldShape = findElement(input.document.presentation, input.slide, op.elementId)
    const description = getShapeDescription(oldShape) || ''
    if (!description.startsWith('ppt-latex:')) {
      throw new Error(`elementId is not a formula: ${op.elementId}`)
    }
    const bounds = boundsFromEmu(
      input.document.presentation,
      getShapeBoundsResolved(input.document.presentation, oldShape)
    )
    if (!bounds) throw new Error(`The formula has no editable position: ${op.elementId}`)
    const zIndex = getShapeZIndex(oldShape)
    removeShape(oldShape)
    const shape = await addFormulaShape({
      slide: input.slide,
      document: input.document,
      workspaceRootPath: input.workspaceRootPath,
      latex: op.latex,
      bounds
    })
    setShapeZIndex(shape, zIndex)
    input.onReplaceElement(op.elementId, elementIdOf(input.slide, shape))
    return
  }

  const element = op.element
  assertPptElementSpec(element)
  if (element.type === 'line') {
    const slideSize = getSlideDimensions(input.document.presentation)
    const line = addSlideLine(input.slide, {
      from: {
        x: emu(Math.round((element.from.x / DEFAULT_WIDTH) * slideSize.width)),
        y: emu(Math.round((element.from.y / DEFAULT_HEIGHT) * slideSize.height))
      },
      to: {
        x: emu(Math.round((element.to.x / DEFAULT_WIDTH) * slideSize.width)),
        y: emu(Math.round((element.to.y / DEFAULT_HEIGHT) * slideSize.height))
      },
      color: normalizeHex(element.color, '#222222'),
      widthEmu: Math.round((element.width || 2) * 12_700)
    })
    if (element.arrowEnd) setShapeStrokeArrow(line, 'tail', { type: 'triangle' })
    return
  }

  const bounds = boundsToEmu(input.document.presentation, element.bounds)
  if (element.type === 'text') {
    const shape = addSlideTextBox(input.slide, { ...bounds, text: element.text })
    applyShapeStyle(
      shape,
      {
        color: element.style?.color,
        fontFamily: element.style?.fontFamily,
        fontSize: element.style?.fontSize,
        fontWeight: element.style?.bold ? 700 : undefined,
        italic: element.style?.italic,
        underline: element.style?.underline,
        textAlign: element.style?.textAlign,
        verticalAlign: element.style?.verticalAlign,
        rotation: element.style?.rotation
      },
      true
    )
    return
  }
  if (element.type === 'shape') {
    const preset = element.shape === 'arrow' ? 'rightArrow' : element.shape
    const shape = addSlideShape(input.slide, { preset, ...bounds, text: element.text })
    applyShapeStyle(
      shape,
      {
        fill: element.style?.fill,
        stroke: element.style?.stroke,
        strokeWidth: element.style?.strokeWidth,
        color: element.style?.color,
        fontFamily: element.style?.fontFamily,
        fontSize: element.style?.fontSize,
        fontWeight: element.style?.bold ? 700 : undefined,
        italic: element.style?.italic,
        underline: element.style?.underline,
        textAlign: element.style?.textAlign,
        verticalAlign: element.style?.verticalAlign,
        rotation: element.style?.rotation,
        shadow: element.style?.shadow ? 'default' : undefined
      },
      Boolean(element.text)
    )
    return
  }
  if (element.type === 'image') {
    const bytes = await resolveAndPersistAsset({
      rawPath: element.assetPath,
      document: input.document,
      workspaceRootPath: input.workspaceRootPath
    })
    const shape = addSlideImage(input.slide, bytes, {
      ...bounds,
      fit: element.fit === 'contain' ? 'contain' : 'fill'
    })
    if (element.fit === 'cover') applyCoverCrop(shape, bytes, element.bounds)
    return
  }
  if (element.type === 'table') {
    if (element.rows.some((row) => row.length !== element.rows[0]!.length)) {
      throw new Error('All table rows must have the same number of columns')
    }
    const table = addSlideTable(input.slide, { ...bounds, rows: element.rows })
    applyTableLayout(input.document.presentation, table, {
      ...element,
      fontSize: element.fontSize ?? 18
    })
    await assertPptTableFits(input.document.presentation, input.slide, table)
    return
  }
  if (element.type === 'chart') {
    addSlideChart(input.slide, {
      ...bounds,
      spec: {
        kind: element.chartType as ChartKind,
        categories: element.categories,
        series: element.series,
        title: element.title
      }
    })
    return
  }
  await addFormulaShape({
    slide: input.slide,
    document: input.document,
    workspaceRootPath: input.workspaceRootPath,
    latex: element.latex,
    bounds: element.bounds
  })
}

const elementIdsOf = (slide: SlideData): string[] =>
  getSlideShapes(slide).map((shape) => elementIdOf(slide, shape))

const createdIdsSince = (beforeIds: readonly string[], slide: SlideData): string[] => {
  const before = new Set(beforeIds)
  return elementIdsOf(slide).filter((id) => !before.has(id))
}

const applySlideSpec = async (input: {
  document: PptRuntimeDocument
  slide: SlideData
  elements: readonly PptElement[]
  defaults: PptSlideDefaults | undefined
  workspaceRootPath: string
}): Promise<void> => {
  for (const raw of input.elements) {
    await applyElementOperation({
      operation: { type: 'add_element', element: applyPptSlideDefaults(raw, input.defaults) },
      document: input.document,
      slide: input.slide,
      workspaceRootPath: input.workspaceRootPath,
      onReplaceElement: () => undefined
    })
  }
}

const editOutput = (
  slideId?: string,
  createdElementIds?: readonly string[]
): Record<string, unknown> => ({
  ...(slideId ? { slideId } : {}),
  ...(createdElementIds && createdElementIds.length > 0
    ? { createdElementIds: [...createdElementIds] }
    : {})
})

export const createPptToolRuntime = (input: PptToolRuntime['input']): PptToolRuntime => {
  const documents = new Map<string, PptRuntimeDocument>()
  const workspaceRootPath = input.partnerId

  const resolvePptPath = (rawPath: string): string => {
    const resolved = resolveToolPath(rawPath)
    if (!resolved || !resolved.toLowerCase().endsWith('.pptx')) {
      throw new Error('sourcePath must be a .pptx file')
    }
    return resolved
  }

  const loadDocument = async (
    rawPath: string,
    allowCreate = false
  ): Promise<PptRuntimeDocument> => {
    const sourcePath = resolvePptPath(rawPath)
    const existing = documents.get(sourcePath)
    if (existing) return existing
    const exists = await fileExists(sourcePath)
    if (!exists && !allowCreate) throw new Error(`PPTX file not found: ${rawPath}`)
    const beforeBytes = exists ? new Uint8Array(await fs.readFile(sourcePath)) : undefined
    const session = await input.ctx.getFileChangeSession(sourcePath)
    const identity = session?.identity?.kind === 'ppt' ? session.identity : undefined
    const presentation = beforeBytes ? await loadPresentation(beforeBytes) : createPresentation()
    const document: PptRuntimeDocument = {
      changeId: randomUUID(),
      sourcePath,
      sourceName: path.basename(sourcePath),
      beforeBytes,
      lastPersistedBytes: beforeBytes ? new Uint8Array(beforeBytes) : undefined,
      presentation,
      dirty: false,
      movedSlideIds: new Set(identity?.movedSlides),
      replacedSlideIds: new Set(identity?.replacedSlides),
      movedElementIds: new Set(identity?.movedElements),
      elementLineage: new Map(identity?.elementLineage)
    }
    documents.set(sourcePath, document)
    return document
  }

  const outline = async (rawArgs: unknown): Promise<Record<string, unknown>> => {
    const args = pptOutlineSchema.parse(rawArgs)
    const document = await loadDocument(args.sourcePath)
    const slides = getSlides(document.presentation)
    const selected = new Set<number>()
    for (const range of args.ranges) {
      if (range.type === 'slide_index') {
        assertIndexRange(range.fromSlideIndex, range.toSlideIndex)
        const to = Math.min(slides.length, range.toSlideIndex)
        for (let index = range.fromSlideIndex - 1; index < to; index += 1) {
          if (index >= 0) selected.add(index)
        }
        continue
      }
      if (range.fromPercent > range.toPercent) {
        throw new Error('fromPercent must not exceed toPercent')
      }
      if (slides.length === 0) continue
      const from = Math.min(
        slides.length - 1,
        Math.floor((range.fromPercent / 100) * slides.length)
      )
      const toExclusive = Math.max(
        from + 1,
        Math.min(slides.length, Math.ceil((range.toPercent / 100) * slides.length))
      )
      for (let index = from; index < toExclusive; index += 1) selected.add(index)
    }
    return {
      slideCount: slides.length,
      slides: [...selected]
        .sort((left, right) => left - right)
        .map((index) => outlineItem(document.presentation, slides[index]!, index))
    }
  }

  const readSlides = async (rawArgs: unknown): Promise<Record<string, unknown>> => {
    const args = pptReadSlidesSchema.parse(rawArgs)
    const document = await loadDocument(args.sourcePath)
    const slides = getSlides(document.presentation)
    const indices = resolveSlideIndices(slides, args.ranges)
    const detail = args.detail ?? 'full'
    return {
      slides: indices.map((index) => {
        const slide = slides[index]!
        if (detail === 'images') {
          return {
            slideId: slideIdOf(slide),
            slideIndex: index + 1
          }
        }
        return slideReadback(document.presentation, slide, index, true)
      })
    }
  }

  const search = async (rawArgs: unknown): Promise<Record<string, unknown>> => {
    const args = pptSearchSchema.parse(rawArgs)
    const document = await loadDocument(args.sourcePath)
    const slides = getSlides(document.presentation)
    const scopedIds = args.scope ? new Set(args.scope.slideIds) : null
    if (scopedIds) {
      for (const slideId of scopedIds) findSlide(document.presentation, slideId)
    }
    const query = args.query.toLocaleLowerCase()
    const allMatches = slides.flatMap((slide, index) => {
      if (scopedIds && !scopedIds.has(slideIdOf(slide))) return []
      const sources = [
        { source: 'slide' as const, text: getSlideText(slide) },
        { source: 'notes' as const, text: getSlideNotes(slide) || '' }
      ]
      return sources.flatMap(({ source, text }) =>
        text.toLocaleLowerCase().includes(query)
          ? [
              {
                slideId: slideIdOf(slide),
                slideIndex: index + 1,
                matchedText: args.query,
                text,
                source
              }
            ]
          : []
      )
    })
    const matches = allMatches.slice(0, PPT_SEARCH_MAX_MATCHES)
    return {
      totalMatchCount: allMatches.length,
      returnedMatchCount: matches.length,
      truncated: matches.length < allMatches.length,
      matches
    }
  }

  const render = async (rawArgs: unknown): Promise<Record<string, unknown>> => {
    const args = pptReadSlidesSchema.parse(rawArgs)
    const document = await loadDocument(args.sourcePath)
    const slides = getSlides(document.presentation)
    const indices = resolveSlideIndices(slides, args.ranges)
    const slideIds = indices.map((index) => slideIdOf(slides[index]!))
    const dirs = await ensureAssetDirectory(workspaceRootPath, document.changeId)
    const frames = await renderPresentationSlides({
      presentation: document.presentation,
      slideIds,
      previewDir: dirs.render,
      prefix: 'slide'
    })
    const dimensions = getSlideDimensions(document.presentation)
    const width = PPT_CANVAS_WIDTH
    const height = Math.round((width * dimensions.height) / dimensions.width)
    const images = await Promise.all(
      [...frames.entries()].map(async ([slideId, frame]) => {
        const svg = await fs.readFile(frame.svg, 'utf8')
        const png = new Uint8Array(
          new Resvg(svg, {
            fitTo: { mode: 'width', value: width },
            font: { loadSystemFonts: true, defaultFontFamily: 'Microsoft YaHei' }
          })
            .render()
            .asPng()
        )
        const pngPath = frame.svg.replace(/\.svg$/i, '.png')
        await fs.writeFile(pngPath, png)
        return {
          slideId,
          slideIndex: frame.index,
          path: pngPath,
          mimeType: 'image/png',
          width,
          height
        }
      })
    )
    return {
      sourcePath: args.sourcePath,
      assetBucketId: document.changeId,
      images
    }
  }

  const persistDocument = async (document: PptRuntimeDocument): Promise<number> => {
    if (getSlides(document.presentation).length === 0) {
      throw new Error('The presentation must retain at least one slide')
    }
    const issues = validatePresentation(document.presentation).filter(
      (issue) => issue.severity === 'error'
    )
    if (issues.length > 0) {
      throw new Error(`PPTX validation failed: ${issues.map((issue) => issue.message).join('; ')}`)
    }
    const afterBytes = await savePresentation(document.presentation)
    const confirmed = await input.ctx.writeFileChange({
      sourcePath: document.sourcePath,
      buffer: Buffer.from(afterBytes),
      capability: 'ppt',
      expectedChecksum: document.lastPersistedBytes
        ? hashBytes(document.lastPersistedBytes)
        : undefined,
      identity: {
        kind: 'ppt',
        movedSlides: [...document.movedSlideIds],
        replacedSlides: [...document.replacedSlideIds],
        movedElements: [...document.movedElementIds],
        elementLineage: [...document.elementLineage]
      }
    })
    document.changeId = confirmed.record.id
    document.lastPersistedBytes = new Uint8Array(afterBytes)
    document.dirty = true
    return getSlides(document.presentation).length
  }

  const edit = async (rawArgs: unknown): Promise<Record<string, unknown>> => {
    const args = pptEditSchema.parse(rawArgs)
    const sourcePath = resolvePptPath(args.sourcePath)
    const create = !documents.has(sourcePath) && !(await fileExists(sourcePath))
    const document = await loadDocument(args.sourcePath, create)
    try {
      let result: Record<string, unknown>
      if (args.type === 'insert_slide') {
        const slide = addBlankSlide(document.presentation)
        setSlideBackground(slide, normalizeHex(args.background, '#FFFFFF'))
        if (args.notes !== undefined) setSlideNotes(slide, args.notes)
        await applySlideSpec({
          document,
          slide,
          elements: args.elements,
          defaults: args.defaults,
          workspaceRootPath
        })
        placeSlide(document.presentation, slide, args.location)
        result = editOutput(slideIdOf(slide), elementIdsOf(slide))
      } else if (args.type === 'replace_slide') {
        const slide = findSlide(document.presentation, args.slideId)
        document.replacedSlideIds.add(args.slideId)
        for (const shape of [...getSlideShapes(slide)]) removeShape(shape)
        if (args.background !== undefined) setSlideBackground(slide, normalizeHex(args.background))
        if (args.notes !== undefined) setSlideNotes(slide, args.notes)
        await applySlideSpec({
          document,
          slide,
          elements: args.elements,
          defaults: args.defaults,
          workspaceRootPath
        })
        result = editOutput(args.slideId, elementIdsOf(slide))
      } else if (args.type === 'delete_slides') {
        for (const slideId of args.slideIds) {
          removeSlide(document.presentation, findSlide(document.presentation, slideId))
        }
        result = editOutput()
      } else if (args.type === 'move_slide') {
        const slide = findSlide(document.presentation, args.slideId)
        if (args.location.slideId === args.slideId) {
          throw new Error('move_slide location.slideId must differ from slideId')
        }
        placeSlide(document.presentation, slide, args.location)
        document.movedSlideIds.add(args.slideId)
        result = editOutput(args.slideId)
      } else if (args.type === 'duplicate_slide') {
        const source = findSlide(document.presentation, args.slideId)
        const duplicate = duplicateSlide(document.presentation, source)
        placeSlide(document.presentation, duplicate, args.location)
        result = editOutput(slideIdOf(duplicate), elementIdsOf(duplicate))
      } else if (args.type === 'replace_text') {
        const targetSlides = args.slideIds?.map((slideId) =>
          findSlide(document.presentation, slideId)
        )
        const changedSlideIds: string[] = []
        let replacements = 0
        if (targetSlides) {
          for (const slide of targetSlides) {
            for (const shape of getSlideShapes(slide)) {
              const text = getShapeText(shape)
              if (!text.includes(args.query)) continue
              setShapeText(shape, text.split(args.query).join(args.replace))
              replacements += 1
              changedSlideIds.push(slideIdOf(slide))
            }
          }
        } else {
          const beforeText = new Map(
            getSlides(document.presentation).map((slide) => [slideIdOf(slide), getSlideText(slide)])
          )
          replacements = replaceTextInPresentation(document.presentation, args.query, args.replace)
          if (replacements > 0) {
            getSlides(document.presentation).forEach((slide) => {
              if (beforeText.get(slideIdOf(slide)) !== getSlideText(slide)) {
                changedSlideIds.push(slideIdOf(slide))
              }
            })
          }
        }
        if (replacements === 0) throw new Error(`The text to replace was not found: ${args.query}`)
        const uniqueChanged = [...new Set(changedSlideIds)]
        result = editOutput(uniqueChanged.length === 1 ? uniqueChanged[0] : undefined)
      } else if (args.type === 'edit_elements') {
        const slide = findSlide(document.presentation, args.slideId)
        const beforeIds = elementIdsOf(slide)
        for (const operation of args.operations) {
          if (operation.type === 'set_z_order') {
            document.movedElementIds.add(operation.elementId)
          }
          await applyElementOperation({
            operation,
            document,
            slide,
            workspaceRootPath,
            onReplaceElement: (beforeElementId, afterElementId) => {
              document.elementLineage.set(beforeElementId, afterElementId)
            }
          })
        }
        result = editOutput(args.slideId, createdIdsSince(beforeIds, slide))
      } else {
        setSlideNotes(findSlide(document.presentation, args.slideId), args.text)
        result = editOutput(args.slideId)
      }
      await persistDocument(document)
      return result
    } catch (error) {
      documents.delete(sourcePath)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${args.type} failed: ${message}`)
    }
  }

  return { input, documents, outline, readSlides, search, render, edit }
}

export const toPptToolFailure = (sourcePath: string, error: unknown): JsonObject => ({
  sourcePath,
  error: error instanceof Error ? error.message : String(error)
})

export const materializePptReview = async (input: {
  before?: Buffer
  after: Buffer
  identity?: FileChangeIdentity
  reviewDir: string
}) => {
  const before = input.before ? await loadPresentation(input.before) : null
  const after = await loadPresentation(input.after)
  const identity = input.identity?.kind === 'ppt' ? input.identity : undefined
  const beforeSlides = before ? createPptDiffSlideSnapshots(before) : []
  const afterSlides = createPptDiffSlideSnapshots(after)
  const beforeDir = path.join(input.reviewDir, 'before'),
    afterDir = path.join(input.reviewDir, 'after')
  await fs.mkdir(beforeDir, { recursive: true })
  await fs.mkdir(afterDir, { recursive: true })
  const beforeFrames = before
    ? await renderPresentationSlides({
        presentation: before,
        slideIds: getSlides(before).map(slideIdOf),
        previewDir: beforeDir,
        prefix: 'before'
      })
    : new Map<string, PptDiffFrame & { hash: string }>()
  const afterFrames = await renderPresentationSlides({
    presentation: after,
    slideIds: getSlides(after).map(slideIdOf),
    previewDir: afterDir,
    prefix: 'after'
  })
  const manifest = buildPptDiffManifest({
    beforeSlides,
    afterSlides,
    beforeFrames,
    afterFrames,
    operation: input.before ? 'updated' : 'created',
    movedCandidates: new Set(identity?.movedSlides),
    replacedSlideIds: new Set(identity?.replacedSlides),
    movedElementCandidates: new Set(identity?.movedElements),
    elementLineage: new Map(identity?.elementLineage)
  })
  const identities = await pptSlideIdentities(input.after)
  const regions: ReviewRegion[] = []
  for (const slide of manifest.slides.filter((s) => s.changed)) {
    const slideId = identities.get(slide.slideId.replace(/^\//, ''))
    const currentSlide = getSlides(after).find((item) => slideIdOf(item) === slide.slideId)
    const target = slideId
      ? {
          kind: 'ppt' as const,
          slideId,
          text: currentSlide ? getSlideText(currentSlide) : '',
          container: false
        }
      : null
    const oldPage = beforeSlides.find((item) => item.slideId === slide.slideId)
    const newPage = afterSlides.find((item) => item.slideId === slide.slideId)
    if (
      !slide.elementChanges.length ||
      slide.changes.some((kind) => kind !== 'modified') ||
      oldPage?.pageFingerprint !== newPage?.pageFingerprint
    )
      regions.push({
        id: `ppt-${regions.length + 1}`,
        surface: slide.slideId,
        key: 'slide',
        target
      })
    for (const change of slide.elementChanges) {
      const shape = change.afterElementId?.split('#').at(-1)
      regions.push({
        id: `ppt-${regions.length + 1}`,
        surface: slide.slideId,
        key: (change.afterElementId || change.beforeElementId || '').split('#').at(-1) || '',
        target: target
          ? {
              ...target,
              shapeId: shape ? Number(shape) : undefined,
              text:
                shape && currentSlide
                  ? getShapeText(
                      getSlideShapes(currentSlide).find(
                        (item) => String(getShapeId(item)) === shape
                      )!
                    ) || ''
                  : target.text,
              container: !shape
            }
          : null
      })
    }
  }
  for (const slide of manifest.slides) {
    for (const change of slide.elementChanges) {
      if (
        !change.beforeElementId ||
        !change.afterElementId ||
        change.beforeElementId === change.afterElementId
      )
        continue
      const source = regions.find(
        (region) =>
          region.surface === slide.slideId &&
          region.key === change.afterElementId!.split('#').at(-1)
      )
      if (source)
        regions.push({
          ...source,
          id: `ppt-${regions.length + 1}`,
          key: change.beforeElementId.split('#').at(-1)!
        })
    }
  }
  await writeReviewIndex(input.reviewDir, input.after, regions)
  const previewPath = path.join(input.reviewDir, 'manifest.json')
  await fs.writeFile(previewPath, JSON.stringify(manifest))
  return {
    changed: manifest.positiveCount + manifest.negativeCount > 0,
    previewPath,
    changeCount: manifest.positiveCount + manifest.negativeCount,
    insertCount: manifest.positiveCount,
    deleteCount: manifest.negativeCount
  }
}
