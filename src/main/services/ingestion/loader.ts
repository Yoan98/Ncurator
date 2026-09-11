import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { Document } from '@langchain/core/documents'
import fs from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import JSZip from 'jszip'
import { extractLegacyDocBody } from '../ai/human/tools/docx/utils/legacyDocReader'
import {
  SPLITTER_BIG_CHUNK_SETTING,
  SPLITTER_MINI_CHUNK_SIZE,
  WEB_INGEST_MAX_CHARS,
  WEB_INGEST_TIMEOUT_MS
} from '../../utils/constant'

export const SUPPORTED_LOCAL_FILE_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.md',
  '.markdown',
  '.txt',
  '.xlsx',
  '.xlsm',
  '.xltx',
  '.xltm'
] as const

const SPREADSHEET_EXTENSION_SET = new Set<string>(['.xlsx', '.xlsm', '.xltx', '.xltm'])

export const isSpreadsheetFilePath = (filePath: string): boolean =>
  SPREADSHEET_EXTENSION_SET.has(path.extname(filePath).toLowerCase())

const SUPPORTED_LOCAL_FILE_EXTENSION_SET = new Set<string>(SUPPORTED_LOCAL_FILE_EXTENSIONS)
const SUPPORTED_TEXT_FILE_EXTENSION_SET = new Set<string>(['.md', '.markdown', '.txt'])

const decodeXmlEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")

const parseSpreadsheetSheetNames = (workbookXml: string): string[] => {
  const sheetNames: string[] = []
  const pattern = /<sheet\b[^>]*\bname="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(workbookXml)) !== null) {
    sheetNames.push(decodeXmlEntities(match[1]))
  }
  return sheetNames
}

const parseSpreadsheetTitle = (coreXml: string): string | undefined => {
  const match = coreXml.match(/<[^>]*:title\b[^>]*>([\s\S]*?)<\/[^>]*:title>/)
  const title = match ? decodeXmlEntities(match[1].trim()) : undefined
  return title || undefined
}

const extractSpreadsheetMetadata = async (
  buffer: Buffer
): Promise<{
  title?: string
  sheetNames: string[]
}> => {
  const zip = await JSZip.loadAsync(buffer)
  const workbookEntry = zip.file('xl/workbook.xml')
  if (!workbookEntry) {
    throw new Error('Invalid spreadsheet: missing xl/workbook.xml')
  }
  const sheetNames = parseSpreadsheetSheetNames(await workbookEntry.async('string'))
  const coreEntry = zip.file('docProps/core.xml')
  const title = coreEntry ? parseSpreadsheetTitle(await coreEntry.async('string')) : undefined
  return { title, sheetNames }
}

export const isSupportedLocalFilePath = (filePath: string): boolean =>
  SUPPORTED_LOCAL_FILE_EXTENSION_SET.has(path.extname(filePath).toLowerCase())

export const isSupportedTextFilePath = (filePath: string): boolean =>
  SUPPORTED_TEXT_FILE_EXTENSION_SET.has(path.extname(filePath).toLowerCase())

export type ProcessFileResult = {
  bigSplitDocs: Document[]
  miniSplitDocs: Document[]
  anchorText?: string
  metadataOnly?: boolean
}

export class IngestionService {
  private static instance: IngestionService

  private constructor() {}

  public static getInstance(): IngestionService {
    if (!IngestionService.instance) {
      IngestionService.instance = new IngestionService()
    }
    return IngestionService.instance
  }

  public async loadFile(filePath: string): Promise<Document[]> {
    let loader
    const fileExt = path.extname(filePath).toLowerCase()
    if (fileExt === '.pdf') {
      loader = new PDFLoader(filePath)
    } else if (fileExt === '.doc') {
      return await this.loadLegacyDocFile(filePath, fileExt)
    } else if (fileExt === '.docx') {
      loader = new DocxLoader(filePath)
    } else if (isSpreadsheetFilePath(filePath)) {
      return await this.loadSpreadsheetMetadataFile(filePath, fileExt)
    } else if (isSupportedTextFilePath(filePath)) {
      return await this.loadTextFile(filePath, fileExt)
    } else {
      throw new Error('Unsupported file type')
    }

    const docs = await loader.load()
    return docs
  }

  private async loadLegacyDocFile(filePath: string, fileExt: string): Promise<Document[]> {
    const text = await extractLegacyDocBody(filePath)
    if (!text.trim()) return []

    return [
      new Document({
        pageContent: text,
        metadata: {
          source: filePath,
          file_path: filePath,
          fileExt
        }
      })
    ]
  }

