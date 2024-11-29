import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Collapse, Modal, message, Upload, Empty, Tooltip, Popconfirm } from 'antd';
import { IoDocumentAttachOutline } from "react-icons/io5";
import type { CollapseProps, UploadFile, UploadProps } from 'antd';
import { formatFileSize } from '@src/utils/tool';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import * as constant from '@src/utils/constant';
import dayjs from 'dayjs';
import { FileConnector } from '@src/utils/Connector';
import { IoSettingsOutline, IoReload } from "react-icons/io5";
import { useGlobalContext } from '@src/provider/global';
import type * as LangChain from "@langchain/core/documents";
import * as config from '@src/config';
import { FullTextIndex } from '@src/utils/FullTextIndex';
import { LSHIndex } from '@src/utils/VectorIndex';
import { EmbedTaskManage } from '@src/utils/EmbedTask'
import type { EmbedTask } from '@src/utils/EmbedTask'
import * as math from 'mathjs';

const { Search } = Input;
const { Dragger } = Upload;

interface EmbeddingOutput {
    data: Float32Array,
    dims: [number, number]
}


// 提取要保存到数据库的chunk和要embedding的纯文本
const transToTextList = (chunks: LangChain.Document[], documentId: number): [DB.TEXT_CHUNK[], string[][], number] => {
    // 限制embeddingBatchSize大小
    let embeddingBatchSize = config.BUILD_INDEX_EMBEDDING_BATCH_SIZE

    const batchEmbeddingTextList: string[][] = []
    const textChunkList: DB.TEXT_CHUNK[] = []
    // 将数据拆平均分成多份
    let temp: string[] = []
    for (let i = 0; i < chunks.length; i++) {
        // 截取纯文本,方便后续embedding分片处理
        temp.push(chunks[i].
            pageContent
        )
        if (temp.length === embeddingBatchSize) {
            batchEmbeddingTextList.push(temp)
            temp = []
        }

        // 保存textChunkList
        const chunk = chunks[i]
        const textChunk: DB.TEXT_CHUNK = {
            text: chunk.pageContent,
            metadata: {
                loc: {
                    lines: {
                        from: chunk.metadata.loc.lines.from,
                        to: chunk.metadata.loc.lines.to
                    },
                    pageNumber: chunk.metadata.loc.pageNumber
                }
            },
            document_id: documentId
        }
        textChunkList.push(textChunk)
    }
    if (temp.length) {
        batchEmbeddingTextList.push(temp)
    }

    return [textChunkList, batchEmbeddingTextList, embeddingBatchSize]
}
// 将数据存入indexDB的LSH索引表
const storageTextChunkToLSH = async ({ textChunkList, batchEmbeddingTextList, embeddingBatchSize, store,
}: {
    textChunkList: DB.TEXT_CHUNK[],
    batchEmbeddingTextList: string[][],
    embeddingBatchSize: number,
    store: IndexDBStore,
}) => {

    // 多线程向量化句子
    console.time('embedding encode');
    console.log('batchEmbeddingTextList', batchEmbeddingTextList);
    const execTasks = batchEmbeddingTextList.map(item => {
        return new Promise((resolve: EmbedTask['resolve'], reject) => {
            EmbedTaskManage.subscribe({
                text: item,
                prefix: constant.EncodePrefix.SearchDocument,
                resolve,
                reject
            }, 'build')
        })
    })

    const embeddingOutput: EmbeddingOutput[] = await Promise.all(execTasks)
    console.timeEnd('embedding encode');
    console.log('embeddingOutput', embeddingOutput);

    // 生成向量数组
    const vectors = textChunkList.map((chunk, index) => {
        const embeddingOutputIndex = Math.floor(index / embeddingBatchSize)
        const curVectorIndex = index % embeddingBatchSize

        let embeddingBlock = embeddingOutput[embeddingOutputIndex]

        // 重塑矩阵的维度
        //@ts-ignore 这里mathjs的类型检查有问题
        const reshapedMatrix = math.reshape(Array.from(embeddingBlock.data), embeddingBlock.dims) as number[][]
        const vector = reshapedMatrix[curVectorIndex]

        //@ts-ignore
        embeddingBlock = null


        return {
            id: chunk.id!,
            vector: vector,
        }
    });
    embeddingOutput.length = 0

    // * 构建索引
    // 获取库中是否已有LSH随机向量
    const localProjections: DB.LSH_PROJECTION | undefined = await store.get({
        storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
        key: constant.LSH_PROJECTION_KEY_VALUE,
    })
    // 初始化LSH索引
    const lshIndex = new LSHIndex({ dimensions: config.EMBEDDING_HIDDEN_SIZE, localProjections: localProjections?.data, });
    // 如果库中没有LSH随机向量，则将其存储到库中
    if (!localProjections) {
        await store.add({
            storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
            data: {
                [constant.LSH_PROJECTION_DATA_NAME]: lshIndex.projections
            },
        });
    }

    // 将LSH索引存储到indexDB
    const LSHTables = await lshIndex.addVectors(vectors);
    const lshIndexId = await store.add({
        storeName: constant.LSH_INDEX_STORE_NAME,
        data: {
            lsh_table: LSHTables
        },
    });

    return lshIndexId as number
}
// 将大chunk数据构建全文搜索索引，并存储到indexDB
const storageBigChunkToFullTextIndex = async ({ textChunkList, store }: {
    textChunkList: DB.TEXT_CHUNK[],
    store: IndexDBStore,
}) => {

    await FullTextIndex.loadJieBa()
    const fields = [{
        field: 'text'
    }]
    const data = textChunkList.map(item => {
        return {
            id: item.id!,
            text: item.text
        }
    }
    )
    const lunrIndex = FullTextIndex.add(fields, data)

    const fullTextIndexId = await store.add({
        storeName: constant.FULL_TEXT_INDEX_STORE_NAME,
        data: {
            index: lunrIndex.toJSON()
        },
    });

    return fullTextIndexId as number
}

