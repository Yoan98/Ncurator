import React, { useState, useRef, useEffect } from 'react';
import { Select, Button, Input, message, Dropdown, Empty, Tooltip, MenuProps } from 'antd';
import { RiRobot2Line } from "react-icons/ri";
import { IoDocumentAttachOutline } from "react-icons/io5";
import dayjs from 'dayjs';
import { useGlobalContext } from '@src/provider/global';
import { searchDoc, getUserPrompt } from '@src/utils/tool';
import type {
    ChatCompletionMessageParam,
} from "@mlc-ai/web-llm";
import { CHAT_SYSTEM_PROMPT } from '@src/config'

enum MessageType {
    USER = 'user',
    ASSISTANT = 'assistant',
    DOCUMENTS = 'documents'
};
interface ChatUiMessage {
    type: MessageType;
    content?: string;
    timestamp: string;
    relateTextChunks?: Search.TextItemRes[];
}

// 设置项dropdown菜单
const aiOptions = [
    {
        value: 1,
        label: 'ai-assistant',
        icon: <RiRobot2Line />,
    },
    {
        value: 2,
        label: 'ai-knowledge',
        icon: <IoDocumentAttachOutline />,
    },

];


const { TextArea } = Input;

const ChatInterface = ({
    chatHistory = null,
}: {
    chatHistory?: ChatUiMessage[] | null;
}) => {
    const { connectionList, llmEngine } = useGlobalContext()

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const llmMessages = useRef<ChatCompletionMessageParam[]>([
        { role: "system", content: CHAT_SYSTEM_PROMPT }
    ]);

    const [chatUiMessage, setChatUiMessages] = useState<ChatUiMessage[]>([]);
    const [connectionOption, setConnectionOption] = useState<{ label: string, value: number }[]>([]);
    const [selectedConnection, setSelectedConnection] = useState<number[]>([]);

    const [question, setQuestion] = useState("");
    const [selectedAiOption, setSelectedAiOption] = useState(aiOptions[0]);

    const [askLoading, setAskLoading] = useState(false);


    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };


    const handleTextChunkClick = (doc: Search.TextItemRes) => { }

    const handleSend = async () => {
        if (!question) {
            message.warning('Please input the question');
        };
        if (!llmEngine.current) {
            message.warning('AI engine is not ready,please setup your LLM Model');
            return;
        }

        const userMessage = {
            type: MessageType.USER,
            content: question.trim(),
            timestamp: dayjs().toISOString(),
        };
        setChatUiMessages(prev => [...prev, userMessage]);
        setQuestion("");
        setAskLoading(true);

        let searchTextRes: Search.TextItemRes[] = []
        // 搜索数据库的数据
        if (selectedAiOption.value === 2) {
            try {
                const connections = connectionList.filter((connection) => !selectedConnection.length ? true : selectedConnection.includes(connection.id!));

                const res = await searchDoc(question, connections) as {
                    searchedRes: Search.TextItemRes[]
                }
                searchTextRes = res.searchedRes;
            } catch (error) {
                console.error(error);
                message.error('Error in search ' + error.message);
            }
        }

        // AI 问答
        try {
            const prompt = getUserPrompt(selectedAiOption.value == 1 ? 'chat' : 'knowledge', question, searchTextRes);
            // 生成llm的消息
            llmMessages.current.push({ role: "user", content: prompt });
            // 调用AI,处理返回
            let curMessage = "";
            const reply = await llmEngine.current.chat.completions.create({
                stream: true,
                messages: llmMessages.current,
            });
            const replyTime = dayjs().toISOString();
            for await (const chunk of reply) {
                const curDelta = chunk.choices[0].delta.content;
                if (curDelta) {
                    curMessage += curDelta;
                }
                // 更新ui
                setChatUiMessages((prev) => {
                    const oldReplyMes = prev.find((item) => item.timestamp === replyTime && item.type === MessageType.ASSISTANT);
                    if (oldReplyMes) {
                        return {
                            ...prev,
                            content: curMessage
                        }
                    } else {
                        const newChatUiMes: ChatUiMessage = {
                            type: MessageType.ASSISTANT,
                            content: curMessage,
                            timestamp: replyTime,
                        }

                        if (selectedAiOption.value === 2) {
                            newChatUiMes.relateTextChunks = searchTextRes
                        }

                        return [
                            ...prev,
                            newChatUiMes
                        ]

                    }
                });
            }
            // 更新llm消息
            llmMessages.current.push({ role: "assistant", content: curMessage });
        } catch (error) {
            console.error('Error sending message:', error);
            message.error('Error in chat ' + error.message);
        }

        setAskLoading(false);
    };

    const handleEnterPress = (e) => {
        handleSend();
    };

    useEffect(() => {
        scrollToBottom();
    }, [chatUiMessage]);
    useEffect(() => {
        if (chatHistory) {
            setChatUiMessages(chatHistory);
        }
    }, [chatHistory]);
    useEffect(() => {
        if (!connectionList.length) {
            return
        }
        const connectionOption = connectionList.map((connection) => {
            return {
                label: connection.name,
                value: connection.id!
            }
        })
        setConnectionOption(connectionOption);
    }, [connectionList])



    return (
        <div className="flex flex-col h-screen bg-[#fafafa]">
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatUiMessage.map((message, index) => (
                    <div
                        key={index}
                        className={`flex ${message.type === MessageType.USER ? 'justify-end' : 'justify-start'
                            }`}
                    >
                        {message.type === MessageType.DOCUMENTS ? (
                            <div className="w-full bg-white rounded-lg p-3 shadow-sm">
                                <h3 className="text-sm font-medium mb-2 text-gray-600">相关文档:</h3>
                                <div className="flex space-x-3 overflow-x-auto pb-2">
                                    {message.relateTextChunks!.map((textChunk, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => handleTextChunkClick(textChunk)}
                                            className="flex-shrink-0 bg-[#f5f5f5] rounded-lg p-3 hover:bg-gray-100 transition-colors w-44"
                                        >
                                            <div className="flex items-center space-x-2 mb-2">
                                                <IoDocumentAttachOutline size={25} />
                                                <span className="text-gray-700 truncate">{textChunk.document.name}</span>
                                            </div>
                                            <div className="text-sm text-gray-500">
                                                相关度: {(textChunk.score * 100).toFixed(0)}%
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div
                                className={`max-w-[80%] p-3 rounded-lg ${message.type === MessageType.USER
                                    ? 'bg-[#404040] text-white'
                                    : 'bg-white text-gray-800 shadow-sm'
                                    }`}
                            >
                                {message.content}
                            </div>
                        )}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="px-4 pb-4">
                <div className="max-w-4xl mx-auto bg-[#f5f5f5] rounded-lg border border-gray-200 overflow-hidden">
                    {/* Text Input */}
                    <TextArea
                        value={question}
                        onChange={(e) => setQuestion(e.target.value?.trim() || '')}
                        placeholder="Search something based on the resource..."
                        autoSize={{ minRows: 2 }}
                        variant='borderless'
                        className='text-base'
                        onPressEnter={handleEnterPress}
                    />


                    {/* Controls */}
                    <div className="flex items-center justify-between px-3 py-2">

                        <div className="ai-option flex items-center gap-2">
                            <Select
                                suffixIcon={selectedAiOption.icon}
                                defaultValue={[]}
                                variant="borderless"
                                style={{ maxWidth: '250px', minWidth: '120px' }}
                                options={aiOptions}
                                onChange={(value) => {
                                    const selectedOption = aiOptions.find((option) => option.value[0] === value);
                                    setSelectedAiOption(selectedOption!);
                                }}
                            />

                            {/* resource */}
                            {
                                selectedAiOption.value === 2 && <Select
                                    mode="multiple"
                                    defaultValue={[2]}
                                    placeholder="All Resources"
                                    variant="borderless"
                                    style={{ maxWidth: '250px', minWidth: '120px' }}
                                    options={connectionOption}
                                    onChange={(value) => setSelectedConnection(value)}
                                />
                            }

                        </div>


                        <Button loading={askLoading} type="primary" shape='circle' size="small" className='hover:scale-110 transition-transform' onClick={handleSend}>Go</Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ChatInterface;