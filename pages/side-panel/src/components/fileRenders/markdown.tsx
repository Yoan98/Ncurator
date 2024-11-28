import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm'

const CustomMarkdownRenderer = ({ mainState }) => {
    const { currentDocument } = mainState;
    if (!currentDocument || currentDocument.fileData === undefined) return null;

    const [markdownText, setMarkdownText] = useState('');

    const initMarkdownText = async (file: File) => {
        const text = await file.text();
        setMarkdownText(text);
    }

    useEffect(() => {
        if (currentDocument.file) {
            initMarkdownText(currentDocument.file);
        }

    }, [currentDocument]);

    return (
        <div id="my-markdown-renderer" className='chat-markdown'>
            <ReactMarkdown children={markdownText} remarkPlugins={[remarkGfm]}>
            </ReactMarkdown>
        </div>
    );
};

CustomMarkdownRenderer.fileTypes = ["md", "markdown"];
CustomMarkdownRenderer.weight = 1;

export default CustomMarkdownRenderer;