// 分块构建索引,避免大文本高内存
const buildIndexSplit = async ({ bigChunks, miniChunks, document, batchSize = config.BUILD_INDEX_CHUNKS_BATCH_SIZE, store }: {
    bigChunks: LangChain.Document[],
    miniChunks: LangChain.Document[],
    document: DB.DOCUMENT,
    batchSize?: number,
    store: IndexDBStore
}) => {

    const starEndIndex = [0, batchSize]
    let hasEnd = false

    let lshIndexIds: number[] = []
    let fullIndexIds: number[] = []

    // 所有批次的最小与最大text_chunk id
    let minMaxTextChunkIds: number[] = []

    let chunks = bigChunks.concat(miniChunks)
    let bigChunksMaxIndex = bigChunks.length - 1
    while (!hasEnd) {
        console.log('total chunks', chunks.length);
        console.log('starEndIndex', starEndIndex);
        const curBatchChunks = chunks.slice(starEndIndex[0], starEndIndex[1])

        if (!curBatchChunks.length) {
            console.log('no curBatchChunks');
            hasEnd = true
            break
        }

        // 提取要保存到数据库的chunk和要embedding的纯文本
        let [textChunkList, batchEmbeddingTextList, embeddingBatchSize] = transToTextList(curBatchChunks, document.id!)
        curBatchChunks.length = 0

        // 将数据存入indexDB的text chunk表
        // 存入标后,会自动添加id到textChunkList里
        textChunkList = await store.addBatch<DB.TEXT_CHUNK>({
            storeName: constant.TEXT_CHUNK_STORE_NAME,
            data: textChunkList,
        });

        // 将文本向量化后存入indexDB的LSH索引表
        const lshIndexId = await storageTextChunkToLSH({ textChunkList, batchEmbeddingTextList, embeddingBatchSize, store });
        lshIndexIds.push(lshIndexId)
        batchEmbeddingTextList.length = 0

        // 将大chunk数据构建全文搜索索引，并存储到indexDB
        if (starEndIndex[1] - 1 <= bigChunksMaxIndex) {
            // 当前处理的批次,还在大chunk范围内
            const fullTextIndexId = await storageBigChunkToFullTextIndex({ textChunkList, store })
            fullIndexIds.push(fullTextIndexId)
        } else if (starEndIndex[0] <= bigChunksMaxIndex && starEndIndex[1] - 1 > bigChunksMaxIndex) {
            // 当前处理的批次,左边是大chunk，右边是小chunk,即过了大小chunk的边界
            const textChunkListBigPart = textChunkList.slice(0, bigChunksMaxIndex - starEndIndex[0] + 1)
            const fullTextIndexId = await storageBigChunkToFullTextIndex({ textChunkList: textChunkListBigPart, store })
            fullIndexIds.push(fullTextIndexId)
        }

        starEndIndex[0] = starEndIndex[1]
        starEndIndex[1] = starEndIndex[1] + batchSize

        const curBatchTextChunkRangeIds = [textChunkList[0].id!, textChunkList[textChunkList.length - 1].id!]
        minMaxTextChunkIds = minMaxTextChunkIds.concat(curBatchTextChunkRangeIds)

        textChunkList.length = 0
    }

    return {
        lshIndexIds,
        fullIndexIds,
        minMaxTextChunkIds
    }
}

