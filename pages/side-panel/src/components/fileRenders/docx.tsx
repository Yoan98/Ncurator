import React, { useEffect, useState } from 'react';
import jsPreviewDocx from "@js-preview/docx";
import '@js-preview/docx/lib/index.css'
import './index.css';

const CustomDocxRenderer = ({ mainState }) => {
    const { currentDocument } = mainState;
    if (!currentDocument || currentDocument.fileData === undefined) return null;


    const initHtmlContent = async (file) => {

        const docxEle = document.getElementById('my-docx-renderer');
        if (!docxEle) return;
        const myDocxPreviewer = jsPreviewDocx.init(docxEle);

        myDocxPreviewer.preview(file);
    };

    useEffect(() => {
        if (currentDocument.file) {
            initHtmlContent(currentDocument.file);
        }
    }, [currentDocument]);

    return (
        <div id="my-docx-renderer" className="docx-content">
        </div>
    );
};

CustomDocxRenderer.fileTypes = ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
CustomDocxRenderer.weight = 1;

export default CustomDocxRenderer;