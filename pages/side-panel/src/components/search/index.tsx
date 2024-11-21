import { useState, useEffect, useRef } from 'react';
import { Select, Button, Input, message, Empty, Tooltip } from 'antd';
import { IoDocumentAttachOutline } from "react-icons/io5";
import { splitKeywords } from '@src/utils/tool';
import workerpool from 'workerpool';
import { useGlobalContext } from '@src/provider/global';
import TextHighlighter from '@src/components/highlighter';
import type {
    ChatCompletionMessageParam,
} from "@mlc-ai/web-llm";
import { EmbedTaskManage } from '@src/utils/EmbedTask'
import type { EmbedTask } from '@src/utils/EmbedTask'
import * as constant from '@src/utils/constant';
import * as config from '@src/config';
import { IndexDBStore } from '@src/utils/IndexDBStore';
// @ts-ignore
import searchWorkerURL from '@src/worker-pool/search?url&worker'



const searchingWorkerPool = workerpool.pool(searchWorkerURL, {
    maxWorkers: config.SEARCH_WORKER_NUM,
});
// 并行搜索
const searchParallel = async ({ store, storeName, workerMethod, question, connections, extraWorkerParam = [], maxGetStoreItemSize = config.SEARCH_INDEX_BATCH_SIZE }: {
    store: IndexDBStore,
    storeName: string,
    workerMethod: string,
    question: string | Float32Array,
    connections: DB.CONNECTION[],
    extraWorkerParam?: any[],
    // 每次次从表里取出的最大数据条数（避免数据过多，撑爆内存）
    maxGetStoreItemSize?: number
}) => {
    // 搜索结果汇总
    const searchedRes: any[] = []
    // 按照id范围搜索，避免取数据超出最大限制，待这一批搜索完结果，再取下一批数据搜索
    let hasRestData = true
    const indexKeyIds = workerMethod == 'searchLshIndex' ? connections.map((item) => item.lsh_index_ids).flat() : connections.map((item) => item.full_text_index_ids).flat()
    let startEndIndex = [0, maxGetStoreItemSize]

    while (hasRestData) {
        const sliceIndexKeyIds = indexKeyIds.slice(startEndIndex[0], startEndIndex[1])

        const indexList: (DB.LSH_INDEX | DB.FULL_TEXT_INDEX)[] = await store.getBatch({
            storeName,
            keys: sliceIndexKeyIds
        });


        if (!indexList.length) {
            hasRestData = false
            break
        }

        // 按cpu核数，分割出worker执行任务
        const searchTasks: workerpool.Promise<any, Error>[] = []
        // 一个worker执行的最大数量
        // 除2的原因，是因为会同时搜索向量索引表和全文索引表
        const singleSearchWorkerNumber = Math.max(1, Math.floor(config.SEARCH_WORKER_NUM / 2))
        const workerExecuteSize = Math.max(1, Math.floor(indexList.length / singleSearchWorkerNumber))

        for (let i = 0; i < indexList.length; i += workerExecuteSize) {
            const workerHandleData = indexList.slice(i, i + workerExecuteSize)
            searchTasks.push(searchingWorkerPool.exec(workerMethod, [question, workerHandleData, ...extraWorkerParam]))
        }

        // 等待所有worker执行完,并汇总结果
        const multipleSearchRes: (Search.LshItemRes | lunr.Index.Result)[][] = await Promise.all(searchTasks)

        const curSearchRes = multipleSearchRes.flat()
        searchedRes.push(...curSearchRes)

        // 清空
        indexList.length = 0

        // 下一批数据
        startEndIndex[0] = startEndIndex[1]
        startEndIndex[1] = startEndIndex[1] + maxGetStoreItemSize
    }



    return searchedRes
}
// 搜索文档
const searchDoc = async (question: string, connections: DB.CONNECTION[], k: number = 10) => {
    if (!question || !connections.length) {
        return {
            searchedRes: []
        }
    }


    console.time('total search')
    // 向量化句子
    const embeddingOutput = await new Promise((resolve: EmbedTask['resolve'], reject) => {
        EmbedTaskManage.subscribe({
            text: [question],
            prefix: constant.EncodePrefix.SearchDocument,
            resolve,
            reject
        }, 'search')
    })
    const queryVectorData = embeddingOutput.data

    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

    // 随机向量数据
    const localProjections = await store.get({
        storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
        key: constant.LSH_PROJECTION_KEY_VALUE
    })

    // 搜索向量索引表
    const searchLshIndex = async () => {
        console.time('searchLshIndex')
        const lshRes: Search.LshItemRes[] = await searchParallel({
            store,
            storeName: constant.LSH_INDEX_STORE_NAME,
            workerMethod: 'searchLshIndex',
            question: queryVectorData,
            connections,
            extraWorkerParam: [localProjections.data]
        })
        console.timeEnd('searchLshIndex')

        return lshRes

    }

    // 搜索全文索引表
    const searchFullTextIndex = async () => {
        console.time('searchFullTextIndex')
        const fullTextIndexRes: lunr.Index.Result[] = await searchParallel({
            store,
            storeName: constant.FULL_TEXT_INDEX_STORE_NAME,
            workerMethod: 'searchFullTextIndex',
            question,
            connections,
        })
        console.timeEnd('searchFullTextIndex')

        return fullTextIndexRes
    }
    console.time('search index total')
    // 同时搜索向量索引表和全文索引表
    let [lshRes, fullIndexRes] = await Promise.all([
        searchLshIndex(),
        searchFullTextIndex(),
    ]) as [Search.LshItemRes[], lunr.Index.Result[]]
    console.timeEnd('search index total')


    // 将全文索引排序，然后使用max归一化
    if (fullIndexRes.length) {
        fullIndexRes = fullIndexRes.sort((a, b) => b.score - a.score)
        const maxScore = fullIndexRes[0].score
        fullIndexRes = fullIndexRes.map((item) => {
            item.score = item.score / maxScore
            return item
        })
    }
    // 根据权重计算混合排序结果
    let mixRes: { id: number, score: number }[] = []
    const alreadyFullIndexIds: number[] = []
    const vectorWeight = config.SEARCHED_VECTOR_WEIGHT
    const fullTextWeight = config.SEARCHED_FULL_TEXT_WEIGHT
    lshRes.forEach((item) => {
        const sameIndex = fullIndexRes.findIndex((fullItem) => Number(fullItem.ref) === item.id)
        if (sameIndex === -1) {
            // 只有向量索引
            mixRes.push({
                id: item.id,
                score: item.similarity * vectorWeight,
            })
        } else {
            // 向量索引与全文索引同一个text_chunk id
            mixRes.push({
                id: item.id,
                score: (item.similarity * vectorWeight) + (fullTextWeight * fullIndexRes[sameIndex].score),
            })
            alreadyFullIndexIds.push(item.id)
        }
    })
    fullIndexRes.forEach((item) => {
        if (alreadyFullIndexIds.includes(Number(item.ref))) {
            return
        }
        mixRes.push({
            id: Number(item.ref),
            score: item.score * fullTextWeight,
        })
    })
    mixRes = mixRes.sort((a, b) => b.score - a.score)


    // text_chunk表查询结果
    let textChunkRes: DB.TEXT_CHUNK[] = await store.getBatch({
        storeName: constant.TEXT_CHUNK_STORE_NAME,
        keys: mixRes.map((item) => item.id)
    })
    // 过滤掉相同的文本,因为大小chunk的原因,导致有些小文本会重复
    textChunkRes = textChunkRes.filter((item, index, self) =>
        index === self.findIndex((t) => (
            t.text === item.text
        ))
    )
    textChunkRes = textChunkRes.slice(0, k)

    // 读取document表数据，并拼凑
    const documentRes: DB.DOCUMENT[] = []
    for (const item of textChunkRes) {
        const document = await store.get({
            storeName: constant.DOCUMENT_STORE_NAME,
            key: item.document_id
        })
        documentRes.push(document)
    }
    const searchedRes = textChunkRes.map((item) => {
        const document = documentRes.find((doc) => doc.id === item.document_id)
        return {
            ...item,
            document
        }
    })

    console.timeEnd('total search')

    console.log('Res', {
        lshRes,
        fullIndexRes,
        mixRes,
        searchedRes,
    })

    return {
        searchedRes
    }
}


