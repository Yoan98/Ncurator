import { unpackMediaPath } from '../MediaProcess'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Resvg } from '@resvg/resvg-js'
import { DOMParser } from '@xmldom/xmldom'

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

const parseNumericLength = (value: string): number | undefined => {
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/iu)
  if (!match) return undefined
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

const assertSafeReference = (value: string): void => {
  const normalized = value.trim()
  if (!normalized || normalized.startsWith('#') || /^data:image\//iu.test(normalized)) return
  throw new Error('The SVG references external resources. External content is not allowed.')
}

const validateSvg = (svg: string): void => {
  if (Buffer.byteLength(svg, 'utf8') > MAX_SVG_BYTES)
    throw new Error('The SVG content exceeds the size limit.')
  if (/<!DOCTYPE|<!ENTITY/iu.test(svg)) {
    throw new Error(
      'The SVG contains a prohibited document declaration, such as DOCTYPE or ENTITY.'
    )
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
    throw new Error('The SVG content is invalid.')
  }
  if (parseErrors.length > 0 || document.documentElement?.localName?.toLowerCase() !== 'svg') {
    throw new Error('The SVG content is invalid.')
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
    throw new Error('The SVG output dimensions exceed the size limit.')
  }

  const visit = (node: Node): void => {
    if (node.nodeType === 1) {
      const element = node as Element
      if (FORBIDDEN_ELEMENTS.has(element.localName.toLowerCase())) {
        throw new Error(`The SVG contains a prohibited element: ${element.localName}.`)
      }
      if (element.localName.toLowerCase() === 'style') {
        const css = element.textContent || ''
        if (/@import\b/iu.test(css)) throw new Error('The SVG contains a prohibited CSS @import.')
        for (const match of css.matchAll(/url\(([^)]+)\)/giu)) {
          assertSafeReference(match[1].replace(/^['"]|['"]$/gu, ''))
        }
      }
      for (let index = 0; index < element.attributes.length; index += 1) {
        const attribute = element.attributes.item(index)
        if (!attribute) continue
        const name = attribute.name.toLowerCase()
        const value = attribute.value
        if (name.startsWith('on'))
          throw new Error(`The SVG contains a prohibited attribute: ${name}.`)
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

export const renderSvgImage = async (input: {
  svg: string
  outputPath: string
  fontPath: string
}): Promise<Buffer> => {
  validateSvg(input.svg)
  let rendered: ReturnType<Resvg['render']>
  try {
    rendered = new Resvg(input.svg, {
      font: {
        fontFiles: [unpackMediaPath(input.fontPath)],
        loadSystemFonts: false,
        defaultFontFamily: 'Ncurator Scene Sans'
      }
    }).render()
  } catch {
    throw new Error('The SVG content is invalid.')
  }
  if (
    rendered.width <= 0 ||
    rendered.height <= 0 ||
    rendered.width > MAX_IMAGE_EDGE ||
    rendered.height > MAX_IMAGE_EDGE ||
    rendered.width * rendered.height > MAX_IMAGE_PIXELS
  ) {
    throw new Error('The SVG output dimensions exceed the size limit.')
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
