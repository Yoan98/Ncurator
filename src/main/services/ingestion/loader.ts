import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { Document } from '@langchain/core/documents'
import fs from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { extractLegacyDocBody } from '../word/legacyDocReader'
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
  '.txt'
] as const

export const isSpreadsheetFilePath = (filePath: string): boolean =>
  new Set(['.xlsx', '.xlsm', '.xltx', '.xltm']).has(path.extname(filePath).toLowerCase())

const SUPPORTED_LOCAL_FILE_EXTENSION_SET = new Set<string>(SUPPORTED_LOCAL_FILE_EXTENSIONS)
const SUPPORTED_TEXT_FILE_EXTENSION_SET = new Set<string>(['.md', '.markdown', '.txt'])

export const isSupportedLocalFilePath = (filePath: string): boolean =>
  SUPPORTED_LOCAL_FILE_EXTENSION_SET.has(path.extname(filePath).toLowerCase())

export const isSupportedTextFilePath = (filePath: string): boolean =>
  SUPPORTED_TEXT_FILE_EXTENSION_SET.has(path.extname(filePath).toLowerCase())

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

  public async processFile(filePath: string) {
    const docs = await this.loadFile(filePath)
    const { bigSplitDocs, miniSplitDocs } = await this.splitDocuments(docs)

    return {
      bigSplitDocs,
      miniSplitDocs
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

    const defaultExclude =
      'script,style,noscript,nav,header,footer,aside,form,svg,canvas,iframe'
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

  public async processWebText(payload: {
    url: string
    title?: string
    text: string
  }) {
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