  private async loadSpreadsheetMetadataFile(
    filePath: string,
    fileExt: string
  ): Promise<Document[]> {
    const buffer = await fs.readFile(filePath)
    const { title, sheetNames } = await extractSpreadsheetMetadata(buffer)
    const lines = [`文件名：${path.basename(filePath)}`]
    if (title) lines.push(`标题：${title}`)
    if (sheetNames.length > 0) lines.push(`工作表：${sheetNames.join('、')}`)

    return [
      new Document({
        pageContent: lines.join('\n'),
        metadata: {
          source: filePath,
          file_path: filePath,
          fileExt
        }
      })
    ]
  }

  private async loadTextFile(filePath: string, fileExt: string): Promise<Document[]> {
    const buffer = await fs.readFile(filePath)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    if (!text.trim()) return []

    return [
      new Document({
        pageContent: text,
        metadata: {
          source: filePath,
          file_path: filePath,
          fileExt
        }
      })
    ]
  }

  public async splitDocuments(docs: Document[]): Promise<{
    bigSplitDocs: Document[]
    miniSplitDocs: Document[]
  }> {
    if (docs.length === 0) {
      return {
        bigSplitDocs: [],
        miniSplitDocs: []
      }
    }

    const bigSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: SPLITTER_BIG_CHUNK_SETTING.chunkSize,
      chunkOverlap: SPLITTER_BIG_CHUNK_SETTING.chunkOverlap
    })

    const miniSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: SPLITTER_MINI_CHUNK_SIZE.chunkSize,
      chunkOverlap: SPLITTER_MINI_CHUNK_SIZE.chunkOverlap
    })

    const bigSplitDocs = await bigSplitter.splitDocuments(docs)
    const miniSplitDocs = await miniSplitter.splitDocuments(docs)
    return {
      bigSplitDocs,
      miniSplitDocs
    }
  }

  public async processFile(filePath: string): Promise<ProcessFileResult> {
    if (isSpreadsheetFilePath(filePath)) {
      const docs = await this.loadFile(filePath)
      return {
        bigSplitDocs: [],
        miniSplitDocs: [],
        anchorText: docs[0]?.pageContent,
        metadataOnly: true
      }
    }

    const docs = await this.loadFile(filePath)
    const { bigSplitDocs, miniSplitDocs } = await this.splitDocuments(docs)

    return {
      bigSplitDocs,
      miniSplitDocs,
      anchorText: path.basename(filePath)
    }
  }

  private normalizeWebText(input: string): string {
    const normalized = input.replace(/\u00a0/g, ' ').replace(/\r/g, '')
    const lines = normalized
      .split('\n')
      .map((l) => l.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
    return lines.join('\n')
  }

  public async loadWebPageText(payload: {
    url: string
    includeSelectors?: string[]
    excludeSelectors?: string[]
  }): Promise<{ title?: string; text: string }> {
    const loader = new CheerioWebBaseLoader(payload.url, { timeout: WEB_INGEST_TIMEOUT_MS })
    const $ = await loader.scrape()
    const title = $('title').first().text().trim() || undefined

    const includeSelector =
      payload.includeSelectors && payload.includeSelectors.length > 0
        ? payload.includeSelectors.join(',')
        : 'body'
    const $root = $(includeSelector)

    const defaultExclude = 'script,style,noscript,nav,header,footer,aside,form,svg,canvas,iframe'
    $root.find(defaultExclude).remove()
    if (payload.excludeSelectors && payload.excludeSelectors.length > 0) {
      for (const selector of payload.excludeSelectors) {
        if (!selector || !selector.trim()) continue
        $root.find(selector).remove()
      }
    }

    const rawText = $root.text()
    const text = this.normalizeWebText(rawText)
    if (!text) {
      throw new Error('网页正文为空')
    }
    if (text.length > WEB_INGEST_MAX_CHARS) {
      throw new Error('网页内容过大')
    }

    return { title, text }
  }

  public async processWebUrl(payload: {
    url: string
    includeSelectors?: string[]
    excludeSelectors?: string[]
  }) {
    const { title, text } = await this.loadWebPageText(payload)
    return this.processWebText({
      url: payload.url,
      title,
      text
    })
  }

  public async processWebText(payload: { url: string; title?: string; text: string }) {
    const docs = [
      new Document({
        pageContent: payload.text,
        metadata: {
          url: payload.url,
          title: payload.title || '',
          source_type: 'web'
        }
      })
    ]
    const { bigSplitDocs, miniSplitDocs } = await this.splitDocuments(docs)

    return {
      title: payload.title,
      bigSplitDocs,
      miniSplitDocs
    }
  }
}
