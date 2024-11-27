import React, { useEffect, useState } from 'react';
import mammoth from 'mammoth';
import DOMPurify from 'dompurify';

const CustomDocxRenderer = ({ mainState }) => {
    const { currentDocument } = mainState;
    if (!currentDocument || currentDocument.fileData === undefined) return null;

    const [htmlContent, setHtmlContent] = useState('');

    const initHtmlContent = async (file) => {
        const arrayBuffer = await file.arrayBuffer();
        mammoth.convertToHtml({ arrayBuffer })
            .then((result) => {
                const cleanHtml = DOMPurify.sanitize(result.value);
                setHtmlContent(cleanHtml);
            })
            .catch((error) => {
                console.error(error);
            });
    };

    useEffect(() => {
        if (currentDocument.file) {
            initHtmlContent(currentDocument.file);
        }
    }, [currentDocument]);

    return (
        <div id="my-docx-renderer" className="docx-content" dangerouslySetInnerHTML={{ __html: htmlContent }}>
        </div>
    );
};

CustomDocxRenderer.fileTypes = ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
CustomDocxRenderer.weight = 1;

export default CustomDocxRenderer;