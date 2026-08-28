import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { parentPort } from 'node:worker_threads'
import { createCanvas } from '@napi-rs/canvas'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api'
import { ensureWorkspaceAssetBucket } from '../../assets/WorkspaceAssetService'
import { buildPdfPageText, normalizePdfText } from '../textNormalizer'
import type {
  PdfDocumentMetadata,
  PdfOutlineItem,
  PdfPageReadResult,
  PdfSearchMatch
} from '../types'
import type { PdfWorkerRequest, PdfWorkerResponse } from './types'

type PdfSnapshot = {
  docId: string
  sourcePath: string
  document: PDFDocumentProxy
  pageCount: number
  pageByNumber: Map<number, PDFPageProxy>
  pageTextByNumber: Map<number, PdfPageReadResult>
}

const runSessions = new Map<string, Map<string, PdfSnapshot>>()

const getRunSession = (runId: string, create = false): Map<string, PdfSnapshot> | undefined => {
  const existing = runSessions.get(runId)
  if (existing || !create) return existing
  const next = new Map<string, PdfSnapshot>()
  runSessions.set(runId, next)
  return next
}

const getSnapshot = (runId: string, docId: string): PdfSnapshot => {
  const snapshot = getRunSession(runId)?.get(docId)
  if (!snapshot) throw new Error(`pdf session not found: ${docId}`)
  return snapshot
}

