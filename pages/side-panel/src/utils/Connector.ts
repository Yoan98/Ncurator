import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';
import { WebPDFLoader } from "@langchain/community/document_loaders/web/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { Document } from "@langchain/core/documents";
import { SPLITTER_BIG_CHUNK_SIZE, SPLITTER_BIG_CHUNK_OVERLAP, SPLITTER_MINI_CHUNK_SIZE, SPLITTER_MINI_CHUNK_OVERLAP, SPLITTER_SEPARATORS } from '@src/config'

// 文件连接器,读取上传文件的内容数据
export class FileConnector {

    constructor() {
    }

    async getChunks(file: File): Promise<{
        bigChunks: Document[],
        miniChunks: Document[]
    }> {
        const fileBuffer = await file.arrayBuffer();

        if (!fileBuffer) {
            throw new Error('read file error')
        }

        if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            // word文档处理
            // todo:模仿pdf文档处理
            const textRes = await mammoth.extractRawText({ arrayBuffer: fileBuffer })

            const docs = [new Document({ pageContent: textRes.value })]
            // 分割大文档
            const bigSplitter = new RecursiveCharacterTextSplitter({
                chunkSize: SPLITTER_BIG_CHUNK_SIZE,
                chunkOverlap: SPLITTER_BIG_CHUNK_OVERLAP,
                separators: SPLITTER_SEPARATORS
            });
            const bigChunks = await bigSplitter.splitDocuments(docs);

            // 分割小文档
            const miniSplitter = new RecursiveCharacterTextSplitter({
                chunkSize: SPLITTER_MINI_CHUNK_SIZE,
                chunkOverlap: SPLITTER_MINI_CHUNK_OVERLAP,
                separators: SPLITTER_SEPARATORS
            });
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
            const bigSplitter = new RecursiveCharacterTextSplitter({
                chunkSize: SPLITTER_BIG_CHUNK_SIZE,
                chunkOverlap: SPLITTER_BIG_CHUNK_OVERLAP,
                separators: SPLITTER_SEPARATORS
            });
            const bigChunks = await bigSplitter.splitDocuments(docs);

            // 分割小块
            const miniSplitter = new RecursiveCharacterTextSplitter({
                chunkSize: SPLITTER_MINI_CHUNK_SIZE,
                chunkOverlap: SPLITTER_MINI_CHUNK_OVERLAP,
                separators: SPLITTER_SEPARATORS
            });
            const miniChunks = await miniSplitter.splitDocuments(docs);

            return {
                bigChunks,
                miniChunks
            }
        } else {
            throw new Error('file type not supported')
        }

    }

}

