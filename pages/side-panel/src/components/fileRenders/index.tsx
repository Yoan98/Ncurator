import { Modal } from 'antd';
import DocViewer, { DocViewerRenderers } from "react-doc-viewer";
import type { IDocument } from "react-doc-viewer";
import CustomPDFRenderer from "./pdf";
import CustomMarkdownRenderer from "./markdown";
import CustomDocxRenderer from "./docx";
import React from 'react';

export interface FileRenderDocument extends IDocument {
    fileName: string
    metadata?: {
        pageNumber: number
    }
    file?: File

}

const FileRender = React.memo(({
    open,
    documents,
    onCancel
}: {
    open: boolean,
    documents: FileRenderDocument[]
    onCancel: () => void
}) => {
    return (
        <Modal className='max-w-[90vw' width='auto' destroyOnClose footer={null} centered title={documents[0]?.fileName || 'File viewer'} open={open} onCancel={onCancel} >
            <DocViewer className='max-w-[100%] max-h-[70vh]' documents={documents} pluginRenderers={[CustomPDFRenderer, CustomMarkdownRenderer, CustomDocxRenderer, ...DocViewerRenderers]} config={{
                header: {
                    disableHeader: true
                }
            }} />
        </Modal>
    );
})

export default FileRender;