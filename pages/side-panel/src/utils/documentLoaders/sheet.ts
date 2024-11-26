import { Document } from "@langchain/core/documents";
import { BaseDocumentLoader } from "@langchain/core/document_loaders/base";
import * as XLSX from 'xlsx';

export class SheetLoader extends BaseDocumentLoader {
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

        const workbook = XLSX.read(fileBuffer, { type: 'array' });
        const sheetNames = workbook.SheetNames;
        const documents: Document[] = [];

        sheetNames.forEach((sheetName, index) => {
            const sheet = workbook.Sheets[sheetName];
            const sheetContent = XLSX.utils.sheet_to_csv(sheet);
            documents.push(new Document({
                pageContent: sheetContent,
                metadata: {
                    sheetName,
                    sheetIndex: index + 1,
                    pageNumber: index + 1
                }
            }));
        });

        return documents;
    }
}