// 构建document的索引并存储
const buildDocIndex = async ({ store, bigChunks, miniChunks, document, connection }: {
    store: IndexDBStore,
    bigChunks: LangChain.Document[],
    miniChunks: LangChain.Document[],
    connection: DB.CONNECTION,
    document: DB.DOCUMENT,
}) => {
    if (!bigChunks.length && !miniChunks.length) {
        throw new Error('no document content')
    }
    if (!connection) {
        throw new Error('no connection')
    }

    try {
        // 分批构建索引
        const chunkIndexRes = await buildIndexSplit({ bigChunks, miniChunks, document, store })

        // TODO:将对应索引数据保存操作都放入分片处理中,尽量降低中途阻断后去删除时,部分数据无法删除
        // 修改document表相应的索引与文本位置字段
        const textChunkIdRange = chunkIndexRes.minMaxTextChunkIds
        document = {
            ...document,
            text_chunk_id_range: {
                from: textChunkIdRange[0],
                to: textChunkIdRange[textChunkIdRange.length - 1]!
            },
            lsh_index_ids: chunkIndexRes.lshIndexIds,
            full_text_index_ids: chunkIndexRes.fullIndexIds,
            status: constant.DocumentStatus.Success
        }
        await store.put({
            storeName: constant.DOCUMENT_STORE_NAME,
            data: document,
        });

        const connectionAfterIndexBuild = {
            ...connection,
            id: connection.id,
            lsh_index_ids: connection.lsh_index_ids.concat(chunkIndexRes.lshIndexIds),
            full_text_index_ids: connection.full_text_index_ids.concat(chunkIndexRes.fullIndexIds)
        }
        // 将索引信息添加到connection表
        await store.put({
            storeName: constant.CONNECTION_STORE_NAME,
            data: connectionAfterIndexBuild,
        });

        return {
            status: 'Success',
            document,
            connectionAfterIndexBuild
        }
    } catch (error) {
        // 如果出错,则将document状态改为fail
        await store.put({
            storeName: constant.DOCUMENT_STORE_NAME,
            data: {
                ...document,
                status: constant.DocumentStatus.Fail
            },
        });
        return {
            status: 'Fail',
            document,
            error
        }

    }

}
// 删除某一个connection下的文档数据
const removeDocumentsInConnection = async (store: IndexDBStore, removeDocList: DB.DOCUMENT[], connection: DB.CONNECTION) => {
    if (!removeDocList.length) { return { connectionAfterDel: connection } }

    // 删除document的索引id
    let delLshIndexIds: number[] = []
    let delFullTextIndexIds: number[] = []
    removeDocList.forEach((doc) => {
        delLshIndexIds = delLshIndexIds.concat(doc.lsh_index_ids);
        delFullTextIndexIds = delFullTextIndexIds.concat(doc.full_text_index_ids);
    })

    // 删除connection中的document
    const newConnection: DB.CONNECTION = {
        ...connection,
        id: connection.id!,
        documents: connection.documents.filter((oldDoc) => !removeDocList.some((doc) => oldDoc.id == doc.id)),
        lsh_index_ids: connection.lsh_index_ids.filter((id) => !delLshIndexIds.includes(id)),
        full_text_index_ids: connection.full_text_index_ids.filter((id) => !delFullTextIndexIds.includes(id))
    }
    await store.put({
        storeName: constant.CONNECTION_STORE_NAME,
        data: newConnection,
    });
    // 删除document
    await store.deleteBatch({
        storeName: constant.DOCUMENT_STORE_NAME,
        keys: removeDocList.map((doc) => doc.id!)
    });
    // 删除索引
    if (delLshIndexIds.length) {
        // 删除document的索引
        await store.deleteBatch({
            storeName: constant.LSH_INDEX_STORE_NAME,
            keys: delLshIndexIds
        });
    }
    if (delFullTextIndexIds.length) {
        // 删除document的索引
        await store.deleteBatch({
            storeName: constant.FULL_TEXT_INDEX_STORE_NAME,
            keys: delFullTextIndexIds
        });
    }
    // 删除text chunk

    for (let doc of removeDocList) {
        const range = IDBKeyRange.bound(doc.text_chunk_id_range.from, doc.text_chunk_id_range.to);
        await store.delete({
            storeName: constant.TEXT_CHUNK_STORE_NAME,
            key: range
        });
    }

    return {
        connectionAfterDel: newConnection
    }
}
// 构建某一个connection下的新文档的索引
const buildDocsIndexInConnection = async (store: IndexDBStore, docs: DB.DOCUMENT[], connection: DB.CONNECTION) => {
    const fileConnector = new FileConnector();

    let updatedConnection = connection;
    for (let doc of docs) {
        // resource表读取文件
        const docResource = await store.get({
            storeName: constant.RESOURCE_STORE_NAME,
            key: doc.resource!.id
        })

        const { bigChunks, miniChunks } = await fileConnector.getChunks(docResource.file);

        if (!bigChunks.length && !miniChunks.length) {
            message.warning(`${doc.name} no content`);
            // 将该document状态置为fail
            await store.put({
                storeName: constant.DOCUMENT_STORE_NAME,
                data: {
                    ...doc,
                    status: constant.DocumentStatus.Fail
                }
            });
            continue;
        }

        // 向量化,并存储索引
        const buildDocIndexRes = await buildDocIndex({ store, bigChunks, miniChunks, document: doc, connection: updatedConnection }) as Storage.DocItemRes

        // 提示结果
        if (buildDocIndexRes.status == 'Success') {
            message.success(`${doc.name} Storage Success`);
            updatedConnection = buildDocIndexRes.connectionAfterIndexBuild!;
        } else if (buildDocIndexRes.status == 'Fail') {
            console.error('buildDocIndex error', buildDocIndexRes.error)
            message.error(`${doc.name} Storage Fail`);
        } else {
            message.error(`${doc.name} Unknown Status`);
        }
    }
}
// 新增某一个connection下文档数据到数据库
const addDocumentsInConnection = async (store: IndexDBStore, addFileList: File[], connection: DB.CONNECTION) => {
    // 遍历文件,存储文档
    const docList: DB.DOCUMENT[] = [];
    for (let file of addFileList) {
        // 存储文件,并获得文件id
        const docResource: DB.RESOURCE = {
            file: file,
            name: file.name,
            type: file.name.split('.').pop()!.toLowerCase() || '',
            size: file.size,
            created_at: dayjs().toISOString()
        }
        const docResourceId = await store.add({
            storeName: constant.RESOURCE_STORE_NAME,
            data: docResource
        });

        // 存储最基础的document
        const doc: DB.DOCUMENT = {
            name: file.name,
            text_chunk_id_range: {
                from: 0,
                to: 0
            },
            lsh_index_ids: [],
            full_text_index_ids: [],
            resource: {
                id: docResourceId,
                size: docResource.size,
                type: docResource.type,
            },
            created_at: dayjs().toISOString(),
            status: constant.DocumentStatus.Building,
            connection: {
                id: connection.id!,
                name: connection.name
            }
        }
        docList.push(doc);
    }

    const addDocRes = await store.addBatch({
        storeName: constant.DOCUMENT_STORE_NAME,
        data: docList
    });
    let newConnection = {
        ...connection,
        documents: connection.documents.concat(addDocRes.map((doc) => ({ id: doc.id!, name: doc.name }))
        )
    }
    // 将document数据添加到connection表
    await store.put({
        storeName: constant.CONNECTION_STORE_NAME,
        data: newConnection,
    });

    return { docs: addDocRes, connectionAfterAdd: newConnection };
}


