// MessageList.tsx
import React from 'react';
import Logo from '@src/components/logo';
import { IoIosArrowUp, IoIosArrowDown } from 'react-icons/io';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import remarkGfm from 'remark-gfm';
import { Empty } from 'antd';
import { MessageType } from '@src/utils/constant';
import { t } from '@extension/i18n';

interface MessageListProps {
    chatUiMessages: Chat.UiMessage[];
    onTextChunkClick: (textChunk: Search.TextItemRes) => void;
    onExpandClick: (message: Chat.UiMessage) => void;
}

const MessageList: React.FC<MessageListProps> = React.memo(({
    chatUiMessages,
    onTextChunkClick,
    onExpandClick
}) => {
    return (
        <>
            {chatUiMessages.map((message, index) => (
                <div
                    key={index}
                    className={`flex ${message.type === MessageType.USER ? 'justify-end' : 'justify-start'
                        }`}
                >
                    <div className="msg-wrap flex gap-1 max-w-[90%]">
                        {message.type === MessageType.ASSISTANT && <Logo />}
                        <div className="msg-content max-w-full">
                            {message.type === MessageType.USER && (
                                <div className="mb-2 px-5 py-2.5 rounded-3xl bg-[#404040] text-base text-white">
                                    {message.content}
                                </div>
                            )}
                            {message.type === MessageType.ASSISTANT && (
                                <div className="mb-2 chat-markdown text-gray-800">
                                    <ReactMarkdown
                                        children={message.content}
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            code({ node, className, children, ...props }) {
                                                const match = /language-(\w+)/.exec(className || '');
                                                return match ? (
                                                    <SyntaxHighlighter
                                                        children={String(children).replace(/\n$/, '')}
                                                        language={match[1]}
                                                        PreTag="div"
                                                        {...props}
                                                    />
                                                ) : (
                                                    <code className={className} {...props}>
                                                        {children}
                                                    </code>
                                                );
                                            },
                                        }}
                                    />
                                </div>
                            )}
                            {message.type === MessageType.ASSISTANT && message.relateDocs && (
                                <div className="p-2 bg-white rounded-lg shadow-sm">
                                    <div
                                        className="cursor-pointer text-sm mb-1 flex items-center gap-1"
                                        onClick={() => {
                                            onExpandClick(message);
                                        }}
                                    >
                                        <span>{t('relate_document')}</span>
                                        {message.isOpenRelateDocs ? (
                                            <IoIosArrowUp />
                                        ) : (
                                            <IoIosArrowDown />
                                        )}
                                    </div>
                                    <div
                                        className={`space-y-1 ${message.isOpenRelateDocs ? '' : 'hidden'
                                            }`}
                                    >
                                        {!message.relateDocs.length ? (
                                            <Empty description="No related documents" />
                                        ) : (
                                            message.relateDocs.map((textChunk: any, idx: number) => (
                                                <div
                                                    key={idx}
                                                    className="text-sm cursor-pointer text-blue-500"
                                                    onClick={() => onTextChunkClick(textChunk)}
                                                >
                                                    {textChunk.document.name}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </>
    );
})

export default MessageList;