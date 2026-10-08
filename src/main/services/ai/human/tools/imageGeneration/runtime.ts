import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Resvg } from '@resvg/resvg-js'
import { DOMParser } from '@xmldom/xmldom'
import type { WorkspaceCapabilityBuildInput } from '../types'
import { isPathInsideRoot } from '../utils/pathBoundary'
import { resolveSafeTextFilePath, withTextFileMutationQueue } from '../textFile/textFileUtils'
import type { ImageGenerateInput, ImageGenerateOutput } from './toolSchemas'

const MAX_SVG_BYTES = 1_048_576
const MAX_IMAGE_EDGE = 8_192
const MAX_IMAGE_PIXELS = 33_554_432
const JPEG_QUALITY = 90
const WEBP_QUALITY = 90
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'animate',
  'animatemotion',
  'animatetransform',
  'set'
])

const checksum = (content: Buffer): string => createHash('sha256').update(content).digest('hex')

const parseNumericLength = (value: string): number | undefined => {
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/iu)
  if (!match) return undefined
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const assertSafeReference = (value: string): void => {
  const normalized = value.trim()
  if (!normalized || normalized.startsWith('#') || /^data:image\//iu.test(normalized)) return
  throw new Error('SVG 包含外部资源引用，禁止加载外部内容。')
}

const validateSvg = (svg: string): void => {
  if (Buffer.byteLength(svg, 'utf8') > MAX_SVG_BYTES)
    throw new Error('SVG 内容过大，超出大小上限。')
  if (/<!DOCTYPE|<!ENTITY/iu.test(svg)) {
    throw new Error('SVG 包含被禁止的文档声明（如 DOCTYPE/ENTITY）。')
  }

  const parseErrors: string[] = []
  let document: Document
  try {
    document = new DOMParser({
      errorHandler: {
        warning: () => undefined,
        error: (message) => parseErrors.push(String(message)),
        fatalError: (message) => parseErrors.push(String(message))
      }
    }).parseFromString(svg, 'image/svg+xml')
  } catch {
    throw new Error('SVG 内容无效。')
  }
  if (parseErrors.length > 0 || document.documentElement?.localName?.toLowerCase() !== 'svg') {
    throw new Error('SVG 内容无效。')
  }

  const root = document.documentElement
  const declaredWidth = parseNumericLength(root.getAttribute('width') || '')
  const declaredHeight = parseNumericLength(root.getAttribute('height') || '')
  const viewBox = (root.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/u)
    .map(Number)
  const viewBoxWidth = viewBox.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2] : undefined
  const viewBoxHeight = viewBox.length === 4 && Number.isFinite(viewBox[3]) ? viewBox[3] : undefined
  const width = declaredWidth || viewBoxWidth
  const height = declaredHeight || viewBoxHeight
  if (
    width &&
    height &&
    (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS)
  ) {
    throw new Error('SVG 输出尺寸过大，超出限制。')
  }

  const visit = (node: Node): void => {
    if (node.nodeType === 1) {
      const element = node as Element
      if (FORBIDDEN_ELEMENTS.has(element.localName.toLowerCase())) {
        throw new Error(`SVG 包含被禁止的元素：${element.localName}。`)
      }
      if (element.localName.toLowerCase() === 'style') {
        const css = element.textContent || ''
        if (/@import\b/iu.test(css)) throw new Error('SVG 包含被禁止的 CSS @import。')
        for (const match of css.matchAll(/url\(([^)]+)\)/giu)) {
          assertSafeReference(match[1].replace(/^['"]|['"]$/gu, ''))
        }
      }
      for (let index = 0; index < element.attributes.length; index += 1) {
        const attribute = element.attributes.item(index)
        if (!attribute) continue
        const name = attribute.name.toLowerCase()
        const value = attribute.value
        if (name.startsWith('on')) throw new Error(`SVG 包含被禁止的属性：${name}。`)
        if (name === 'href' || name === 'xlink:href') assertSafeReference(value)
        for (const match of value.matchAll(/url\(([^)]+)\)/giu)) {
          assertSafeReference(match[1].replace(/^['"]|['"]$/gu, ''))
        }
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child)
  }
  visit(root)
}

const renderImage = async (input: ImageGenerateInput): Promise<Buffer> => {
  validateSvg(input.svg)
  let rendered: ReturnType<Resvg['render']>
  try {
    rendered = new Resvg(input.svg).render()
  } catch {
    throw new Error('SVG 内容无效。')
  }
  if (
    rendered.width <= 0 ||
    rendered.height <= 0 ||
    rendered.width > MAX_IMAGE_EDGE ||
    rendered.height > MAX_IMAGE_EDGE ||
    rendered.width * rendered.height > MAX_IMAGE_PIXELS
  ) {
    throw new Error('SVG 输出尺寸过大，超出限制。')
  }
  const png = Buffer.from(rendered.asPng())
  const extension = path.extname(input.outputPath).toLowerCase()
  if (extension === '.png') return png

  const image = await loadImage(png)
  const canvas = createCanvas(rendered.width, rendered.height)
  const context = canvas.getContext('2d')
  if (extension === '.jpg' || extension === '.jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, rendered.width, rendered.height)
    context.drawImage(image, 0, 0)
    return await canvas.encode('jpeg', JPEG_QUALITY)
  }
  context.drawImage(image, 0, 0)
  return await canvas.encode('webp', WEBP_QUALITY)
}

const atomicReplaceFile = async (input: {
  outputPath: string
  content: Buffer
  mode: number
  operationId: string
}): Promise<void> => {
  const tempPath = path.join(
    path.dirname(input.outputPath),
    `.${path.basename(input.outputPath)}.${input.operationId}.tmp`
  )
  try {
    await fs.writeFile(tempPath, input.content, { flag: 'wx', mode: input.mode })
    await fs.chmod(tempPath, input.mode)
    await fs.rename(tempPath, input.outputPath)
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export const generateImage = async (
  buildInput: WorkspaceCapabilityBuildInput,
  args: ImageGenerateInput
): Promise<ImageGenerateOutput> => {
  const outputPath = await resolveSafeTextFilePath({
    sourcePath: args.outputPath,
    allowMissing: true
  })
  const shouldTrackChange = isPathInsideRoot(outputPath, buildInput.workspaceRootPath)
  const outputBuffer = await renderImage(args)

  return await withTextFileMutationQueue(outputPath, async () => {
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await resolveSafeTextFilePath({
      sourcePath: args.outputPath,
      allowMissing: true
    })

    const operationId = randomUUID()
    let beforeBuffer: Buffer | undefined
    let beforeMode = 0o644
    try {
      const stats = await fs.lstat(outputPath)
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(`无法写入 ${args.outputPath}：目标不是普通文件。`)
      }
      beforeMode = stats.mode
      beforeBuffer = await fs.readFile(outputPath)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }

    if (beforeBuffer?.equals(outputBuffer)) return { outputPath: args.outputPath }

    if (!shouldTrackChange) {
      await atomicReplaceFile({ outputPath, content: outputBuffer, mode: beforeMode, operationId })
      if (!(await fs.readFile(outputPath)).equals(outputBuffer))
        throw new Error('图片保存校验不一致，文件已经写入，请重新读取确认。')
      return { outputPath: args.outputPath }
    }
    await buildInput.ctx.writeFileChange({
      sourcePath: outputPath,
      buffer: outputBuffer,
      capability: 'image',
      expectedChecksum: beforeBuffer ? checksum(beforeBuffer) : undefined
    })

    return { outputPath: args.outputPath }
  })
}