const DocumentItem = ({ data, onDeleteClick }: {
    data: {
        name: string,
        size: string,
        created_at: string,
        status: DocumentStatusUnion,
        delLoading?: boolean
    },
    onDeleteClick: () => void
}) => {
    const statusText = data.status == constant.DocumentStatus.Fail ? 'Fail' : data.status == constant.DocumentStatus.Success ? 'Success' : 'Building';
    const statusClass = data.status == constant.DocumentStatus.Fail ? 'text-text-error' : data.status == constant.DocumentStatus.Success ? 'text-text-success' : '';
    return (
        <div className='flex gap-1 items-center'>
            <Tooltip placement="top" title={data.name} >
                <div className='truncate cursor-pointer font-bold w-[50%]'>{data.name}</div>
            </Tooltip>
            <Tooltip placement="top" title={`Create Time: ${data.created_at}`}>
                <div className='text-text-500 cursor-pointer w-[25%]'>{data.size}</div>
            </Tooltip>
            <Popconfirm
                title="Delete the document"
                description="Are you sure to delete this document?"
                onConfirm={onDeleteClick}
                okText="Yes"
                cancelText="No"
                placement='bottom'
            >
                <Tooltip placement="top" title='Click to delete' >
                    <Button loading={data.delLoading} type="text" className={`w-[25%] ${statusClass}`} >
                        {statusText}
                    </Button>
                </Tooltip>
            </Popconfirm>
        </div>
    )
}

