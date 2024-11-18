import React, { useEffect, useRef } from 'react';
import Mark from 'mark.js';

const TextHighlighter = ({ text, keyword, className }: {
    text: string;
    keyword: string;
    className?: string;
}) => {
    const contentRef = useRef(null);

    useEffect(() => {
        if (contentRef.current && keyword) {
            const instance = new Mark(contentRef.current);
            instance.unmark();  // 清除之前的高亮
            instance.mark(keyword); // 高亮匹配的关键字
        }
    }, [keyword, text]);  // 依赖关键字和文本内容

    return (
        <p ref={contentRef} className={className}>{text}</p>
    );
};

export default TextHighlighter;
