import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';


// 文件连接器,读取上传文件的内容数据
export class FileConnector {

    constructor() {
    }

    async getRawText(file: File): Promise<string> {
        const fileBuffer = await file.arrayBuffer();

        if (!fileBuffer) {
            throw new Error('read file error')
        }


        if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const textRes = await mammoth.extractRawText({ arrayBuffer: fileBuffer })

            return textRes.value

        } else if (file.type === 'application/pdf') {
            const text = await this.readPdf(fileBuffer)

            return text
        } else {
            throw new Error('file type not supported')
        }

        // return new Promise((resolve, reject) => {


        //     const handleFileRead = async (e: ProgressEvent<FileReader>) => {

        //     }

        //     const reader = new FileReader()
        //     reader.onload = handleFileRead
        //     reader.readAsArrayBuffer(file)

        // })
    }

    private async readPdf(fileBuffer: ArrayBuffer) {
        const pdf = await pdfjsLib.getDocument({ data: fileBuffer }).promise;
        let text = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => {
                // @ts-ignore
                return item.str || '';
            }).join(' ') + '\n';
        }
        return text;
    };
}

