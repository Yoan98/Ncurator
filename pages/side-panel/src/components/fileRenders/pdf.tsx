import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { pdfjs, Document, Page } from "react-pdf";
import { Pagination } from 'antd';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

const CustomPDFRenderer = ({ mainState }) => {
    const { currentDocument } = mainState;
    const [numPages, setNumPages] = useState(0);
    const [pageNumber, setPageNumber] = useState(1);

    if (!currentDocument || currentDocument.fileData === undefined) return null

    const onDocumentLoadSuccess = ({ numPages }) => {
        setNumPages(numPages);
    }

    const onPageChange = (page) => {
        setPageNumber(page);
    };

    useEffect(() => {
        if (currentDocument.metadata && currentDocument.metadata.pageNumber) {
            setPageNumber(currentDocument.metadata.pageNumber);
        }

    }, [currentDocument])


    return (
        <div id="my-pdf-renderer relative">
            <Document
                file={currentDocument.fileData}
                onLoadSuccess={onDocumentLoadSuccess}
            >
                <Page pageNumber={pageNumber}
                />
                <div className='absolute bottom-[60px] left-1/2 -translate-x-1/2 min-w-[200px] z-10 opacity-20 hover:opacity-100 transition-opacity duration-300'>
                    <Pagination
                        current={pageNumber}
                        total={numPages}
                        onChange={onPageChange}
                        simple
                        pageSize={1}
                        showSizeChanger={false}
                    />
                </div>
            </Document>


        </div>
    );
};

CustomPDFRenderer.fileTypes = ["pdf", "application/pdf"];
CustomPDFRenderer.weight = 1;

export default CustomPDFRenderer;