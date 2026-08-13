import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Resvg } from '@resvg/resvg-js'
import { DOMParser } from '@xmldom/xmldom'
import type { AiFileChangeOperation, AiFileChangeRecord } from '../../../../../../shared/types'
import { emitFileArtifactEvent } from '../../../events/fileArtifacts'
import type { WorkspaceCapabilityBuildInput } from '../types'
import { isPathInsideRoot } from '../terminal/commandPolicy'
import { resolveSafeTextFilePath, withTextFileMutationQueue } from '../textFile/textFileUtils'
import type { ImageGenerateInput, ImageGenerateOutput } from './schemas'

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
  throw new Error('SVG contains an external resource reference.')
}

const validateSvg = (svg: string): void => {
  if (Buffer.byteLength(svg, 'utf8') > MAX_SVG_BYTES) throw new Error('SVG content is too large.')
  if (/<!DOCTYPE|<!ENTITY/iu.test(svg)) {
    throw new Error('SVG contains a forbidden document declaration.')
  }

  const parseErrors: string[] = []
  const document = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message) => parseErrors.push(String(message)),
      fatalError: (message) => parseErrors.push(String(message))
    }
  }).parseFromString(svg, 'image/svg+xml')
  if (parseErrors.length > 0 || document.documentElement?.localName?.toLowerCase() !== 'svg') {
    throw new Error('SVG content is invalid.')
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
    throw new Error('SVG output dimensions are too large.')
  }

  const visit = (node: Node): void => {
    if (node.nodeType === 1) {
      const element = node as Element
      if (FORBIDDEN_ELEMENTS.has(element.localName.toLowerCase())) {
        throw new Error(`SVG contains a forbidden element: ${element.localName}.`)
      }
      if (element.localName.toLowerCase() === 'style') {
        const css = element.textContent || ''
        if (/@import\b/iu.test(css)) throw new Error('SVG contains a forbidden CSS import.')
        for (const match of css.matchAll(/url\(([^)]+)\)/giu)) {
          assertSafeReference(match[1].replace(/^['"]|['"]$/gu, ''))
        }
      }
      for (let index = 0; index < element.attributes.length; index += 1) {
        const attribute = element.attributes.item(index)
        if (!attribute) continue
        const name = attribute.name.toLowerCase()
        const value = attribute.value
        if (name.startsWith('on')) throw new Error(`SVG contains a forbidden attribute: ${name}.`)
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
  const rendered = new Resvg(input.svg).render()
  if (
    rendered.width <= 0 ||
    rendered.height <= 0 ||
    rendered.width > MAX_IMAGE_EDGE ||
    rendered.height > MAX_IMAGE_EDGE ||
    rendered.width * rendered.height > MAX_IMAGE_PIXELS
  ) {
    throw new Error('SVG output dimensions are too large.')
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
    workspaceRootPath: buildInput.workspaceRootPath,
    allowMissing: true
  })
  const outputBuffer = await renderImage(args)

  return await withTextFileMutationQueue(outputPath, async () => {
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await resolveSafeTextFilePath({
      sourcePath: args.outputPath,
      workspaceRootPath: buildInput.workspaceRootPath,
      allowMissing: true
    })

    const existingRecord = (await buildInput.ctx.listFileChangeRecords({ runId: buildInput.runId }))
      .filter(
        (record) =>
          record.capability === 'image' && record.path === outputPath && record.status === 'applied'
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    const operationId = existingRecord?.id || randomUUID()
    let beforeBuffer: Buffer | undefined
    let beforeMode = 0o644
    try {
      const stats = await fs.lstat(outputPath)
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(`Cannot write ${args.outputPath}: target is not a regular file.`)
      }
      beforeMode = stats.mode
      beforeBuffer = await fs.readFile(outputPath)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }

    if (beforeBuffer?.equals(outputBuffer)) return { outputPath: args.outputPath }

    const operation: AiFileChangeOperation =
      existingRecord?.operation || (beforeBuffer ? 'updated' : 'created')
    if (!isPathInsideRoot(outputPath, buildInput.workspaceRootPath)) {
      if (beforeBuffer) {
        const currentBuffer = await fs.readFile(outputPath)
        if (!currentBuffer.equals(beforeBuffer)) {
          throw new Error(`Cannot write ${args.outputPath}: the file changed during the operation.`)
        }
        await atomicReplaceFile({
          outputPath,
          content: outputBuffer,
          mode: beforeMode,
          operationId
        })
      } else {
        await fs.writeFile(outputPath, outputBuffer, { flag: 'wx', mode: 0o644 })
      }
      return { outputPath: args.outputPath }
    }
    const artifactRoot = path.join(
      buildInput.workspaceRootPath,
      '.ncurator',
      'file-changes',
      buildInput.runId
    )
    let beforeSnapshotPath = beforeBuffer
      ? path.join(artifactRoot, `${operationId}.before`)
      : undefined
    let beforeChecksum = beforeBuffer ? checksum(beforeBuffer) : undefined
    if (existingRecord?.operation === 'created') {
      beforeSnapshotPath = undefined
      beforeChecksum = undefined
    } else if (existingRecord) {
      if (!existingRecord.beforeSnapshotPath) {
        throw new Error(`Cannot update ${args.outputPath}: the original snapshot is missing.`)
      }
      beforeSnapshotPath = existingRecord.beforeSnapshotPath
      beforeChecksum = existingRecord.beforeChecksum
    }

    let targetWritten = false
    try {
      await fs.mkdir(artifactRoot, { recursive: true })
      if (!existingRecord && beforeBuffer && beforeSnapshotPath) {
        await fs.writeFile(beforeSnapshotPath, beforeBuffer)
      }
      if (beforeBuffer) {
        const currentBuffer = await fs.readFile(outputPath)
        if (!currentBuffer.equals(beforeBuffer)) {
          throw new Error(`Cannot write ${args.outputPath}: the file changed during the operation.`)
        }
        await atomicReplaceFile({
          outputPath,
          content: outputBuffer,
          mode: beforeMode,
          operationId
        })
      } else {
        await fs.writeFile(outputPath, outputBuffer, { flag: 'wx', mode: 0o644 })
      }
      targetWritten = true

      const now = Date.now()
      const record: AiFileChangeRecord = {
        id: operationId,
        sessionId: buildInput.sessionId,
        runId: buildInput.runId,
        status: 'applied',
        capability: 'image',
        path: outputPath,
        fileName: path.basename(outputPath),
        operation,
        source: 'image_tool',
        beforePath: operation === 'updated' ? outputPath : undefined,
        afterPath: outputPath,
        changeCount: (existingRecord?.changeCount || 0) + 1,
        insertCount: 0,
        deleteCount: 0,
        beforeSnapshotPath,
        beforeChecksum,
        afterChecksum: checksum(outputBuffer),
        createdAt: existingRecord?.createdAt || now,
        updatedAt: now
      }
      await buildInput.ctx.saveFileChangeRecord(record)
      emitFileArtifactEvent({
        ctx: buildInput.ctx,
        runId: buildInput.runId,
        taskId: buildInput.taskId,
        capability: 'image',
        artifactPath: outputPath,
        operation,
        applyId: operationId,
        changeCount: record.changeCount,
        insertCount: record.insertCount,
        deleteCount: record.deleteCount
      })
      return { outputPath: args.outputPath }
    } catch (error) {
      if (targetWritten) {
        if (beforeBuffer) {
          await atomicReplaceFile({
            outputPath,
            content: beforeBuffer,
            mode: beforeMode,
            operationId: `${operationId}.rollback`
          }).catch(() => undefined)
        } else {
          await fs.rm(outputPath, { force: true }).catch(() => undefined)
        }
      }
      if (!existingRecord && beforeSnapshotPath) {
        await fs.rm(beforeSnapshotPath, { force: true }).catch(() => undefined)
      }
      throw error
    }
  })
}
