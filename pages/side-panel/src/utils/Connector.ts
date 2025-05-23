import * as pdfjsLib from 'pdfjs-dist'
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();
import { WebPDFLoader } from "@langchain/community/document_loaders/web/pdf";
import { DocxLoader } from '@src/utils/documentLoaders/docx'
import { TextLoader } from '@src/utils/documentLoaders/text'
import { SheetLoader } from '@src/utils/documentLoaders/sheet'
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { Document } from "@langchain/core/documents";
import { SPLITTER_BIG_CHUNK_SIZE, SPLITTER_BIG_CHUNK_OVERLAP, SPLITTER_MINI_CHUNK_SIZE, SPLITTER_MINI_CHUNK_OVERLAP, SPLITTER_SEPARATORS } from '@src/config'
import { getFileName } from '@src/utils/tool'
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import type { WebBaseLoaderParams } from "@langchain/community/document_loaders/web/cheerio";
import * as cheerio from 'cheerio';
import { UN_TEXT_TAGS } from '@src/utils/constant'

export type ConnectorClassUnion = typeof FileConnector | typeof CrawlerConnector


export interface GetChunksReturn extends Result {
    bigChunks?: Document[]
    miniChunks?: Document[]
    error?: Error
}

const getBaseTextRecursiveSplitter = () => {
    const bigSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: SPLITTER_BIG_CHUNK_SIZE,
        chunkOverlap: SPLITTER_BIG_CHUNK_OVERLAP,
        separators: SPLITTER_SEPARATORS
    });

    const miniSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: SPLITTER_MINI_CHUNK_SIZE,
        chunkOverlap: SPLITTER_MINI_CHUNK_OVERLAP,
        separators: SPLITTER_SEPARATORS
    });

    return {
        bigSplitter,
        miniSplitter
    }

}

// 文件连接器,读取上传文件的内容数据
export class FileConnector {

    constructor() {
    }

    static async getChunks(file: File): Promise<GetChunksReturn> {
        try {
            let bigChunks: Document[] = [];
            let miniChunks: Document[] = [];

            const fileBuffer = await file.arrayBuffer();

            if (!fileBuffer) {
                throw new Error('file buffer is empty')
            }
            const { bigSplitter, miniSplitter } = getBaseTextRecursiveSplitter();


            if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                // word文档处理
                const docxLoader = new DocxLoader(file)
                const docs = await docxLoader.load();

                // 分割大文档
                bigChunks = await bigSplitter.splitDocuments(docs);

                // 分割小文档
                miniChunks = await miniSplitter.splitDocuments(docs);
            } else if (file.type === 'application/pdf') {
                // pdf文档处理
                const loader = new WebPDFLoader(file, {
                    pdfjs: () => Promise.resolve(pdfjsLib),
                });
                const docs = await loader.load();

                // 分割成大块
                bigChunks = await bigSplitter.splitDocuments(docs);

                // 分割小块
                miniChunks = await miniSplitter.splitDocuments(docs);

            } else if (file.type === 'text/plain') {
                // 文本文档处理
                const textLoader = new TextLoader(file)
                const docs = await textLoader.load();

                // 分割大文档
                bigChunks = await bigSplitter.splitDocuments(docs);

                // 分割小文档
                miniChunks = await miniSplitter.splitDocuments(docs);


            } else if (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.type === 'text/csv') {
                // 表格文档处理
                /**
                 * TODO 需要重新设计对excel这里数据型的架构,目前架构只适合文章型的文档
                 * 1. 构思如何存储表格数据,肯定是不能使用倒排索引的
                 * 2. 搜索时还需考虑匹配到准确的数据,过滤无效数据,并且还需要尽可能匹配所有数据,不像文章型文档那样只匹配头部固定数据
                 * 3. 还需要解决大量数据传递给AI时的超出context_window_size的问题
                 * 想法,做成总结版的助手,有别于knowledge
                 * */
                const sheetLoader = new SheetLoader(file)
                const docs = await sheetLoader.load();

                const bigSplitter = new RecursiveCharacterTextSplitter({
                    chunkSize: SPLITTER_BIG_CHUNK_SIZE,
                    chunkOverlap: 0,
                    separators: SPLITTER_SEPARATORS
                });

                // 分割大文档
                bigChunks = await bigSplitter.splitDocuments(docs);

            } else if (file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
                // pptx文档处理
                throw new Error('pptx unimplemented')
            } else if (file.name.endsWith('.md')) {
                // markdown文档处理
                let fileContent = await file.text();
                fileContent = getFileName(file.name) + '\n' + fileContent

                const mdBigSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
                    chunkSize: SPLITTER_BIG_CHUNK_SIZE,
                    chunkOverlap: SPLITTER_BIG_CHUNK_OVERLAP,
                });

                const mdMiniSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
                    chunkSize: SPLITTER_MINI_CHUNK_SIZE,
                    chunkOverlap: SPLITTER_MINI_CHUNK_OVERLAP,
                });

                // 分割大文档
                bigChunks = await mdBigSplitter.createDocuments([fileContent]);

                // 分割小文档
                miniChunks = await mdMiniSplitter.createDocuments([fileContent]);
            }
            else {
                throw new Error('file type not supported')
            }

            if (!bigChunks.length && !miniChunks.length) {
                throw new Error('file content is empty')
            }

            return {
                status: 'Success',
                bigChunks,
                miniChunks
            }
        } catch (error) {
            return {
                status: 'Fail',
                error,
            }

        }

    }

}

// 爬虫连接器,读取网页内容数据
export class CrawlerConnector {
    constructor() {
    }

    static async getChunks({
        url, options, docName, rawHtml
    }: {
        url: string,
        options?: WebBaseLoaderParams
        docName: string
        rawHtml?: string // 整个html元素
    }): Promise<GetChunksReturn> {

        try {
            let bigChunks: Document[] = [];
            let miniChunks: Document[] = [];

            let $: cheerio.CheerioAPI
            if (rawHtml) {
                $ = cheerio.load(rawHtml)
            } else {
                const cheerioLangChain = new CheerioWebBaseLoader(
                    url,
                    {
                        ...options,

                    }
                );

                $ = await cheerioLangChain.scrape();
            }
            const bodyContent = $('body');
            // 清除非文本内容
            const unTextTagList = UN_TEXT_TAGS
            unTextTagList.forEach(tag => {
                bodyContent.find(tag).remove();
            });
            const text = docName + '\n' + bodyContent.text();
            const metadata = { url: url };

            const docs = [new Document({ pageContent: text, metadata })];


            const { bigSplitter, miniSplitter } = getBaseTextRecursiveSplitter();

            // 分割大文档
            bigChunks = await bigSplitter.splitDocuments(docs);

            // 分割小文档
            miniChunks = await miniSplitter.splitDocuments(docs);

            return {
                status: 'Success',
                bigChunks,
                miniChunks
            }
        } catch (error) {
            return {
                status: 'Fail',
                error,
            }
        }

    }
}

