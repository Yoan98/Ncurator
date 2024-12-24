import { useState, useEffect, useRef, useCallback } from 'react';
import { Select, Button, Input, message, Empty } from 'antd';
import { IoDocumentAttachOutline } from "react-icons/io5";
import { getSearchResMaxTextSize } from '@src/utils/tool';
import { searchDoc } from '@src/utils/search';
import { useGlobalContext } from '@src/provider/global';
import TextHighlighter from '@src/components/highlighter';
import { ChatLlmMessage } from '@src/utils/ChatLlmMessage';
import { VscSend } from "react-icons/vsc";
import FileRender from '@src/components/fileRenders';
import type { FileRenderDocument } from '@src/components/fileRenders/index'
import { IndexDBStore } from '@src/utils/IndexDBStore';
import { RESOURCE_STORE_NAME, DEFAULT_INDEXDB_NAME, Connector } from '@src/utils/constant';
import { t } from '@extension/i18n';
import init, * as jieba from 'jieba-wasm';
import { ZH_STOP_WORDS, EN_STOP_WORDS } from '@src/utils/constant';



// 分割关键词,英文按照空格,中文按照jieba分词
async function splitKeywords(keywords: string) {
    //@ts-ignore
    await init()
    const reg = new RegExp("[\\u4E00-\\u9FFF]+");
    if (reg.test(keywords)) {
        return jieba.cut_for_search(keywords).filter(word => !ZH_STOP_WORDS.includes(word)) as string[];
    } else {
        const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
        const segments = Array.from(segmenter.segment(keywords));
        const words = segments.map(segment => segment.segment).filter(word => !EN_STOP_WORDS.includes(word.toLowerCase()));

        return words;
    }
}

const { TextArea } = Input;