const Resource = () => {
    const { connectionList, setConnectionList } = useGlobalContext()

    const addedFileListRef = useRef<UploadFile[]>([]);
    const removedFileListRef = useRef<UploadFile[]>([]);

    const [displayConnectionList, setDisplayConnectionList] = useState<DB.ConnectionDocUnion[]>([]);
    const [connectionListLoading, setConnectionListLoading] = useState(false);
    const [collapseActiveKey, setCollapseActiveKey] = useState<number[]>([]);

    const [resourceName, setResourceName] = useState('');
    const [curConnection, setCurConnection] = useState<DB.ConnectionDocUnion | null>(null);

    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [uploadScene, setUploadScene] = useState<'edit' | 'add'>('add');
    const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]); // 每个resource操作上传时的,最终上传文件列表
    const [uploadLoading, setUploadLoading] = useState(false);

    const [searchValue, setSearchValue] = useState('');

    const genExtra = (connectionId, count) => (

        <div className='flex items-center gap-2'>
            <div className='text-sm'>Count: {count}</div>
            <IoSettingsOutline
                title='Setting file'
                size={20}
                onClick={(event) => {
                    handleEditResource(event, connectionId);
                }}
            />
        </div>
    );
    const CollapseItems: CollapseProps['items'] = displayConnectionList.map((item) => {
        return {
            key: item.id,
            extra: genExtra(item.id, item.documentList.length),
            label: item.name,
            children: item.documentList.map((doc) => {
                const size = formatFileSize(doc.resource!.size);
                const created_at = dayjs(doc.created_at).format('YYYY-MM-DD');
                return <DocumentItem key={doc.id} data={{ name: doc.name, size, created_at, status: doc.status }} onDeleteClick={() => { handleDocDelClick(item.id!, doc.id!) }} />
            }),
            classNames: {
                header: 'text-base !items-center'
            }
        }
    })

    const uploadProps: UploadProps = {
        multiple: true,
        accept: '.pdf,.doc,.docx,.txt,.md',
        beforeUpload: (file) => {
            return false
        },
        onChange(info) {
            // 上传文件列表变化时,记录新增和删除的文件
            if (info.file.status === 'removed') {
                // 根据删除的文件id是否可转成nubmer,判断是否是存在数据库的文件
                if (!isNaN(Number(info.file.uid))) {
                    removedFileListRef.current.push(info.file);
                } else {
                    // 不存在,则这次手动操作的是新增的文件,需要删除掉,避免最终添加到数据库
                    addedFileListRef.current = addedFileListRef.current.filter((item) => item.uid != info.file.uid);
                }
            } else {
                // 每次手动添加的,都理解为是需要添加到数据库的文件
                // 由于beforeUpload返回false,所以无法用status为done来判断是否上传成功,且会没有originFileObj,但fileList中有
                // 所以为了保持类型一致,从fileList取一遍
                // 所以除了删除的文件,其他的都是手动添加的文件
                const addFile = info.fileList.find((file) => file.uid == info.file.uid)!;
                addedFileListRef.current.push(addFile);
            }

            setUploadFileList([...info.fileList]);
        },
    };

    const clearOldResourceOperate = () => {
        setResourceName('');
        setUploadFileList([]);
        addedFileListRef.current = [];
        removedFileListRef.current = [];

    }
    const fetchConnectionList = async () => {
        setConnectionListLoading(true);

        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);
        const connections = await store.getAll({
            storeName: constant.CONNECTION_STORE_NAME,
        }) as DB.CONNECTION[];
        // 根据connection获取document列表
        const connectionList: DB.ConnectionDocUnion[] = await Promise.all(connections.map(async (connection) => {
            const documents = await store.getBatch({
                storeName: constant.DOCUMENT_STORE_NAME,
                keys: connection.documents.map((doc) => doc.id!)
            }) as DB.DOCUMENT[];
            return { ...connection, documentList: documents }
        })
        )

        setConnectionList(connectionList);
        setTimeout(() => {
            setConnectionListLoading(false);
        }, 1000)
    }
    const getSearchedData = (value: string, connectionList: DB.ConnectionDocUnion[]) => {
        if (!value) {
            return {
                disPlayConnectionList: [...connectionList],
                collapseActiveKey: connectionList.map(item => item.id)
            }
        }
        const disPlayConnectionList = connectionList.map((connection) => {
            const newConnection = { ...connection };
            newConnection.documentList = connection.documentList.filter((doc) => doc.name.includes(value));
            return newConnection;
        }).filter((connection) => connection.documentList.length);
        const collapseActiveKey = disPlayConnectionList.length ? disPlayConnectionList.map(item => item.id!) : [];
        return { disPlayConnectionList, collapseActiveKey };
    }
    const checkHasBuildingDoc = () => {
        return connectionList.some((connection) => connection.documentList.some((doc) => doc.status == constant.DocumentStatus.Building))
    }


    const handleCollapseChange = (key: string[]) => {
        setCollapseActiveKey(key.map((item) => Number(item)));
    }
    const handleUploadConfirm = async () => {
        if (!resourceName) {
            message.warning('Please input resource name');
            return;
        }
        setUploadLoading(true);

        try {
            const store = new IndexDBStore();
            await store.connect(constant.DEFAULT_INDEXDB_NAME);

            if (uploadScene == 'add') {
                // 新增connection
                const connectionData: DB.CONNECTION = {
                    name: resourceName,
                    connector: constant.Connector.File,
                    lsh_index_ids: [],
                    full_text_index_ids: [],
                    documents: []
                }
                const connectionId = await store.add({
                    storeName: constant.CONNECTION_STORE_NAME,
                    data: connectionData
                })
                connectionData.id = connectionId;

                const fileList = uploadFileList.map((file) => file.originFileObj!);

                const { docs, connectionAfterAdd } = await addDocumentsInConnection(store, fileList, connectionData);
                // 单独worker构建文档索引
                buildDocsIndexInConnection(store, docs, connectionAfterAdd).then(() => {
                    fetchConnectionList();
                });

            } else {
                // 编辑connection
                const pureConnection: DB.CONNECTION & { documentList?: DB.DOCUMENT[] } = { ...curConnection!, name: resourceName };
                delete pureConnection.documentList;

                let newConnection = pureConnection;

                // 更新connection名称
                await store.put({
                    storeName: constant.CONNECTION_STORE_NAME,
                    data: newConnection
                });

                // 删除文档
                const removeFileList = removedFileListRef.current;
                if (removeFileList.length) {
                    const connectionDocList = curConnection!.documentList;
                    const removeDocList = connectionDocList.filter((doc) => removeFileList.some((file) => file.uid == doc.id!.toString()));

                    const removeRes = await removeDocumentsInConnection(store, removeDocList, pureConnection!);
                    newConnection = removeRes.connectionAfterDel;
                }

                // 新增文档
                const addedFileList = addedFileListRef.current;
                if (addedFileList.length) {
                    const fileList = addedFileList.map((file) => file.originFileObj!);

                    const { docs, connectionAfterAdd } = await addDocumentsInConnection(store, fileList, newConnection);
                    newConnection = connectionAfterAdd;

                    // 单独worker构建文档索引
                    buildDocsIndexInConnection(store, docs, connectionAfterAdd).then(() => {
                        fetchConnectionList();
                    });
                }

            }

            // 更新页面resource列表
            await fetchConnectionList();

            message.success('Operation Success');

        } catch (error) {
            console.error('handleUploadConfirm error', error)
            message.error('Unknown Error');
        }

        setUploadLoading(false);
        setUploadModalOpen(false);
    }
    // 根据搜索值过滤connection的document列表
    const handleSearch = (value: string) => {
        const { disPlayConnectionList, collapseActiveKey } = getSearchedData(value, connectionList);
        setDisplayConnectionList(disPlayConnectionList);
        setCollapseActiveKey(collapseActiveKey as number[]);
    }
    const handleAddResource = () => {
        clearOldResourceOperate();

        setUploadModalOpen(true);
        setUploadScene('add');
    }
    const handleDocDelClick = async (connectionId: number, docId: number) => {
        // 设置connection的document状态为删除中
        const newConnectionList = connectionList.map((connection) => {
            if (connection.id == connectionId) {
                connection.documentList = connection.documentList.map((doc) => {
                    if (doc.id == docId) {
                        return { ...doc, delLoading: true }
                    }
                    return doc;
                })
            }
            return connection;
        }
        )
        setConnectionList(newConnectionList);


        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);

        const document = await store.get({
            storeName: constant.DOCUMENT_STORE_NAME,
            key: docId
        }) as DB.DOCUMENT;
        // 判断文档的创建时间,当状态为building时,只有超过半小时才能删除
        if (document.status == constant.DocumentStatus.Building) {
            const now = dayjs();
            const created_at = dayjs(document.created_at);
            const diff = now.diff(created_at, 'minute');
            if (diff < 30) {
                message.warning(`The document is building in ${diff} minutes, only after 30 minutes can be deleted`);
                return;
            }
        }

        const connection = await store.get({
            storeName: constant.CONNECTION_STORE_NAME,
            key: connectionId
        }) as DB.CONNECTION;


        await removeDocumentsInConnection(store, [document], connection);

        await fetchConnectionList();

        message.success('Delete success');
    }
    const handleEditResource = (event, connectionId) => {
        event.stopPropagation();

        // 判断当前的connections是否存在build中的document,存在则不允许编辑
        const connection = connectionList.find((item) => item.id == connectionId)!;
        const hasBuildDoc = connection.documentList.some((doc) => doc.status == constant.DocumentStatus.Building);
        if (hasBuildDoc) {
            message.warning('Please wait for the document to build, or hover over the document status to delete');
            return;
        }

        clearOldResourceOperate();

        setCurConnection(connection);
        setUploadModalOpen(true);
        setUploadScene('edit');
        setResourceName(connection.name);

        const uploadFileList = connection.documentList.map((doc) => {
            return {
                uid: doc.id!.toString(),
                name: doc.name,
                originFileObj: doc.resource as UploadFile['originFileObj'],
            }
        }
        )
        setUploadFileList(uploadFileList);
    }

    useEffect(() => {
        fetchConnectionList();
    }, [])

    useEffect(() => {
        if (!connectionList.length) {
            return;
        }

        const { disPlayConnectionList, collapseActiveKey } = getSearchedData(searchValue, connectionList);
        setDisplayConnectionList(disPlayConnectionList);
        setCollapseActiveKey(collapseActiveKey as number[]);
    }, [connectionList, searchValue])

    return (
        <div className='resource pt-2 flex flex-col flex-1'>
            <div className="title flex items-center justify-between border-b">
                <div className='flex items-center  gap-1 py-5'>
                    <IoDocumentAttachOutline size={25} />
                    <span className='text-lg font-bold'>Resource</span>

                </div>

                <div className="flex items-center gap-3">
                    <IoReload size={18} className={`cursor-pointer ${connectionListLoading ? 'animate-spin' : ''} `} onClick={fetchConnectionList} />
                    <Button type="primary" onClick={handleAddResource}>Add Resource</Button>
                </div>
            </div>

            <div className="search pt-5  my-1">
                <Search className='text-base' placeholder="Search file name..." onSearch={handleSearch} onChange={(e) => {
                    setSearchValue(e.target.value);
                }} enterButton size="large" />
                {
                    <div className={`text-right text-xs text-text-500 ${checkHasBuildingDoc() ? 'visible' : 'invisible'}`}>Document is building, please don't close App before finish</div>
                }
            </div>


            <div className="resource-list flex-1 flex flex-col overflow-y-auto">

                {
                    !displayConnectionList.length ? <div className='flex flex-1 flex-col justify-center'> <Empty description='No resource yet' /></div> : <Collapse
                        activeKey={collapseActiveKey}
                        onChange={handleCollapseChange}
                        expandIconPosition='start'
                        items={CollapseItems}
                    />
                }
            </div>

            <Modal confirmLoading={uploadLoading} cancelButtonProps={{ loading: uploadLoading }} maskClosable={false} centered title={uploadScene == 'add' ? 'Add Resource' : 'Edit Resource'} open={uploadModalOpen} onOk={handleUploadConfirm} onCancel={() => { setUploadModalOpen(false) }}>
                <div>
                    Resource Name
                </div>


                <Input placeholder='A descriptive name for the resource.' className='my-2' value={resourceName} onChange={(e) => {
                    setResourceName(e.target.value);
                }} />

                <Dragger  {...uploadProps} fileList={uploadFileList} >
                    <p className="ant-upload-text">Click or drag file to this area</p>
                    <p className="ant-upload-hint">
                        All the data will be storage in your local database
                    </p>
                </Dragger>
            </Modal>
        </div>
    );
}

export default Resource;