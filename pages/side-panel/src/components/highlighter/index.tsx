import React, { useEffect, useRef } from 'react';
import Mark from 'mark.js';

const TextHighlighter = ({ text, keywords, className }: {
    text: string;
    keywords: string[];
    className?: string;
}) => {
    const contentRef = useRef(null);

    useEffect(() => {
        if (!contentRef.current || keywords.length === 0) return;
        const mark = new Mark(contentRef.current)
        mark.mark(keywords, {
            separateWordSearch: false,
        });

        return () => {
            mark.unmark();
        }
    }, [keywords, text]);

    return (
        <p ref={contentRef} className={className}>{text}</p>
    );
};

export default TextHighlighter;