const readInfoString = (info: Record<string, unknown>, key: string): string | undefined => {
  const value = info[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const buildMetadata = (infoValue: unknown): PdfDocumentMetadata => {
  const info =
    infoValue && typeof infoValue === 'object' ? (infoValue as Record<string, unknown>) : {}
  return {
    title: readInfoString(info, 'Title'),
    author: readInfoString(info, 'Author'),
    subject: readInfoString(info, 'Subject'),
    keywords: readInfoString(info, 'Keywords'),
    creator: readInfoString(info, 'Creator'),
    producer: readInfoString(info, 'Producer'),
    creationDate: readInfoString(info, 'CreationDate'),
    modificationDate: readInfoString(info, 'ModDate')
  }
}

const resolveOutlinePageNumber = async (
  document: PDFDocumentProxy,
  destination: string | unknown[] | null | undefined
): Promise<number | undefined> => {
  if (!destination) return undefined
  const resolvedDestination =
    typeof destination === 'string' ? await document.getDestination(destination) : destination
  if (!Array.isArray(resolvedDestination) || !resolvedDestination[0]) return undefined
  const first = resolvedDestination[0]
  if (typeof first === 'number') return first + 1
  if (typeof first !== 'object') return undefined
  try {
    return (
      (await document.getPageIndex(first as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
    )
  } catch {
    return undefined
  }
}

const buildOutline = async (document: PDFDocumentProxy): Promise<PdfOutlineItem[]> => {
  const rootItems = (await document.getOutline()) || []
  const output: PdfOutlineItem[] = []
  const visit = async (items: typeof rootItems, depth: number): Promise<void> => {
    for (const item of items) {
      if (output.length >= 500) return
      output.push({
        title: normalizePdfText(String(item.title || '')) || '未命名书签',
        pageNumber: await resolveOutlinePageNumber(document, item.dest),
        depth
      })
      if (Array.isArray(item.items) && item.items.length > 0) {
        await visit(item.items, depth + 1)
      }
    }
  }
  await visit(rootItems, 1)
  return output
}

const getPage = async (snapshot: PdfSnapshot, pageNumber: number): Promise<PDFPageProxy> => {
  const cached = snapshot.pageByNumber.get(pageNumber)
  if (cached) return cached
  const page = await snapshot.document.getPage(pageNumber)
  snapshot.pageByNumber.set(pageNumber, page)
  return page
}

const countPageImages = async (page: PDFPageProxy): Promise<number> => {
  try {
    const operators = await page.getOperatorList()
    const imageOps = new Set<number>([
      pdfjs.OPS.paintImageXObject,
      pdfjs.OPS.paintInlineImageXObject,
      pdfjs.OPS.paintImageMaskXObject
    ])
    return operators.fnArray.filter((operator) => imageOps.has(operator)).length
  } catch {
    return 0
  }
}

const readPage = async (snapshot: PdfSnapshot, pageNumber: number): Promise<PdfPageReadResult> => {
  const cached = snapshot.pageTextByNumber.get(pageNumber)
  if (cached) return cached
  const page = await getPage(snapshot, pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const normalized = buildPdfPageText(content.items)
  const result: PdfPageReadResult = {
    pageNumber,
    text: normalized.text,
    charCount: normalized.text.length,
    textStatus: normalized.text ? (normalized.suspicious ? 'suspicious' : 'available') : 'empty',
    imageCount: await countPageImages(page),
    width: Math.round(viewport.width),
    height: Math.round(viewport.height),
    rotation: viewport.rotation
  }
  snapshot.pageTextByNumber.set(pageNumber, result)
  return result
}

const validatePageNumbers = (snapshot: PdfSnapshot, pageNumbers: number[]): void => {
  for (const pageNumber of pageNumbers) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > snapshot.pageCount) {
      throw new Error(
        `pageNumber 超出范围：${String(pageNumber)}，有效范围是 1-${String(snapshot.pageCount)}`
      )
    }
  }
}

const buildSnippet = (text: string, start: number, end: number): string => {
  const from = Math.max(0, start - 80)
  const to = Math.min(text.length, end + 80)
  return text.slice(from, to).replace(/\s+/gu, ' ').trim()
}

const findLiteralMatches = (text: string, query: string, pageNumber: number): PdfSearchMatch[] => {
  const matches: PdfSearchMatch[] = []
  const haystack = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  let fromIndex = 0
  while (needle && fromIndex <= haystack.length) {
    const start = haystack.indexOf(needle, fromIndex)
    if (start < 0) break
    const end = start + needle.length
    matches.push({
      pageNumber,
      matchedText: text.slice(start, end),
      snippet: buildSnippet(text, start, end),
      start,
      end
    })
    fromIndex = Math.max(end, start + 1)
  }
  return matches
}

const findRegexMatches = (text: string, query: string, pageNumber: number): PdfSearchMatch[] => {
  const expression = new RegExp(query, 'giu')
  const matches: PdfSearchMatch[] = []
  for (const match of text.matchAll(expression)) {
    const start = match.index ?? 0
    const matchedText = match[0] || ''
    if (!matchedText) continue
    const end = start + matchedText.length
    matches.push({
      pageNumber,
      matchedText,
      snippet: buildSnippet(text, start, end),
      start,
      end
    })
  }
  return matches
}

const renderPage = async (input: {
  snapshot: PdfSnapshot
  pageNumber: number
  directoryPath: string
}) => {
  const page = await getPage(input.snapshot, input.pageNumber)
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = Math.min(2, 3000 / Math.max(baseViewport.width, baseViewport.height))
  const viewport = page.getViewport({ scale })
  const width = Math.max(1, Math.ceil(viewport.width))
  const height = Math.max(1, Math.ceil(viewport.height))
  const canvas = createCanvas(width, height)
  const canvasContext = canvas.getContext('2d')
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
    viewport
  }).promise
  const bytes = canvas.toBuffer('image/png')
  const targetPath = `${input.directoryPath}/${createHash('sha256').update(bytes).digest('hex')}.png`
  try {
    await fs.writeFile(targetPath, bytes, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return {
    pageNumber: input.pageNumber,
    path: targetPath,
    mimeType: 'image/png' as const,
    width,
    height
  }
}

const toPdfFailure = (requestId: string, error: unknown): PdfWorkerResponse => {
  const message = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : ''
  if (name === 'PasswordException' || /password/iu.test(message)) {
    return { requestId, ok: false, code: 'password_required', error: 'PDF 需要密码才能读取' }
  }
  if (name === 'InvalidPDFException' || /invalid pdf/iu.test(message)) {
    return { requestId, ok: false, code: 'invalid_pdf', error: 'PDF 文件无效或已损坏' }
  }
  if (/pageNumber 超出范围|pageNumbers|query|regex|regular expression/iu.test(message)) {
    return { requestId, ok: false, code: 'invalid_input', error: message }
  }
  return { requestId, ok: false, code: 'failed', error: message }
}

export const handlePdfWorkerRequest = async (
  request: PdfWorkerRequest
): Promise<PdfWorkerResponse> => {
  try {
    if (request.action === 'open') {
      const bytes = new Uint8Array(await fs.readFile(request.payload.sourcePath))
      const document = await pdfjs.getDocument({ data: bytes }).promise
      const docId = randomUUID()
      const snapshot: PdfSnapshot = {
        docId,
        sourcePath: request.payload.sourcePath,
        document,
        pageCount: document.numPages,
        pageByNumber: new Map(),
        pageTextByNumber: new Map()
      }
      getRunSession(request.runId, true)?.set(docId, snapshot)
      const metadata = await document.getMetadata().catch(() => ({ info: {} }))
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'open',
          docId,
          sourcePath: snapshot.sourcePath,
          pageCount: snapshot.pageCount,
          metadata: buildMetadata(metadata.info),
          outline: await buildOutline(document),
          encrypted: false
        }
      }
    }

    if (request.action === 'read_pages') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      validatePageNumbers(snapshot, request.payload.pageNumbers)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'read_pages',
          pages: await Promise.all(
            request.payload.pageNumbers.map((page) => readPage(snapshot, page))
          )
        }
      }
    }

    if (request.action === 'search') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      validatePageNumbers(snapshot, [request.payload.fromPage, request.payload.toPage])
      if (request.payload.fromPage > request.payload.toPage) {
        throw new Error('fromPage 不能大于 toPage')
      }
      if (request.payload.mode === 'regex') void new RegExp(request.payload.query, 'giu')
      const allMatches: PdfSearchMatch[] = []
      let pagesWithNoTextCount = 0
      let pagesWithSuspiciousTextCount = 0
      for (
        let pageNumber = request.payload.fromPage;
        pageNumber <= request.payload.toPage;
        pageNumber += 1
      ) {
        const page = await readPage(snapshot, pageNumber)
        if (page.textStatus === 'empty') pagesWithNoTextCount += 1
        if (page.textStatus === 'suspicious') pagesWithSuspiciousTextCount += 1
        allMatches.push(
          ...(request.payload.mode === 'regex'
            ? findRegexMatches(page.text, request.payload.query, pageNumber)
            : findLiteralMatches(page.text, request.payload.query, pageNumber))
        )
      }
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'search',
          totalMatchCount: allMatches.length,
          matches: allMatches.slice(0, request.payload.maxMatches),
          pagesWithNoTextCount,
          pagesWithSuspiciousTextCount
        }
      }
    }

    if (request.action === 'materialize_pages') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      validatePageNumbers(snapshot, request.payload.pageNumbers)
      const assetBucketId = `pdf_read_pages-${randomUUID()}`
      const directoryPath = await ensureWorkspaceAssetBucket(
        request.payload.workspaceRootPath,
        assetBucketId
      )
      const images: Array<Awaited<ReturnType<typeof renderPage>>> = []
      for (const pageNumber of request.payload.pageNumbers) {
        images.push(
          await renderPage({
            snapshot,
            pageNumber,
            directoryPath
          })
        )
      }
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'materialize_pages',
          assetBucketId,
          images
        }
      }
    }

    const released = getRunSession(request.runId)?.size || 0
    const session = getRunSession(request.runId)
    if (session) {
      await Promise.all([...session.values()].map((snapshot) => snapshot.document.destroy()))
    }
    runSessions.delete(request.runId)
    return {
      requestId: request.requestId,
      ok: true,
      payload: { action: 'release_run', releasedDocCount: released }
    }
  } catch (error) {
    return toPdfFailure(request.requestId, error)
  }
}

const workerParentPort = parentPort
if (workerParentPort) {
  workerParentPort.on('message', (request: PdfWorkerRequest) => {
    void handlePdfWorkerRequest(request).then((response) => workerParentPort.postMessage(response))
  })
}
