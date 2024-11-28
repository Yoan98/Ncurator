import { Document } from "@langchain/core/documents";
import { BaseDocumentLoader } from "@langchain/core/document_loaders/base";
import mammoth from 'mammoth'
import { getFileName } from '@src/utils/tool'
/**
 * A class that extends the `BufferLoader` class. It represents a document
 * loader that loads documents from DOCX files.
 */
export class DocxLoader extends BaseDocumentLoader {
    protected file: File;

    constructor(
        file: File,
    ) {
        super();
        this.file = file;
    }

    async load(): Promise<Document[]> {
        const fileBuffer = await this.file.arrayBuffer();
        if (!fileBuffer) {
            throw new Error('read file error')
        }
        const pageNumber = 1
        const docx = await mammoth.extractRawText({ arrayBuffer: fileBuffer })
        const docxText = getFileName(this.file.name) + '\n' + docx.value

        if (!docxText) return [];

        return [new Document({
            pageContent: docxText, metadata: {
                pageNumber
            }
        })]
    }
}
