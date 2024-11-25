import { Document } from "@langchain/core/documents";
import { BaseDocumentLoader } from "@langchain/core/document_loaders/base";
export class TextLoader extends BaseDocumentLoader {
    protected blob: Blob;

    constructor(
        blob: Blob,
    ) {
        super();
        this.blob = blob;
    }

    async load(): Promise<Document[]> {
        const fileContent = await this.blob.text();
        if (!fileContent) {
            throw new Error('read file error')
        }

        return [new Document({
            pageContent: fileContent,
            metadata: {
                pageNumber: 1
            }
        })];
    }
}