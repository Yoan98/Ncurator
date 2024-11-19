import React, { useEffect, useRef } from 'react';
import Mark from 'mark.js';
import { Tooltip } from 'antd';

const TextHighlighter = ({ text, keywords, className }: {
    text: string;
    keywords: string[];  // 修改为数组，支持多个关键词
    className?: string;
}) => {
    const contentRef = useRef(null);

    useEffect(() => {
        if (contentRef.current && keywords.length > 0) {
            const instance = new Mark(contentRef.current);
            instance.unmark();  // 清除之前的高亮

            // 遍历每个关键词，逐个高亮
            keywords.forEach((keyword) => {
                instance.mark(keyword); // 高亮匹配的每个关键词
            });
        }
    }, [keywords, text]);  // 依赖 keywords 和 text

    return (
        <Tooltip placement="top" title={text} >
            <p ref={contentRef} className={className}>{text}</p>
        </Tooltip>
    );
};

export default TextHighlighter;
