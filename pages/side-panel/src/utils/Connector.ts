import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';
import { WebPDFLoader } from "@langchain/community/document_loaders/web/pdf";
import { DocxLoader } from '@src/utils/documentLoaders/docx'
import { TextLoader } from '@src/utils/documentLoaders/text'
import { SheetLoader } from '@src/utils/documentLoaders/sheet'
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { Document } from "@langchain/core/documents";
import { SPLITTER_BIG_CHUNK_SIZE, SPLITTER_BIG_CHUNK_OVERLAP, SPLITTER_MINI_CHUNK_SIZE, SPLITTER_MINI_CHUNK_OVERLAP, SPLITTER_SEPARATORS } from '@src/config'

// 文件连接器,读取上传文件的内容数据
export class FileConnector {

    constructor() {
    }

    private getBaseTextRecursiveSplitter() {
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
    async getChunks(file: File): Promise<{
        bigChunks: Document[],
        miniChunks: Document[]
    }> {
        const fileBuffer = await file.arrayBuffer();

        if (!fileBuffer) {
            throw new Error('read file error')
        }
        const { bigSplitter, miniSplitter } = this.getBaseTextRecursiveSplitter();

        if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            // word文档处理
            const docxLoader = new DocxLoader(file)
            const docs = await docxLoader.load();

            // 分割大文档
            const bigChunks = await bigSplitter.splitDocuments(docs);

            // 分割小文档
            const miniChunks = await miniSplitter.splitDocuments(docs);

            return {
                bigChunks,
                miniChunks
            }

        } else if (file.type === 'application/pdf') {
            // pdf文档处理
            const loader = new WebPDFLoader(file, {
                pdfjs: () => Promise.resolve(pdfjsLib),
            });
            const docs = await loader.load();

            // 分割成大块
            const bigChunks = await bigSplitter.splitDocuments(docs);

            // 分割小块
            const miniChunks = await miniSplitter.splitDocuments(docs);

            return {
                bigChunks,
                miniChunks
            }
        } else if (file.type === 'text/plain') {
            // 文本文档处理
            const textLoader = new TextLoader(file)
            const docs = await textLoader.load();

            // 分割大文档
            const bigChunks = await bigSplitter.splitDocuments(docs);

            // 分割小文档
            const miniChunks = await miniSplitter.splitDocuments(docs);

            return {
                bigChunks,
                miniChunks
            }

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
            const bigChunks = await bigSplitter.splitDocuments(docs);

            return {
                bigChunks,
                miniChunks: []
            }

        } else if (file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
            // pptx文档处理
            throw new Error('pptx unimplemented')
        } else if (file.name.endsWith('.md')) {
            // markdown文档处理
            const fileContent = await file.text();

            const mdBigSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
                chunkSize: SPLITTER_BIG_CHUNK_SIZE,
                chunkOverlap: SPLITTER_BIG_CHUNK_OVERLAP,
            });

            const mdMiniSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
                chunkSize: SPLITTER_MINI_CHUNK_SIZE,
                chunkOverlap: SPLITTER_MINI_CHUNK_OVERLAP,
            });

            // 分割大文档
            const bigChunks = await mdBigSplitter.createDocuments([fileContent]);

            // 分割小文档
            const miniChunks = await mdMiniSplitter.createDocuments([fileContent]);

            return {
                bigChunks,
                miniChunks
            }
        }
        else {
            throw new Error('file type not supported')
        }

    }

}

