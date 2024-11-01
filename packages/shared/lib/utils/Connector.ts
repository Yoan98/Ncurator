import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';
import { WebPDFLoader } from "@langchain/community/document_loaders/web/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { Document } from "@langchain/core/documents";

// 文件连接器,读取上传文件的内容数据
export class FileConnector {

    constructor() {
    }

    async getSplits(file: File): Promise<Document[]> {
        const fileBuffer = await file.arrayBuffer();

        if (!fileBuffer) {
            throw new Error('read file error')
        }

        if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const textRes = await mammoth.extractRawText({ arrayBuffer: fileBuffer })

            const textSplitter = new RecursiveCharacterTextSplitter({
                chunkSize: 1000,
                chunkOverlap: 200,
            });

            const chunks = await textSplitter.splitDocuments([new Document({ pageContent: textRes.value })]);

            return chunks

        } else if (file.type === 'application/pdf') {
            const loader = new WebPDFLoader(file, {
                pdfjs: () => Promise.resolve(pdfjsLib),
            });
            const docs = await loader.load();

            const textSplitter = new RecursiveCharacterTextSplitter({
                chunkSize: 1000,
                chunkOverlap: 200,
            });

            const chunks = await textSplitter.splitDocuments(docs);

            return chunks
        } else {
            throw new Error('file type not supported')
        }

    }

}

