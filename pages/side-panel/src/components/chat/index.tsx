import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Select, Button, Input, message, Dropdown, Empty, Modal } from 'antd';
import dayjs from '@src/utils/dayjsGlobal';
import { useGlobalContext } from '@src/provider/global';
import { searchDoc } from '@src/utils/search';
import { IoBookOutline, IoChatbubblesOutline } from "react-icons/io5";
import { APP_NAME } from '@src/utils/constant';
import { ChatLlmMessage } from '@src/utils/ChatLlmMessage';
import { VscSend } from "react-icons/vsc";
import { CiPause1 } from "react-icons/ci";
import { TbDatabaseSearch } from "react-icons/tb";
import Logo from '@src/components/logo';
import { Tab } from '@src/SidePanel';
import FileRender from '@src/components/fileRenders';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import { DEFAULT_INDEXDB_NAME, RESOURCE_STORE_NAME, Connector, MessageType } from '@src/utils/constant';
import type { FileRenderDocument } from '@src/components/fileRenders/index'
import { getSearchResMaxTextSize } from '@src/utils/tool';
import MessageList from '@src/components/chat/MessageList';




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
    activeTab,
    onHistoryUpdate
}: {
    activeTab: Tab;
    chatHistoryId: number;
    onHistoryUpdate: (localChatHistory: Chat.LocalHistory[]) => void;
}) => {
    const { connectionList, llmEngine, llmEngineLoadStatus } = useGlobalContext()

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatLlmMessageRef = useRef<ChatLlmMessage | null>(null);
    const indexDBRef = useRef<IndexDBStore | null>(null);

    const [chatUiMessages, setChatUiMessages] = useState<Chat.UiMessage[]>([]);

    const [connectionOption, setConnectionOption] = useState<{ label: string, value: number }[]>([]);
    const [selectedConnection, setSelectedConnection] = useState<number[]>([]);

    const [question, setQuestion] = useState("");
    const [selectedAiOption, setSelectedAiOption] = useState(aiOptions[0]);

    const [askLoading, setAskLoading] = useState(false);
    const [searchLoading, setSearchLoading] = useState(false);

    const [fileViewerOpen, setFileViewerOpen] = useState(false);
    const [fileRenderDocs, setFileRenderDocs] = useState<FileRenderDocument[]>([]);


    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const handleSend = async () => {
        if (!llmEngine.current || llmEngineLoadStatus !== 'success') {
            message.warning('AI engine is not ready.');
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

                const maxResTextSize = getSearchResMaxTextSize(llmEngine.current!)

                const res = await searchDoc({
                    question,
                    connections,
                    maxResTextSize
                }) as {
                    searchedRes: Search.TextItemRes[]
                }
                searchTextRes = res.searchedRes;
                // 去重文档数据
                const relateDocs = searchTextRes.filter((item, index, self) =>
                    index === self.findIndex((t) => (
                        t.document.id === item.document.id
                    ))
                )

                uiAssistantMessage.relateDocs = relateDocs;

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
            chatLocalHistory.unshift({
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

    const handleCancel = useCallback(() => {
        setFileViewerOpen(false)
    }, [fileViewerOpen])

    // message doc relate
    const handleRelateDocExpandClick = useCallback((message: Chat.UiMessage) => {
        message.isOpenRelateDocs = !message.isOpenRelateDocs;
        setChatUiMessages([...chatUiMessages]);
    }, [chatUiMessages])
    const handleTextChunkClick = useCallback(async (textChunk: Search.TextItemRes) => {
        const connector = textChunk.document.connection.connector;
        if (connector === Connector.Crawl) {
            window.open(textChunk.document.link, '_blank');
            return
        }
        // resource表读取文件
        const docResource: DB.RESOURCE = await indexDBRef.current!.get({
            storeName: RESOURCE_STORE_NAME,
            key: textChunk.document.resource!.id
        })
        const fileUrl = URL.createObjectURL(docResource.file);
        setFileViewerOpen(true);
        setFileRenderDocs([{
            uri: fileUrl,
            fileType: docResource.type,
            fileName: docResource.name,
            metadata: {
                pageNumber: textChunk.metadata?.loc.pageNumber || 1
            },
            file: docResource.file
        }]);
    }, [chatUiMessages])


    useEffect(() => {
        async function initIndexDB() {
            const store = new IndexDBStore();
            await store.connect(DEFAULT_INDEXDB_NAME);
            indexDBRef.current = store;
        }

        initIndexDB();
    }, []);

    useEffect(() => {
        if (!chatHistoryId) return

        fetchChatMessages(chatHistoryId);
        setTimeout(() => {
            scrollToBottom();
        });
    }, [chatHistoryId]);

    useEffect(() => {
        if (activeTab === 'chat') {
            scrollToBottom();
        }
    }, [activeTab])


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
                        : <MessageList
                            chatUiMessages={chatUiMessages}
                            onExpandClick={
                                handleRelateDocExpandClick
                            }
                            onTextChunkClick={
                                handleTextChunkClick
                            }
                        ></MessageList>
                }
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

            <FileRender open={fileViewerOpen} documents={fileRenderDocs} onCancel={handleCancel} />
        </div>
    );
};

export default ChatSection;