const SearchSection = () => {
    const { connectionList, llmEngine, llmEngineLoadStatus } = useGlobalContext()

    const indexDBRef = useRef<IndexDBStore | null>(null);

    const [questionValue, setQuestionValue] = useState('');
    const [questionKeywords, setQuestionKeywords] = useState<string[]>([]);

    const [connectionOption, setConnectionOption] = useState<{ label: string, value: number }[]>([]);
    const [selectedConnection, setSelectedConnection] = useState<number[]>([]);

    const [searchTextRes, setSearchTextRes] = useState<Search.TextItemRes[]>([]);

    const [searchLoading, setSearchLoading] = useState(false);
    const [askAiLoading, setAskAiLoading] = useState(false);

    const [aiAnswerText, setAiAnswerText] = useState<string>('');

    const [fileViewerOpen, setFileViewerOpen] = useState(false);
    const [fileRenderDocs, setFileRenderDocs] = useState<FileRenderDocument[]>([]);

    const askAI = async (searchTextRes: Search.TextItemRes[]) => {
        if (!llmEngine.current || llmEngineLoadStatus !== 'success') {
            message.warning(t('ai_engine_not_ready'));
            return;
        }

        const chat = new ChatLlmMessage({
            responseStyle: 'text'
        });

        await chat.sendMsg({
            prompt: questionValue,
            type: 'knowledge',
            searchTextRes,
            streamCb: (msg, finish_reason) => {
                let text = msg + '⚫';
                if (finish_reason == 'stop') {
                    text = msg;
                }
                setAiAnswerText(text);
            },
            llmEngine: llmEngine.current
        })

    }

    const handleTextChunkClick = async (textChunk: Search.TextItemRes) => {
        const connector = textChunk.document.connection.connector;
        if (connector === Connector.Crawl) {
            window.open(textChunk.document.link, '_blank');
            return
        }

        // file
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
    }
    const handleSearchClick = async () => {
        if (!questionValue) {
            message.warning(t('please_input_search'))
            return;
        };
        if (!llmEngine.current || llmEngineLoadStatus !== 'success') {
            message.warning(t('ai_engine_not_ready'));
            return;
        }

        splitKeywords(questionValue).then((keywords) => {
            setQuestionKeywords(keywords);
        })

        setAiAnswerText('⚫');
        setAskAiLoading(true);
        setSearchLoading(true);
        let searchTextRes
        // 搜索数据库的数据
        try {
            const connections = connectionList.filter((connection) => !selectedConnection.length ? true : selectedConnection.includes(connection.id!));

            const maxResTextSize = getSearchResMaxTextSize(llmEngine.current!)

            const res = await searchDoc({
                question: questionValue,
                connections,
                maxResTextSize
            }) as {
                searchedRes: Search.TextItemRes[]
            }
            searchTextRes = res.searchedRes || [];
            setSearchTextRes(searchTextRes);
        } catch (error) {
            console.error(error);
            message.error('Error in search' + error);
        }
        setSearchLoading(false);


        // 搜索AI的数据
        try {
            await askAI(searchTextRes);

        } catch (error) {
            console.error(error);
            message.error('Error in AI answer' + error);
        }

        setAskAiLoading(false);
    }
    const handleEnterPress = (e) => {
        // 避免shift+enter换行
        if (e.shiftKey) {
            return;
        }
        e.preventDefault();
        handleSearchClick();
    };
    const handleCancel = useCallback(() => {
        setFileViewerOpen(false)
    }
        , [])

    useEffect(() => {
        async function initIndexDB() {
            const store = new IndexDBStore();
            await store.connect(DEFAULT_INDEXDB_NAME);
            indexDBRef.current = store;
        }

        initIndexDB();
    }, []);

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

    // 更新关键词
    useEffect(() => {
        if (!questionValue) {
            setQuestionKeywords([]);
            return;
        }

    }, [questionValue])

    return (<div className='search-section'>
        <div className="input bg-background-100 flex   flex-col   border   border-border-medium rounded-lg p-1">
            <TextArea
                value={questionValue}
                onChange={(e) => setQuestionValue(e.target.value || '')}
                placeholder={t('search_placeholder')}
                autoSize={{ minRows: 2, maxRows: 2 }}
                variant='borderless'
                className='text-base'
                onPressEnter={handleEnterPress}
            />

            <div className="input-filter flex items-center justify-between  pr-2 pl-1 py-2">

                <Select
                    mode="multiple"
                    defaultValue={[]}
                    placeholder={t('all_resource')}
                    variant="borderless"
                    style={{ maxWidth: '250px', minWidth: '120px' }}
                    options={connectionOption}
                    onChange={(value) => setSelectedConnection(value)}
                />

                <Button loading={askAiLoading} icon={<VscSend size={20} />} type="primary" shape='circle' className='hover:scale-110 transition-transform' onClick={handleSearchClick}></Button>
            </div>
        </div>

        <div className="ai-answer my-4 p-4 border-2 border-border rounded-lg relative">
            <div className="flex gap-x-2">
                <h2 className="text-emphasis font-bold my-auto mb-1 text-base">{t('all_answer')}</h2>
            </div>

            <div className="pt-1 border-t border-border w-full min-h-[150px] max-h-[100px] overflow-y-auto">
                {
                    searchLoading ? <div className='text-sm loading-text'>{t('searching')}</div> : <div className="text-base">{aiAnswerText}</div>

                }

            </div>
        </div>

        <div className="result">
            <div className="font-bold flex justify-between text-emphasis border-b mb-3 pb-1 text-lg"><p>{t('results')}</p></div>
            <div className="search-res-list overflow-y-auto ">
                {
                    searchLoading ? <div className='text-sm loading-text'>{t('searching')}</div> :
                        searchTextRes.length === 0 ? <Empty /> :
                            searchTextRes.map((item) => {
                                return (
                                    <div key={item.id} className="res-item text-sm border-b transition-all duration-500 pt-3 relative" >
                                        <div className="flex relative items-center gap-1 cursor-pointer" onClick={() => handleTextChunkClick(item)}>
                                            <IoDocumentAttachOutline size={25} />
                                            <p className="truncate text-wrap break-all my-auto line-clamp-1 text-base max-w-full font-bold text-blue-500">{item.document.name}</p>
                                        </div>
                                        <div className='pl-1 pt-2 pb-3'>
                                            <TextHighlighter className="text-text-500 line-clamp-4 text-sm" text={item.text} keywords={questionKeywords} />
                                        </div>
                                    </div>
                                )
                            })
                }
            </div>
        </div>

        <FileRender open={fileViewerOpen} documents={fileRenderDocs} onCancel={handleCancel} />
    </div>);
}


export default SearchSection;