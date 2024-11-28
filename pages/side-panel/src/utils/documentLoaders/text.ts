import { Document } from "@langchain/core/documents";
import { BaseDocumentLoader } from "@langchain/core/document_loaders/base";
import { getFileName } from '@src/utils/tool'
export class TextLoader extends BaseDocumentLoader {
    protected file: File;

    constructor(
        file: File,
    ) {
        super();
        this.file = file;
    }

    async load(): Promise<Document[]> {
        let fileContent = await this.file.text();
        if (!fileContent) {
            throw new Error('read file error')
        }

        const pageNumber = 1
        fileContent = getFileName(this.file.name) + '\n' + fileContent

        return [new Document({
            pageContent: fileContent,
            metadata: {
                pageNumber
            }
        })];
    }
}