import React, { useState, useRef, useEffect } from 'react';
import { Select, Button, Input, message, Dropdown, Empty, Tooltip } from 'antd';
import { IoDocumentAttachOutline } from "react-icons/io5";
import dayjs from 'dayjs';
import { useGlobalContext } from '@src/provider/global';
import { searchDoc } from '@src/utils/tool';
import { IoBookOutline, IoChatbubblesOutline } from "react-icons/io5";
import { APP_NAME } from '@src/utils/constant';
import { ChatLlmMessage } from '@src/utils/ChatLlmMessage';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm'
import { VscSend } from "react-icons/vsc";
import { CiPause1 } from "react-icons/ci";
import { TbDatabaseSearch } from "react-icons/tb";
import Logo from '@src/components/logo';

enum MessageType {
    USER = 'user',
    ASSISTANT = 'assistant',
};


// 设置项dropdown菜单
const aiOptions = [
    {
        key: 1,
        label: 'Knowledge',
        icon: <IoBookOutline size={18} />,
    },
    {
        key: 2,
        label: 'Chat',
        icon: <IoChatbubblesOutline size={18} />,
    }

];


const { TextArea } = Input;

const ChatSection = ({
    chatHistoryId,
    onHistoryUpdate
}: {
    chatHistoryId: number;
    onHistoryUpdate: (localChatHistory: Chat.LocalHistory[]) => void;
}) => {
    const { connectionList, llmEngine, llmEngineLoadStatus } = useGlobalContext()

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatLlmMessageRef = useRef<ChatLlmMessage | null>(null);

    const [chatUiMessages, setChatUiMessages] = useState<Chat.UiMessage[]>([]);

    const [connectionOption, setConnectionOption] = useState<{ label: string, value: number }[]>([]);
    const [selectedConnection, setSelectedConnection] = useState<number[]>([]);

    const [question, setQuestion] = useState("");
    const [selectedAiOption, setSelectedAiOption] = useState(aiOptions[0]);

    const [askLoading, setAskLoading] = useState(false);
    const [searchLoading, setSearchLoading] = useState(false);


    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };


    const handleTextChunkClick = (doc: Search.TextItemRes) => { }

    const handleSend = async () => {
        if (!llmEngine.current || llmEngineLoadStatus !== 'success') {
            message.warning('AI engine is not ready,please setup your LLM Model');
            return;
        }

        if (askLoading) {
            if (searchLoading) {
                return
            }

            llmEngine.current!.interruptGenerate()
            setAskLoading(false);
            return;
        }
        if (!question) {
            message.warning('Please input the question');
            return
        };

        // 重置状态
        setQuestion("");
        setAskLoading(true);

        const uiUserMessage = {
            type: MessageType.USER,
            content: question.trim(),
            timestamp: dayjs().toISOString(),
        };
        const uiAssistantMessage: Chat.UiMessage = {
            type: MessageType.ASSISTANT,
            content: '⚫',
            timestamp: dayjs().toISOString(),
        }
        setChatUiMessages(prev => [...prev, uiUserMessage, uiAssistantMessage]);

        let searchTextRes: Search.TextItemRes[] = []
        // 搜索数据库的数据
        if (selectedAiOption.key === 1) {
            try {
                setSearchLoading(true);

                const connections = connectionList.filter((connection) => !selectedConnection.length ? true : selectedConnection.includes(connection.id!));

                const res = await searchDoc(question, connections, 5) as {
                    searchedRes: Search.TextItemRes[]
                }
                searchTextRes = res.searchedRes;

                uiAssistantMessage.relateTextChunks = searchTextRes;

            } catch (error) {
                console.error(error);
                message.error('Error in search ' + error.message);
            }

            setSearchLoading(false);
        }

        // AI处理
        try {
            let temptChatUiMessages: Chat.UiMessage[] = [];
            const handleStreamCb = (msg: string, chunk) => {
                // 更新ui
                setChatUiMessages((prev) => {
                    // 更新assistant消息
                    const oldReplyMes = prev.find((item) => item.timestamp === uiAssistantMessage.timestamp && item.type === MessageType.ASSISTANT);
                    oldReplyMes!.content = msg + '⚫';

                    console.log('chunk', chunk)
                    if (chunk.choices[0]?.finish_reason == 'stop') {
                        oldReplyMes!.content = msg;
                    }
                    temptChatUiMessages = [...prev];
                    return temptChatUiMessages;
                });
            }

            await chatLlmMessageRef.current!.sendMsg({
                prompt: question,
                type: selectedAiOption.key == 1 ? 'knowledge' : 'chat',
                searchTextRes,
                llmEngine: llmEngine.current,
                streamCb: handleStreamCb
            })

            // 存储聊天记录
            storageChatHistory(temptChatUiMessages, chatLlmMessageRef.current!.getChatHistory(), chatHistoryId)

        } catch (error) {
            console.error('Error sending message:', error);
            message.error('Error in chat ' + error);
        }

        setAskLoading(false);
    };
    const handleEnterPress = (e) => {
        if (askLoading) {
            return;
        }
        // 避免shift+enter换行
        if (e.shiftKey) {
            return;
        }
        e.preventDefault();
        handleSend();
    };
    const handleAiOptionClick = ({ key }) => {
        const selectedOption = aiOptions.find((option) => option.key == key);
        setSelectedAiOption(selectedOption!);
    }
    const storageChatHistory = (chatUiMessages: Chat.UiMessage[], chatLlmMessages: Chat.LlmMessage[], historyId: number) => {
        if (!chatUiMessages.length) {
            throw new Error('chatUiMessages is empty');
        }

        // 将ui消息与llm的历史消息存入localstorage
        let chatHistoryStr = localStorage.getItem('chatLocalHistory');
        const chatLocalHistory: Chat.LocalHistory[] = chatHistoryStr ? JSON.parse(chatHistoryStr) : [];


        //查找是否有该历史记录
        const sameHistoryIndex = chatLocalHistory.findIndex((item) => item.historyId === historyId);
        if (sameHistoryIndex > -1) {
            chatLocalHistory[sameHistoryIndex].uiMessages = chatUiMessages;
            chatLocalHistory[sameHistoryIndex].llmMessages = chatLlmMessages
        } else {
            chatLocalHistory.push({
                historyId: historyId,
                uiMessages: chatUiMessages,
                llmMessages: chatLlmMessages,
            });
        }

        localStorage.setItem('chatLocalHistory', JSON.stringify(chatLocalHistory));

        onHistoryUpdate(chatLocalHistory);
    }

    const fetchChatMessages = (historyId: number) => {
        let chatHistoryStr = localStorage.getItem('chatLocalHistory');
        const chatLocalHistory: Chat.LocalHistory[] = chatHistoryStr ? JSON.parse(chatHistoryStr) : [];

        const history = chatLocalHistory.find((item) => item.historyId === historyId);

        setChatUiMessages(history?.uiMessages || []);

        const chatLlmMessage = new ChatLlmMessage({
            responseStyle: 'markdown',
            chatHistory: history?.llmMessages || []
        });
        chatLlmMessageRef.current = chatLlmMessage;
    }

    useEffect(() => {
        if (!chatHistoryId) return

        fetchChatMessages(chatHistoryId);
        scrollToBottom();
    }, [chatHistoryId]);

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
        <div className="chat-section flex flex-col flex-1">
            {/* Chat Messages */}
            <div className="chat-content flex-1 overflow-y-auto space-y-3 relative">
                {
                    chatUiMessages.length === 0 ? <div className='flex flex-col items-center gap-1 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
                        <Logo size={40} />
                        <div className='text-lg font-bold'>Start Chat</div>
                    </div>
                        : chatUiMessages.map((message, index) => (
                            <div
                                key={index}
                                className={`flex ${message.type === MessageType.USER ? 'justify-end' : 'justify-start'
                                    }`}
                            >
                                <div className="msg-wrap flex gap-1 max-w-[90%]">
                                    {
                                        message.type === MessageType.ASSISTANT && <Logo />
                                    }
                                    <div className="msg-content  max-w-full">
                                        {
                                            message.type === MessageType.USER && <div className="mb-2 px-5 py-2.5 rounded-3xl  bg-[#404040] text-sm text-white">{message.content}</div>
                                        }
                                        {
                                            message.type === MessageType.ASSISTANT && <div
                                                className={`mb-2  chat-markdown  text-gray-800 `}
                                            >
                                                <ReactMarkdown children={message.content} remarkPlugins={[remarkGfm]} />
                                            </div>
                                        }

                                        {message.type === MessageType.ASSISTANT && message.relateTextChunks && (
                                            <div className="w-full bg-white rounded-lg p-3 shadow-sm">
                                                <h3 className="text-base font-medium mb-2 ">相关文档:</h3>
                                                <div className="flex space-x-3 overflow-x-auto pb-2">
                                                    {!message.relateTextChunks.length ?

                                                        <Empty description="No related documents" />
                                                        : message.relateTextChunks!.map((textChunk, idx) => (
                                                            <button
                                                                key={idx}
                                                                onClick={() => handleTextChunkClick(textChunk)}
                                                                className="flex-shrink-0 bg-[#f5f5f5] rounded-lg p-3 hover:bg-gray-100 transition-colors w-44"
                                                            >
                                                                <Tooltip placement="top" title={textChunk.document.name} >
                                                                    <div className="flex items-center space-x-2 mb-2">
                                                                        <span className="text-sm text-blue-500 truncate">{textChunk.document.name}</span>
                                                                    </div>
                                                                </Tooltip>
                                                                <div className="text-sm ">
                                                                    相关度: {(textChunk.score * 100).toFixed(0)}%
                                                                </div>
                                                            </button>
                                                        ))}
                                                </div>
                                            </div>)
                                        }
                                    </div>

                                </div>
                            </div>
                        ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="input-area">
                <div className="max-w-4xl mx-auto bg-[#f5f5f5] rounded-lg border border-gray-200 overflow-hidden">
                    {/* Text Input */}
                    <TextArea
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder={selectedAiOption.key === 1 ? `Ask ${APP_NAME} based on your resource` : `Message with ${APP_NAME}`}
                        autoSize={{ minRows: 2, maxRows: 2 }}
                        variant='borderless'
                        className='text-base'
                        onPressEnter={handleEnterPress}
                    />


                    {/* Controls */}
                    <div className="flex items-center justify-between pr-3 pl-1 py-2">

                        <div className="ai-option flex items-center ">
                            <Dropdown menu={{ items: aiOptions, onClick: handleAiOptionClick }} placement="topLeft">
                                <Button type="text" size="small" className='!pr-0'>{selectedAiOption.icon}</Button>
                            </Dropdown>

                            {/* resource */}
                            {
                                selectedAiOption.key === 1 && <Select
                                    mode="multiple"
                                    defaultValue={[]}
                                    placeholder="All Resources"
                                    variant="borderless"
                                    style={{ minWidth: '120px' }}
                                    options={connectionOption}
                                    onChange={(value) => setSelectedConnection(value)}
                                />
                            }

                        </div>


                        <Button type="primary" shape='circle' className={`hover:scale-110 transition-transform cursor-pointer ${askLoading && 'opacity-65'}`}
                            onClick={handleSend}>
                            {
                                askLoading ?
                                    searchLoading ? <TbDatabaseSearch size={20} /> : <CiPause1 size={20} />
                                    :
                                    <VscSend size={20} />
                            }
                        </Button>

                    </div>
                </div>
            </div>
        </div>
    );
};

export default ChatSection;