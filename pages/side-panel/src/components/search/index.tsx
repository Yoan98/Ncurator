import { useState, useEffect, useRef } from 'react';
import { Select, Button, Input, message, Empty, Tooltip } from 'antd';
import { IoDocumentAttachOutline } from "react-icons/io5";
import { IndexDBStore } from '@src/utils/IndexDBStore';
import * as constant from '@src/utils/constant';
import type { Pool } from 'workerpool';
import workerpool from 'workerpool';
//@ts-ignore
import searchWorkerURL from '@src/worker-pool/searchDoc?url&worker'
import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { useGlobalContext } from '@src/provider/global';
import TextHighlighter from '@src/components/highlighter';

const { TextArea } = Input;


const SearchSection = ({
    llmEngine,
}: {
    llmEngine: WebWorkerMLCEngine | null
}) => {
    const [questionValue, setQuestionValue] = useState('');

    const [connectionOption, setConnectionOption] = useState<{ label: string, value: number }[]>([]);
    const { connectionList } = useGlobalContext()
    const [selectedConnection, setSelectedConnection] = useState<number[]>([]);

    const [searchTextRes, setSearchTextRes] = useState<Search.TextItemRes[]>([]);

    const [searchLoading, setSearchLoading] = useState(false);
    const [askAiLoading, setAskAiLoading] = useState(false);

    const [aiAnswerText, setAiAnswerText] = useState<string>('');

    const searchPoolRef = useRef<Pool>();

    const askAI = async (searchTextRes: Search.TextItemRes[]) => {
        if (!llmEngine) {
            setAiAnswerText('AI engine is not ready,please setup your LLM Model');
            return;
        }


        const messages = [
            { role: "system", content: "You are a helpful AI assistant." },
            { role: "user", content: "Hello!" },
        ]
        console.log('ask Ai')
        const reply = await llmEngine.chat.completions.create({
            //@ts-ignore
            messages,
        });
        console.log('reply', reply)

        const replyText = reply.choices[0].message.content;

        setAiAnswerText(replyText || 'Error in AI answer');
    }
    const handleSearchClick = async () => {
        if (!questionValue) {
            message.warning('Please input the search content')
            return;
        };

        setAskAiLoading(true);
        setSearchLoading(true);
        // 搜索数据库的数据
        try {
            const connections = connectionList.filter((connection) => !selectedConnection.length ? true : selectedConnection.includes(connection.id!));

            const res = await searchPoolRef.current?.exec('search', [questionValue, connections]) as {
                searchedRes: Search.TextItemRes[]
            }
            setSearchTextRes(res.searchedRes || []);
        } catch (error) {
            console.error(error);
            message.error('Error in search');
        }
        setSearchLoading(false);


        // 搜索AI的数据
        try {
            await askAI(searchTextRes);

        } catch (error) {
            console.error(error);
            message.error('Error in AI answer');
        }

        setAskAiLoading(false);

    }

    useEffect(() => {
        // 加载search worker
        searchPoolRef.current = workerpool.pool(searchWorkerURL, {
            maxWorkers: 1,
        });

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

    return (<div className='search-section'>
        <div className="input bg-background-100 flex   flex-col   border   border-border-medium rounded-lg p-1">
            <TextArea
                value={questionValue}
                onChange={(e) => setQuestionValue(e.target.value)}
                placeholder="Search something based on the resource..."
                autoSize={{ minRows: 2 }}
                variant='borderless'
                className='text-base'
            />

            <div className="input-filter flex items-center justify-between  pr-2 pl-1 py-2">

                <Select
                    mode="multiple"
                    defaultValue={[]}
                    placeholder="All Resources"
                    variant="borderless"
                    style={{ maxWidth: '250px', minWidth: '120px' }}
                    options={connectionOption}
                    onChange={(value) => setSelectedConnection(value)}
                />

                <Button loading={searchLoading} type="primary" shape='circle' size="small" className='hover:scale-110 transition-transform' onClick={handleSearchClick}>Go</Button>
            </div>
        </div>

        <div className="ai-answer my-4 p-4 border-2 border-border rounded-lg relative">
            <div className="flex gap-x-2">
                <h2 className="text-emphasis font-bold my-auto mb-1 text-base">AI Answer</h2>
            </div>

            <div className="pt-1 border-t border-border w-full min-h-[100px] max-h-[100px] overflow-y-auto">
                {
                    askAiLoading ? <div className='text-sm loading-text'>Searching...</div> : <div className="text-sm">{aiAnswerText}</div>

                }

            </div>
        </div>

        <div className="result">
            <div className="font-bold flex justify-between text-emphasis border-b mb-3 pb-1 text-lg"><p>Results</p></div>
            <div className="search-res-list overflow-y-auto ">
                {
                    searchLoading ? <div className='text-sm loading-text'>Searching...</div> :
                        searchTextRes.length === 0 ? <Empty /> :
                            searchTextRes.map((item) => {
                                return (
                                    <div key={item.id} className="res-item text-sm border-b transition-all duration-500 pt-3 relative" >
                                        <div className="flex relative items-center gap-1 cursor-pointer">
                                            <IoDocumentAttachOutline size={25} />
                                            <Tooltip placement="top" title={item.document.name} >
                                                <p className="truncate text-wrap break-all my-auto line-clamp-1 text-base max-w-full font-bold text-blue-500">{item.document.name}</p>
                                            </Tooltip>
                                        </div>
                                        <div className='pl-1 pt-2 pb-3'>
                                            <TextHighlighter className="text-text-500 line-clamp-4 text-sm" text={item.text} keyword={questionValue} />
                                        </div>
                                    </div>
                                )
                            })
                }
            </div>
        </div>
    </div>);
}


export default SearchSection;