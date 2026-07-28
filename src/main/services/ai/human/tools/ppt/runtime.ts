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
  getShapeDescription,
  getShapeFillColor,
  getShapeChartSpec,
  getShapeId,
  getShapeKind,
  getShapePreset,
  getShapeRotation,
  getShapeRunFormat,
  getShapeStrokeColor,
  getShapeStrokeWidth,
  getShapeText,
  getShapeTextAnchor,
  getShapeZIndex,
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
  validatePresentation,
  type ChartKind,
  type PresentationData,
  type SlideData,
  type SlideShapeData
} from 'pptx-kit'
import type { AiFileChangeRecord, JsonObject } from '../../../../../../shared/types'
import { fileExists } from '../docx/review/utils'
import { resolveWorkspacePath } from '../terminal/commandPolicy'
import {
  compilePptSlideHtml,
  normalizePptColor,
  PPT_CANVAS_HEIGHT,
  PPT_CANVAS_WIDTH
} from './htmlCompiler'
import { renderLatexToSvg } from './formula'
import {
  pptEditSchema,
  pptOutlineSchema,
  pptReadSlidesSchema,
  pptRenderSchema,
  pptSearchSchema,
  type PptElementOperation,
  type PptSlideRange
} from './schemas'
import type {
  PptBounds,
  PptCompiledElement,
  PptCompiledSlide,
  PptDiffFrame,
  PptDiffManifest,
  PptDiffSlide,
  PptOutlineItem,
  PptReadbackElement,
  PptReadbackSlide,
  PptRuntimeDocument,
  PptToolRuntime
} from './types'

const DEFAULT_WIDTH = PPT_CANVAS_WIDTH
const DEFAULT_HEIGHT = PPT_CANVAS_HEIGHT

const hashBytes = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex')

const replaceFileWithBytes = async (targetPath: string, bytes: Uint8Array): Promise<void> => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const token = randomUUID()
  const tempPath = `${targetPath}.ncurator-${token}.tmp`
  const backupPath = `${targetPath}.ncurator-${token}.previous`
  let hasBackup = false
  let preserveBackup = false
  try {
    await fs.writeFile(tempPath, bytes)
    try {
      await fs.copyFile(targetPath, backupPath)
      hasBackup = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    try {
      await fs.rename(tempPath, targetPath)
    } catch {
      await fs.rm(targetPath, { force: true })
      await fs.rename(tempPath, targetPath)
    }
  } catch (error) {
    if (hasBackup) {
      try {
        await fs.rm(targetPath, { force: true })
        await fs.rename(backupPath, targetPath)
        hasBackup = false
      } catch {
        // Preserve the original error. The backup remains beside the target for recovery.
        preserveBackup = true
      }
    }
    throw error
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    if (hasBackup && !preserveBackup) {
      await fs.rm(backupPath, { force: true }).catch(() => undefined)
    }
  }
}

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
  if (!slide) throw new Error(`找不到页面 slideId=${slideId}`)
  return slide
}

const findElement = (
  presentation: PresentationData,
  expectedSlide: SlideData,
  elementId: string
): SlideShapeData => {
  const parsed = parseElementId(elementId)
  if (!parsed || parsed.slideId !== slideIdOf(expectedSlide)) {
    throw new Error(`elementId 不属于当前页面: ${elementId}`)
  }
  const shape = findShapeById(expectedSlide, parsed.shapeId)
  if (!shape) throw new Error(`找不到元素 elementId=${elementId}`)
  void presentation
  return shape
}

const ensureAssetDirectory = async (workspaceRootPath: string, changeId: string) => {
  const root = path.join(workspaceRootPath, '.ncurator', 'runtime', 'assets', changeId)
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

const resolveAssetBytes = async (input: {
  rawPath: string
  sourcePath: string
  workspaceRootPath: string
}): Promise<Uint8Array> => {
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
      throw new Error(`无效的本地 file URL: ${input.rawPath}`)
    }
  }
  const resolved = resolveWorkspacePath({
    rawPath,
    cwd: path.dirname(input.sourcePath),
    rootPath: input.workspaceRootPath
  })
  if (!resolved) throw new Error(`资源路径超出工作区: ${input.rawPath}`)
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