const { TextArea } = Input;

const SearchSection = () => {
    const { connectionList, llmEngine } = useGlobalContext()

    const [questionValue, setQuestionValue] = useState('');
    const [questionKeywords, setQuestionKeywords] = useState<string[]>([]);

    const [connectionOption, setConnectionOption] = useState<{ label: string, value: number }[]>([]);
    const [selectedConnection, setSelectedConnection] = useState<number[]>([]);

    const [searchTextRes, setSearchTextRes] = useState<Search.TextItemRes[]>([]);

    const [searchLoading, setSearchLoading] = useState(false);
    const [askAiLoading, setAskAiLoading] = useState(false);

    const [aiAnswerText, setAiAnswerText] = useState<string>('');

    const askAI = async (searchTextRes: Search.TextItemRes[]) => {
        if (!llmEngine) {
            setAiAnswerText('AI engine is not ready,please setup your LLM Model');
            return;
        }

        const context = searchTextRes.map((item, index) => `Document${index + 1}: ${item.text}`).join('\n');

        const inp =
            "Use only the following context when answering the question at the end. Don't use any other knowledge. The documents below have been retrieved and sorted by relevance. Please use them in the order they are presented, with the most relevant ones first.\n" +
            context +
            "\n\nQuestion: " +
            questionValue +
            "\n\nHelpful Answer: ";

        const messages: ChatCompletionMessageParam[] = [
            {
                role: "system", content: "You are a helpful AI assistant.I will provide you with some relevant documents to help answer the question."
            },
            { role: "user", content: inp },
        ]
        console.log('ask Ai', messages)

        let curMessage = "";
        const reply = await llmEngine.chat.completions.create({
            stream: true,
            messages,
        });

        for await (const chunk of reply) {
            const curDelta = chunk.choices[0].delta.content;
            if (curDelta) {
                curMessage += curDelta;
            }

            setAiAnswerText(curMessage);
        }


    }


    const handleSearchClick = async () => {
        if (!questionValue) {
            message.warning('Please input the search content')
            return;
        };

        splitKeywords(questionValue).then((keywords) => {
            setQuestionKeywords(keywords);
        })

        setAskAiLoading(true);
        setSearchLoading(true);
        let searchTextRes
        // 搜索数据库的数据
        try {
            const connections = connectionList.filter((connection) => !selectedConnection.length ? true : selectedConnection.includes(connection.id!));

            const res = await searchDoc(questionValue, connections) as {
                searchedRes: Search.TextItemRes[]
            }
            searchTextRes = res.searchedRes || [];
            setSearchTextRes(searchTextRes);
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
                onChange={(e) => setQuestionValue(e.target.value)}
                placeholder="Search something based on the resource..."
                autoSize={{ minRows: 2 }}
                variant='borderless'
                className='text-base'
                onPressEnter={handleSearchClick}
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
                                            <TextHighlighter className="text-text-500 line-clamp-4 text-sm" text={item.text} keywords={questionKeywords} />
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