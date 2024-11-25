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

    private getRecursiveSplitter() {
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
        const { bigSplitter, miniSplitter } = this.getRecursiveSplitter();

        console.log('file.type', file.type)
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
            const sheetLoader = new SheetLoader(file)
            const docs = await sheetLoader.load();

            // 分割大文档
            const bigChunks = await bigSplitter.splitDocuments(docs);

            // 分割小文档
            const miniChunks = await miniSplitter.splitDocuments(docs);

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