const applyShapeStyle = (
  shape: SlideShapeData,
  style: PptCompiledElement['style'],
  textShape = false
) => {
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
      size: Math.max(8, (style.fontSize || 32) * 0.5),
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

const addCompiledBorders = (input: {
  presentation: PresentationData
  slide: SlideData
  compiled: PptCompiledSlide
  element: PptCompiledElement
}): void => {
  const borders = input.element.style.borders
  if (!borders) return
  const slideSize = getSlideDimensions(input.presentation)
  const point = (x: number, y: number) => ({
    x: emu(Math.round((x / input.compiled.width) * slideSize.width)),
    y: emu(Math.round((y / input.compiled.height) * slideSize.height))
  })
  const { x, y, width, height } = input.element.bounds
  const sides = [
    { border: borders.top, from: point(x, y), to: point(x + width, y) },
    { border: borders.right, from: point(x + width, y), to: point(x + width, y + height) },
    { border: borders.bottom, from: point(x + width, y + height), to: point(x, y + height) },
    { border: borders.left, from: point(x, y + height), to: point(x, y) }
  ]
  for (const side of sides) {
    if (!side.border || side.border.width <= 0) continue
    addSlideLine(input.slide, {
      from: side.from,
      to: side.to,
      color: normalizeHex(side.border.color, '#000000'),
      widthEmu: Math.round(side.border.width * 12_700)
    })
  }
}

const addCompiledElement = async (input: {
  document: PptRuntimeDocument
  slide: SlideData
  compiled: PptCompiledSlide
  element: PptCompiledElement
  workspaceRootPath: string
}) => {
  const bounds = boundsToEmu(
    input.document.presentation,
    input.element.type === 'text'
      ? {
          ...input.element.bounds,
          width: Math.min(
            input.compiled.width - input.element.bounds.x,
            input.element.bounds.width +
              Math.max(24, Math.min(72, (input.element.style.fontSize || 32) * 1.5))
          ),
          height: Math.min(
            input.compiled.height - input.element.bounds.y,
            input.element.bounds.height + Math.max(16, (input.element.style.fontSize || 32) * 0.8)
          )
        }
      : input.element.bounds,
    input.compiled.width,
    input.compiled.height
  )
  if (input.element.type === 'shape') {
    const shape = addSlideShape(input.slide, {
      preset: input.element.style.radius ? 'roundRect' : 'rect',
      text: '',
      ...bounds
    })
    applyShapeStyle(shape, input.element.style)
    addCompiledBorders({
      presentation: input.document.presentation,
      slide: input.slide,
      compiled: input.compiled,
      element: input.element
    })
    return
  }
  if (input.element.type === 'text') {
    const shape = addSlideTextBox(input.slide, { ...bounds, text: input.element.text || '' })
    applyShapeStyle(shape, input.element.style, true)
    addCompiledBorders({
      presentation: input.document.presentation,
      slide: input.slide,
      compiled: input.compiled,
      element: input.element
    })
    return
  }
  if (input.element.type === 'line') {
    const lineSpec = input.element.line || {
      from: { x: 0, y: 0 },
      to: { x: input.element.bounds.width, y: input.element.bounds.height }
    }
    const slideSize = getSlideDimensions(input.document.presentation)
    const point = (offset: { x: number; y: number }) => ({
      x: emu(
        Math.round(((input.element.bounds.x + offset.x) / input.compiled.width) * slideSize.width)
      ),
      y: emu(
        Math.round(((input.element.bounds.y + offset.y) / input.compiled.height) * slideSize.height)
      )
    })
    addSlideLine(input.slide, {
      from: point(lineSpec.from),
      to: point(lineSpec.to),
      color: normalizeHex(input.element.style.stroke || input.element.style.color, '#222222'),
      widthEmu: Math.round(Math.max(1, input.element.style.strokeWidth || 2) * 12_700)
    })
    return
  }
  if (input.element.type === 'table') {
    addSlideTable(input.slide, { ...bounds, rows: input.element.rows || [['']] })
    return
  }
  if (input.element.type === 'chart') {
    const rows = input.element.rows || []
    const categories = rows.slice(1).map((row) => row[0] || '')
    const headings = rows[0]?.slice(1) || ['数据']
    const series = headings.map((name, column) => ({
      name,
      values: rows.slice(1).map((row) => Number(row[column + 1]) || 0)
    }))
    addSlideChart(input.slide, {
      ...bounds,
      spec: { kind: input.element.chartType || 'column', categories, series }
    })
    return
  }
  let bytes: Uint8Array
  let format: 'svg' | undefined
  if (input.element.type === 'formula') {
    const svg = renderLatexToSvg(input.element.latex || '')
    bytes = new Uint8Array(Buffer.from(svg, 'utf8'))
    format = 'svg'
    await persistMedia({
      document: input.document,
      workspaceRootPath: input.workspaceRootPath,
      bytes,
      extension: 'svg'
    })
    input.document.warnings.push('当前公式已使用 SVG 回退；公式整体可缩放，但内部字符暂不可编辑。')
  } else if (input.element.type === 'svg') {
    bytes = new Uint8Array(Buffer.from(input.element.svg || '', 'utf8'))
    format = 'svg'
    await persistMedia({
      document: input.document,
      workspaceRootPath: input.workspaceRootPath,
      bytes,
      extension: 'svg'
    })
  } else {
    bytes = await resolveAssetBytes({
      rawPath: input.element.src || '',
      sourcePath: input.document.sourcePath,
      workspaceRootPath: input.workspaceRootPath
    })
    const extension = /^https?:\/\//i.test(input.element.src || '')
      ? 'png'
      : path.extname(input.element.src || '').replace('.', '') || 'bin'
    await persistMedia({
      document: input.document,
      workspaceRootPath: input.workspaceRootPath,
      bytes,
      extension
    })
  }
  const image = addSlideImage(input.slide, bytes, {
    ...bounds,
    format,
    fit:
      input.element.type === 'image'
        ? input.element.imageFit === 'contain'
          ? 'contain'
          : 'fill'
        : 'contain'
  })
  if (input.element.type === 'image' && input.element.imageFit === 'cover') {
    applyCoverCrop(image, bytes, input.element.bounds)
  }
  if (input.element.type === 'formula') {
    setShapeDescription(image, `ppt-latex:${input.element.latex || ''}`)
  } else if (input.element.type === 'image' && /^https?:\/\//i.test(input.element.src || '')) {
    setShapeDescription(image, `ppt-remote-image:${input.element.src || ''}`)
  }
}

const addCompiledSlide = async (input: {
  document: PptRuntimeDocument
  compiled: PptCompiledSlide
  workspaceRootPath: string
  position: 'before' | 'after'
  anchorSlideId?: string
}): Promise<SlideData> => {
  const slide = addBlankSlide(input.document.presentation)
  setSlideBackground(slide, normalizeHex(input.compiled.background))
  if (input.compiled.notes) setSlideNotes(slide, input.compiled.notes)
  for (const element of [...input.compiled.elements].sort((a, b) => a.zIndex - b.zIndex)) {
    await addCompiledElement({
      document: input.document,
      slide,
      compiled: input.compiled,
      element,
      workspaceRootPath: input.workspaceRootPath
    })
  }
  placeSlide(input.document.presentation, slide, input.position, input.anchorSlideId)
  input.document.warnings.push(...input.compiled.warnings)
  return slide
}

const placeSlide = (
  presentation: PresentationData,
  slide: SlideData,
  position: 'before' | 'after',
  anchorSlideId?: string
): number => {
  const slides = getSlides(presentation)
  const sourceIndex = slides.findIndex((item) => item === slide)
  if (sourceIndex < 0) throw new Error('找不到需要定位的页面')
  if (!anchorSlideId) {
    const targetIndex = position === 'before' ? 0 : slides.length - 1
    moveSlide(presentation, slide, targetIndex)
    return targetIndex
  }
  const anchorIndex = slides.findIndex((item) => slideIdOf(item) === anchorSlideId)
  if (anchorIndex < 0) throw new Error(`找不到 anchorSlideId=${anchorSlideId}`)
  const insertionIndex = position === 'before' ? anchorIndex : anchorIndex + 1
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

const readShapeDetails = (shape: SlideShapeData): JsonObject | undefined => {
  if (isTableShape(shape)) {
    return {
      rows: getTableCells(shape).map((row) => row.map((cell) => getTableCellText(cell)))
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
        const type = latex
          ? 'formula'
          : isTableShape(shape)
            ? 'table'
            : isChartShape(shape)
              ? 'chart'
              : getShapeKind(shape)
        return {
          elementId: elementIdOf(slide, shape),
          type,
          zIndex: getShapeZIndex(shape),
          bounds: boundsFromEmu(presentation, getShapeBoundsResolved(presentation, shape)),
          text: getShapeText(shape) || undefined,
          latex,
          style: readShapeStyle(shape),
          details: readShapeDetails(shape)
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
    throw new Error('fromSlideIndex 不能大于 toSlideIndex')
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
      if (index < 0) throw new Error(`找不到页面 slideId=${slideId}`)
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
  const { renderSlideToSvg } = await import('pptx-kit-preview/node')
  await fs.mkdir(input.previewDir, { recursive: true })
  const slides = getSlides(input.presentation)
  const output = new Map<string, PptDiffFrame & { hash: string }>()
  for (const slideId of input.slideIds) {
    const index = slides.findIndex((slide) => slideIdOf(slide) === slideId)
    if (index < 0) continue
    const svg = renderSlideToSvg(input.presentation, slides[index]!, { textLayout: 'svg' })
    const hash = hashBytes(svg)
    const svgPath = path.join(input.previewDir, `${input.prefix}-${hash.slice(0, 20)}.svg`)
    await fs.writeFile(svgPath, svg, 'utf8')
    output.set(slideId, { index: index + 1, svg: svgPath, hash })
  }
  return output
}

export const buildPptDiffManifest = (input: {
  before: Map<string, PptDiffFrame & { hash: string }>
  after: Map<string, PptDiffFrame & { hash: string }>
  operation: 'created' | 'updated'
  forceChangedSlideIds?: ReadonlySet<string>
}): PptDiffManifest => {
  const afterEntries: PptDiffSlide[] = [...input.after.entries()]
    .sort((a, b) => a[1].index - b[1].index)
    .map(([slideId, after]) => {
      const before = input.before.get(slideId)
      const changes: PptDiffSlide['changes'] = []
      if (!before) changes.push('added')
      else {
        if (
          before.hash !== after.hash ||
          (before.index === after.index && Boolean(input.forceChangedSlideIds?.has(slideId)))
        ) {
          changes.push('modified')
        }
        if (before.index !== after.index) changes.push('moved')
      }
      return {
        slideId,
        changed: changes.length > 0,
        changes,
        before: before ? { index: before.index, svg: before.svg } : undefined,
        after: { index: after.index, svg: after.svg }
      }
    })
  const deleted = [...input.before.entries()]
    .filter(([slideId]) => !input.after.has(slideId))
    .sort((a, b) => a[1].index - b[1].index)
  for (const [slideId, before] of deleted) {
    afterEntries.splice(Math.min(Math.max(0, before.index - 1), afterEntries.length), 0, {
      slideId,
      changed: true,
      changes: ['deleted'],
      before: { index: before.index, svg: before.svg },
      after: undefined
    })
  }
  return { version: 3, operation: input.operation, slides: afterEntries }
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
    rawPath: input.rawPath,
    sourcePath: input.document.sourcePath,
    workspaceRootPath: input.workspaceRootPath
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
  input.document.warnings.push('公式已使用 SVG 回退，公式整体可编辑，内部字符不可编辑。')
  return shape
}

const applyElementOperation = async (input: {
  operation: PptElementOperation
  document: PptRuntimeDocument
  slide: SlideData
  workspaceRootPath: string
}) => {
  const op = input.operation
  if (op.type === 'set_text') {
    setShapeText(findElement(input.document.presentation, input.slide, op.elementId), op.text)
    return
  }
  if (op.type === 'set_bounds') {
    setShapeBounds(
      findElement(input.document.presentation, input.slide, op.elementId),
      boundsToEmu(input.document.presentation, op.bounds)
    )
    return
  }
  if (op.type === 'set_style') {
    const shape = findElement(input.document.presentation, input.slide, op.elementId)
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
    if (!isTableShape(table)) throw new Error(`elementId 不是表格: ${op.elementId}`)
    for (const cell of op.cells) {
      setTableCellText(getTableCell(table, cell.rowIndex - 1, cell.columnIndex - 1), cell.text)
    }
    return
  }
  if (op.type === 'update_chart') {
    const shape = findElement(input.document.presentation, input.slide, op.elementId)
    const chart = getSlideCharts(input.slide).find(
      (item) => getShapeId(item.shape) === getShapeId(shape)
    )
    if (!chart) throw new Error(`elementId 不是图表: ${op.elementId}`)
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
      throw new Error(`elementId 不是公式: ${op.elementId}`)
    }
    const bounds = boundsFromEmu(
      input.document.presentation,
      getShapeBoundsResolved(input.document.presentation, oldShape)
    )
    if (!bounds) throw new Error(`公式缺少可编辑位置: ${op.elementId}`)
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
    return
  }

  const element = op.element
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
    addSlideTable(input.slide, { ...bounds, rows: element.rows })
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

export const createPptToolRuntime = (input: PptToolRuntime['input']): PptToolRuntime => {
  const documents = new Map<string, PptRuntimeDocument>()
  const workspaceRootPath = path.resolve(input.workspaceRootPath)

  const resolvePptPath = (rawPath: string): string => {
    const resolved = resolveWorkspacePath({
      rawPath,
      cwd: workspaceRootPath,
      rootPath: workspaceRootPath
    })
    if (!resolved || !resolved.toLowerCase().endsWith('.pptx')) {
      throw new Error('sourcePath 必须是当前工作区内的 .pptx 文件')
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
    if (!exists && !allowCreate) throw new Error(`pptx 文件不存在: ${rawPath}`)
    const beforeBytes = exists ? new Uint8Array(await fs.readFile(sourcePath)) : undefined
    const presentation = beforeBytes ? await loadPresentation(beforeBytes) : createPresentation()
    const document: PptRuntimeDocument = {
      changeId: randomUUID(),
      sourcePath,
      sourceName: path.basename(sourcePath),
      beforeBytes,
      lastPersistedBytes: beforeBytes ? new Uint8Array(beforeBytes) : undefined,
      presentation,
      dirty: false,
      changedSlideIds: new Set(),
      warnings: []
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
        throw new Error('fromPercent 不能大于 toPercent')
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
      sourcePath: args.sourcePath,
      slideCount: slides.length,
      slides: [...selected]
        .sort((left, right) => left - right)
        .map((index) => outlineItem(document.presentation, slides[index]!, index)),
      warnings: [...new Set(document.warnings)]
    }
  }

  const readSlides = async (rawArgs: unknown): Promise<Record<string, unknown>> => {
    const args = pptReadSlidesSchema.parse(rawArgs)
    const document = await loadDocument(args.sourcePath)
    const slides = getSlides(document.presentation)
    const indices = resolveSlideIndices(slides, args.ranges)
    return {
      sourcePath: args.sourcePath,
      slideCount: slides.length,
      slides: indices.map((index) =>
        slideReadback(document.presentation, slides[index]!, index, true)
      ),
      warnings: [...new Set(document.warnings)]
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
    const matches = allMatches.slice(0, 100)
    const warnings = [...new Set(document.warnings)]
    if (matches.length < allMatches.length) warnings.push('搜索命中过多，仅返回前 100 条。')
    return {
      sourcePath: args.sourcePath,
      totalMatchCount: allMatches.length,
      returnedMatchCount: matches.length,
      matches,
      warnings
    }
  }

  const render = async (rawArgs: unknown): Promise<Record<string, unknown>> => {
    const args = pptRenderSchema.parse(rawArgs)
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
    const width = 1920
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
      images,
      warnings: [...new Set(document.warnings)]
    }
  }

  const edit = async (rawArgs: unknown): Promise<Record<string, unknown>> => {
    const args = pptEditSchema.parse(rawArgs)
    const sourcePath = resolvePptPath(args.sourcePath)
    const create = !documents.has(sourcePath) && !(await fileExists(sourcePath))
    const document = await loadDocument(args.sourcePath, create)
    const presentationSnapshot = await savePresentation(document.presentation)
    const dirtyBeforeAction = document.dirty
    const changedSlideIdsBeforeAction = new Set(document.changedSlideIds)
    const warningsBeforeAction = [...document.warnings]
    try {
      const changedSlideIds: string[] = []
      let outlineAnchorIndex: number | undefined
      for (const action of args.actions) {
        try {
          if (action.type === 'insert_slide') {
            for (const [pageIndex, html] of [action.html].entries()) {
              let compiled: PptCompiledSlide
              try {
                compiled = await compilePptSlideHtml(html)
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                throw new Error(`第 ${pageIndex + 1} 个 HTML 页面失败：${message}`)
              }
              const slide = await addCompiledSlide({
                document,
                compiled,
                workspaceRootPath,
                position: action.position,
                anchorSlideId: action.anchorSlideId
              })
              changedSlideIds.push(slideIdOf(slide))
            }
          } else if (action.type === 'delete_slides') {
            const currentSlides = getSlides(document.presentation)
            outlineAnchorIndex = Math.min(
              ...action.slideIds.map((slideId) => {
                const index = currentSlides.findIndex((slide) => slideIdOf(slide) === slideId)
                if (index < 0) throw new Error(`找不到页面 slideId=${slideId}`)
                return index
              })
            )
            for (const slideId of action.slideIds) {
              const slide = findSlide(document.presentation, slideId)
              changedSlideIds.push(slideId)
              removeSlide(document.presentation, slide)
            }
          } else if (action.type === 'move_slide') {
            const slide = findSlide(document.presentation, action.slideId)
            if (action.anchorSlideId === action.slideId)
              throw new Error('move_slide 的 anchorSlideId 不能等于 slideId')
            const targetIndex = placeSlide(
              document.presentation,
              slide,
              action.position,
              action.anchorSlideId
            )
            changedSlideIds.push(action.slideId)
            outlineAnchorIndex = targetIndex
          } else if (action.type === 'duplicate_slide') {
            const source = findSlide(document.presentation, action.slideId)
            const duplicate = duplicateSlide(document.presentation, source)
            placeSlide(document.presentation, duplicate, action.position, action.anchorSlideId)
            changedSlideIds.push(slideIdOf(duplicate))
          } else if (action.type === 'replace_text') {
            const targetSlides = action.slideIds?.map((slideId) =>
              findSlide(document.presentation, slideId)
            )
            let replacements = 0
            if (targetSlides) {
              for (const slide of targetSlides) {
                for (const shape of getSlideShapes(slide)) {
                  const text = getShapeText(shape)
                  if (!text.includes(action.query)) continue
                  setShapeText(shape, text.split(action.query).join(action.replace))
                  replacements += 1
                  changedSlideIds.push(slideIdOf(slide))
                }
              }
            } else {
              const beforeText = new Map(
                getSlides(document.presentation).map((slide) => [
                  slideIdOf(slide),
                  getSlideText(slide)
                ])
              )
              replacements = replaceTextInPresentation(
                document.presentation,
                action.query,
                action.replace
              )
              if (replacements > 0) {
                getSlides(document.presentation).forEach((slide) => {
                  if (beforeText.get(slideIdOf(slide)) !== getSlideText(slide))
                    changedSlideIds.push(slideIdOf(slide))
                })
              }
            }
            if (replacements === 0) document.warnings.push(`未找到要替换的文字：${action.query}`)
          } else if (action.type === 'edit_elements') {
            const slide = findSlide(document.presentation, action.slideId)
            for (const operation of action.operations) {
              await applyElementOperation({ operation, document, slide, workspaceRootPath })
            }
            changedSlideIds.push(action.slideId)
          } else if (action.type === 'set_notes') {
            const slide = findSlide(document.presentation, action.slideId)
            setSlideNotes(slide, action.text)
            changedSlideIds.push(action.slideId)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`${action.type} 失败：${message}`)
        }
      }
      if (getSlides(document.presentation).length === 0) {
        throw new Error('PPT 最终必须至少保留一页')
      }
      const uniqueChanged = [...new Set(changedSlideIds)]
      if (uniqueChanged.length > 0) document.dirty = true
      uniqueChanged.forEach((slideId) => document.changedSlideIds.add(slideId))
      const slides = getSlides(document.presentation)
      const readbackSlides = uniqueChanged.flatMap((slideId) => {
        const index = slides.findIndex((slide) => slideIdOf(slide) === slideId)
        return index >= 0 ? [slideReadback(document.presentation, slides[index]!, index, true)] : []
      })
      const outlineWindow =
        outlineAnchorIndex === undefined || slides.length === 0
          ? []
          : slides
              .slice(
                Math.max(0, outlineAnchorIndex - 1),
                Math.min(slides.length, outlineAnchorIndex + 2)
              )
              .map((slide, offset) =>
                outlineItem(
                  document.presentation,
                  slide,
                  Math.max(0, outlineAnchorIndex - 1) + offset
                )
              )
      const postWriteReadback = definedObject({
        slides: readbackSlides.length > 0 ? readbackSlides : undefined,
        outlineWindow: outlineWindow.length > 0 ? outlineWindow : undefined
      })
      if (uniqueChanged.length > 0) {
        const issues = validatePresentation(document.presentation).filter(
          (issue) => issue.severity === 'error'
        )
        if (issues.length > 0) {
          throw new Error(
            `PPTX validation failed: ${issues.map((issue) => issue.message).join('; ')}`
          )
        }
        const afterBytes = await savePresentation(document.presentation)
        await replaceFileWithBytes(document.sourcePath, afterBytes)
        document.lastPersistedBytes = new Uint8Array(afterBytes)
      }
      return {
        sourcePath: args.sourcePath,
        slideCount: slides.length,
        changedSlideIds: uniqueChanged,
        postWriteReadback,
        warnings: [...new Set(document.warnings)]
      }
    } catch (error) {
      document.presentation = await loadPresentation(presentationSnapshot)
      document.dirty = dirtyBeforeAction
      document.changedSlideIds = changedSlideIdsBeforeAction
      document.warnings = warningsBeforeAction
      if (create) documents.delete(sourcePath)
      throw error
    }
  }

  const commitAll = async (): Promise<AiFileChangeRecord[]> => {
    const records: AiFileChangeRecord[] = []
    for (const document of documents.values()) {
      if (!document.dirty) continue
      const issues = validatePresentation(document.presentation).filter(
        (issue) => issue.severity === 'error'
      )
      if (issues.length > 0)
        throw new Error(`pptx 校验失败: ${issues.map((issue) => issue.message).join('; ')}`)
      const afterBytes = await savePresentation(document.presentation)
      const afterPresentation = await loadPresentation(afterBytes)
      const dirs = await ensureAssetDirectory(workspaceRootPath, document.changeId)
      const beforeExists = Boolean(document.beforeBytes)
      const beforePresentation = document.beforeBytes
        ? await loadPresentation(document.beforeBytes)
        : null
      const beforeSlides = beforePresentation ? getSlides(beforePresentation) : []
      const afterSlides = getSlides(afterPresentation)
      const beforeFrames = beforePresentation
        ? await renderPresentationSlides({
            presentation: beforePresentation,
            slideIds: beforeSlides.map(slideIdOf),
            previewDir: dirs.before,
            prefix: 'before'
          })
        : new Map<string, PptDiffFrame & { hash: string }>()
      const afterFrames = await renderPresentationSlides({
        presentation: afterPresentation,
        slideIds: afterSlides.map(slideIdOf),
        previewDir: dirs.after,
        prefix: 'after'
      })
      const manifest = buildPptDiffManifest({
        before: beforeFrames,
        after: afterFrames,
        operation: beforeExists ? 'updated' : 'created',
        forceChangedSlideIds: document.changedSlideIds
      })
      const changedSlides = manifest.slides.filter((slide) => slide.changed)
      await fs.writeFile(dirs.manifest, JSON.stringify(manifest, null, 2), 'utf8')
      let beforeSnapshotPath: string | undefined
      let beforeChecksum: string | undefined
      if (beforeExists && document.beforeBytes) {
        const snapshotRoot = path.join(
          workspaceRootPath,
          '.ncurator',
          'file-change-snapshots',
          input.runId
        )
        beforeSnapshotPath = path.join(snapshotRoot, `${document.changeId}-${document.sourceName}`)
        await fs.mkdir(snapshotRoot, { recursive: true })
        await fs.writeFile(beforeSnapshotPath, document.beforeBytes)
        beforeChecksum = hashBytes(document.beforeBytes)
      }
      const persistedBytes = document.lastPersistedBytes ?? new Uint8Array(afterBytes)
      const now = Date.now()
      const record: AiFileChangeRecord = {
        id: document.changeId,
        sessionId: input.sessionId,
        runId: input.runId,
        status: 'applied',
        capability: 'ppt',
        path: document.sourcePath,
        fileName: document.sourceName,
        operation: beforeExists ? 'updated' : 'created',
        changeCount: changedSlides.length,
        insertCount: changedSlides.filter((slide) => Boolean(slide.after)).length,
        deleteCount: changedSlides.filter((slide) => Boolean(slide.before)).length,
        beforeSnapshotPath,
        beforeChecksum,
        afterChecksum: hashBytes(persistedBytes),
        previewPath: dirs.manifest,
        createdAt: now,
        updatedAt: now
      }
      await input.ctx.saveFileChangeRecord(record)
      document.beforeBytes = new Uint8Array(afterBytes)
      document.lastPersistedBytes = new Uint8Array(afterBytes)
      document.dirty = false
      document.changedSlideIds.clear()
      records.push(record)
    }
    return records
  }

  return { input, documents, outline, readSlides, search, render, edit, commitAll }
}

export const toPptToolFailure = (sourcePath: string, error: unknown): JsonObject => ({
  ok: false,
  sourcePath,
  warnings: [],
  error: error instanceof Error ? error.message : String(error)
})
