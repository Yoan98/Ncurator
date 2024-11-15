import { useState, useEffect, useRef } from 'react';
import { Select, Button, Input, message, Empty } from 'antd';
import { IoDocumentAttachOutline } from "react-icons/io5";
import { IndexDBStore } from '@src/utils/IndexDBStore';
import * as constant from '@src/utils/constant';
import type { Pool } from 'workerpool';
import workerpool from 'workerpool';
//@ts-ignore
// import searchWorkerURL from '@src/worker-pool/searchDoc?url&worker'
import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm';

const { TextArea } = Input;


const SearchSection = ({
    llmEngine,
}: {
    llmEngine: WebWorkerMLCEngine | null
}) => {
    const [questionValue, setQuestionValue] = useState('');
    const [resource, setResource] = useState<{ label: string, value: number }[]>([]);
    const [selectedResource, setSelectedResource] = useState<number[]>([]);
    const [searchTextRes, setSearchTextRes] = useState<Search.TextItemRes[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [askAiLoading, setAskAiLoading] = useState(false);
    const [aiAnswerText, setAiAnswerText] = useState<string>('');

    const searchPoolRef = useRef<Pool>();
    const connectionsRef = useRef<DB.CONNECTION[]>([]);

    const initResource = async () => {
        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);
        const connections = await store.getAll({
            storeName: constant.CONNECTION_STORE_NAME,
        }) as DB.CONNECTION[];
        const resource = connections.map((connection) => ({ label: connection.name, value: connection.id! }));

        connectionsRef.current = connections;

        setResource(resource);
    }
    const askAI = async (searchTextRes: Search.TextItemRes[]) => {
        if (!llmEngine) {
            setAiAnswerText('AI engine is not ready,please setup your LLM Model');
            return;
        }


        const messages = [
            { role: "system", content: "You are a helpful AI assistant." },
            { role: "user", content: "Hello!" },
        ]

        const reply = await llmEngine.chat.completions.create({
            //@ts-ignore
            messages,
        });

        const replyText = reply.choices[0].message.content;

        setAiAnswerText(replyText || 'Error in AI answer');
    }
    const handleSearchClick = async () => {
        if (!questionValue) {
            message.warning('Please input the search content')
            return;
        };

        // 搜索数据库的数据
        try {
            setSearchLoading(true);
            const connections = connectionsRef.current.filter((connection) => selectedResource.includes(connection.id!));
            const res = await searchPoolRef.current?.exec('search', [questionValue, connections]) as {
                searchedRes: Search.TextItemRes[]
            }
            setSearchTextRes(res.searchedRes || []);
        } catch (error) {
        }
        setSearchLoading(false);

        // 搜索AI的数据
        try {
            setAskAiLoading(true);
            await askAI(searchTextRes);
        } catch (error) {
        }
        setAskAiLoading(false);
    }

    useEffect(() => {
        // 从indexDB中获取connection数据
        initResource();

        // 加载search worker
        // searchPoolRef.current = workerpool.pool(searchWorkerURL, {
        //     maxWorkers: 1,
        // });
    }, []);

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
                    options={resource}
                    onChange={(value) => setSelectedResource(value)}
                />

                <Button loading={searchLoading} type="primary" shape='circle' size="small" className='hover:scale-110 transition-transform' onClick={handleSearchClick}>Go</Button>
            </div>
        </div>

        <div className="ai-answer my-4 p-4 border-2 border-border rounded-lg relative">
            <div className="flex gap-x-2">
                <h2 className="text-emphasis font-bold my-auto mb-1 text-base">AI Answer</h2>
            </div>

            <div className="pt-1 h-auto border-t border-border w-full min-h-[100px]">
                {
                    askAiLoading ? <div className='text-sm loading-text'>Searching...</div> : <div>{aiAnswerText}</div>

                }

            </div>
        </div>

        <div className="result">
            <div className="font-bold flex justify-between text-emphasis border-b mb-3 pb-1 border-border text-lg"><p>Results</p></div>
            <div className="res-list">
                {
                    searchLoading ? <div className='text-sm loading-text'>Searching...</div> :
                        searchTextRes.length === 0 ? <Empty /> :
                            searchTextRes.map((item) => {
                                return (
                                    <div key={item.id} className="res-item text-sm border-b border-border transition-all duration-500 pt-3 relative" >
                                        <div className="flex relative items-center gap-1 cursor-pointer">
                                            <IoDocumentAttachOutline size={20} />
                                            <p className="truncate text-wrap break-all my-auto line-clamp-1 text-base max-w-full font-bold text-blue-500">{item.document.name}</p>
                                        </div>
                                        <div className='pl-1 pt-2 pb-3'>
                                            <p className="text-text-500 line-clamp-4" >{item.text}</p>
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