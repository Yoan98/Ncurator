import { Document } from "@langchain/core/documents";
import { BaseDocumentLoader } from "@langchain/core/document_loaders/base";
import mammoth from 'mammoth'
/**
 * A class that extends the `BufferLoader` class. It represents a document
 * loader that loads documents from DOCX files.
 */
export class DocxLoader extends BaseDocumentLoader {
    protected blob: Blob;

    constructor(
        blob: Blob,
    ) {
        super();
        this.blob = blob;
    }

    async load(): Promise<Document[]> {
        const fileBuffer = await this.blob.arrayBuffer();
        if (!fileBuffer) {
            throw new Error('read file error')
        }
        const docx = await mammoth.extractRawText({ arrayBuffer: fileBuffer })

        if (!docx.value) return [];

        return [new Document({
            pageContent: docx.value, metadata: {
                pageNumber: 1
            }
        })]
    }
}
