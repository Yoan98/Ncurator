import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Collapse, Modal, message, Upload, Empty, Popconfirm, Spin, Table, Badge, Form, Select } from 'antd';
import { IoDocumentAttachOutline } from "react-icons/io5";
import type { CollapseProps, UploadFile, UploadProps, TableColumnsType, TableProps } from 'antd';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import * as constant from '@src/utils/constant';
import dayjs from 'dayjs';
import { FileConnector, CrawlerConnector } from '@src/utils/Connector';
import { IoSettingsOutline, IoReload } from "react-icons/io5";
import { useGlobalContext } from '@src/provider/global';
import type * as LangChain from "@langchain/core/documents";
import * as config from '@src/config';
import { FullTextIndex } from '@src/utils/FullTextIndex';
import { LSHIndex } from '@src/utils/VectorIndex';
import { EmbedTaskManage } from '@src/utils/EmbedTask'
import type { EmbedTask } from '@src/utils/EmbedTask'
import * as math from 'mathjs';
import { IoAdd } from "react-icons/io5";
import { MdDeleteOutline } from "react-icons/md";



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
    if (!removeDocList.length) { return { connectionAfterDelDoc: connection } }

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
        // 删除document的lsh索引
        await store.deleteBatch({
            storeName: constant.LSH_INDEX_STORE_NAME,
            keys: delLshIndexIds
        });
    }
    if (delFullTextIndexIds.length) {
        // 删除document的全文索引
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
        connectionAfterDelDoc: newConnection
    }
}
// 构建某一个connection下的新文档的索引
const buildDocsIndexInConnection = async (store: IndexDBStore, docs: DB.DOCUMENT[], connection: DB.CONNECTION) => {
    let updatedConnection = connection;
    for (let doc of docs) {
        // 获取chunk数据
        let bigChunks: LangChain.Document[] = []
        let miniChunks: LangChain.Document[] = []
        if (connection.connector == constant.Connector.Crawl) {
            // 爬取网页数据生成chunk
            const chunks = await CrawlerConnector.getChunks(doc.link!);
            bigChunks = chunks.bigChunks;
            miniChunks = chunks.miniChunks
        } else if (connection.connector == constant.Connector.File) {
            // resource表读取文件,将文件转成chunk
            const docResource = await store.get({
                storeName: constant.RESOURCE_STORE_NAME,
                key: doc.resource!.id
            })
            const chunks = await FileConnector.getChunks(docResource.file);
            bigChunks = chunks.bigChunks;
            miniChunks = chunks.miniChunks;
        } else {
            throw new Error('connector error')
        }

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
// 新增connector为file的为document并绑定到connection上
const addFilesInConnection = async (store: IndexDBStore, addFileList: File[], connection: DB.CONNECTION) => {
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
                name: connection.name,
                connector: connection.connector
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

    return { docs: addDocRes, connectionAfterAddDoc: newConnection };
}
// 新增connector为crawl的为document并绑定到connection上
const addCrawlInConnection = async (store: IndexDBStore, crawlForm: CrawlForm, connection: DB.CONNECTION) => {
    const doc: DB.DOCUMENT = {
        name: crawlForm.name,
        text_chunk_id_range: {
            from: 0,
            to: 0
        },
        lsh_index_ids: [],
        full_text_index_ids: [],
        link: crawlForm.link,
        created_at: dayjs().toISOString(),
        status: constant.DocumentStatus.Building,
        connection: {
            id: connection.id!,
            name: connection.name,
            connector: connection.connector
        }
    }
    const addedId = await store.add({
        storeName: constant.DOCUMENT_STORE_NAME,
        data: doc
    });
    doc.id = addedId;

    let newConnection = {
        ...connection,
        documents: connection.documents.concat({ id: addedId, name: crawlForm.name })
    }
    // 将document数据添加到connection表
    await store.put({
        storeName: constant.CONNECTION_STORE_NAME,
        data: newConnection,
    });

    return { doc: doc, connectionAfterAddDoc: newConnection };
}



const { Search } = Input;
const { Dragger } = Upload;
const { Option } = Select;

interface DataType {
    key: React.Key;
    name: string;
    created_at: string;
    status_text: string,
    status: DocumentStatusUnion,
}

const columns: TableColumnsType<DataType> = [
    {
        title: 'Name', dataIndex: 'name', ellipsis: {
            showTitle: true
        },
        width: '65%'
    },
    {
        title: 'Status', dataIndex: 'status', width: '35%', render: (text, record) => {

            const color = record.status == constant.DocumentStatus.Fail ? constant.ERROR_COLOR : record.status == constant.DocumentStatus.Success ? constant.SUCCESS_COLOR : 'gray';
            return <Badge color={color} text={record.status_text} />
        }
    },
];

interface EmbeddingOutput {
    data: Float32Array,
    dims: [number, number]
}
interface DisplayConnection extends DB.ConnectionDocUnion {
    selectedRowKeys: React.Key[]
}
interface ResourceForm {
    name: string
    connector: ConnectorUnion
}
interface CrawlForm {
    name: string
    link: string
}

const Resource = () => {
    const { connectionList, setConnectionList } = useGlobalContext()

    const indexDBRef = useRef<IndexDBStore | null>(null);

    // connection relate
    const [displayConnectionList, setDisplayConnectionList] = useState<DisplayConnection[]>([]);
    const [connectionListLoading, setConnectionListLoading] = useState(false);
    const [curConnection, setCurConnection] = useState<DB.ConnectionDocUnion | null>(null);

    const [collapseActiveKey, setCollapseActiveKey] = useState<number[]>([]);


    // upload relate
    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]); // 每个resource操作上传时的,最终上传文件列表
    const [uploadLoading, setUploadLoading] = useState(false);

    //crawler relate
    const [crawlModalOpen, setCrawlModalOpen] = useState(false);
    const [crawlLoading, setCrawlLoading] = useState(false);
    const [crawlScene, setCrawlScene] = useState<'edit' | 'add'>('add');
    const [crawlForm] = Form.useForm<CrawlForm>();

    //search relate
    const [searchValue, setSearchValue] = useState('');

    //delete relate
    const [delConfirmModalOpen, setDelConfirmModalOpen] = useState(false);
    const [delDocLoading, setDelDocLoading] = useState(false);

    //resource relate
    const [resourceForm] = Form.useForm<ResourceForm>();
    const [resourceScene, setResourceScene] = useState<'edit' | 'add'>('add');
    const [operateResourceLoading, setOperateResourceLoading] = useState(false);
    const [operateResourceModalOpen, setOperateResourceModalOpen] = useState(false);

    // 判断当前的connections是否存在build中的document,存在则不允许编辑
    // 因为indexdb更新数据整体更新,没办法只更新某一个字段
    const checkHasBuildingDocInConnection = (connectionId: number) => {
        const buildDoc = connectionList.find((item) => item.id == connectionId)!.documentList.find((doc) => doc.status == constant.DocumentStatus.Building)

        if (!buildDoc) {
            return false;
        }

        // 检查构建时间是否超过一定时间,超过则认为中途出问题了,可以让用户继续操作这个connection
        const buildTime = dayjs(buildDoc.created_at)
        const nowTime = dayjs()
        const diffMinutes = nowTime.diff(buildTime, 'minute')
        return diffMinutes < config.MAX_BUILDING_MINUTES
    }

    const genExtra = (displayConnection: DisplayConnection) => {

        const hasBuildingDoc = checkHasBuildingDocInConnection(displayConnection.id!);

        return <div className='flex items-center'>
            <div className="flex items-center gap-3">
                <IoAdd size={20} title={hasBuildingDoc ? 'Building document, please wait' : 'Add document'}
                    className={`${hasBuildingDoc && 'opacity-20'}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        if (hasBuildingDoc) {
                            return;
                        }
                        handleAddDocument(event, displayConnection.id!);
                    }}></IoAdd>
                <span>
                    <MdDeleteOutline className={`${(!displayConnection.selectedRowKeys.length || hasBuildingDoc) && 'opacity-20'}`} size={20} title={
                        hasBuildingDoc ? 'Building document, please wait' :
                            displayConnection.selectedRowKeys.length ? 'Delete batch data' : 'Please select data first'}
                        onClick={(event) => {
                            event.stopPropagation();
                            if (!displayConnection.selectedRowKeys.length || hasBuildingDoc) {
                                return;
                            }

                            const connection = connectionList.find((item) => item.id == displayConnection.id)!;
                            setCurConnection(connection);
                            setDelConfirmModalOpen(true);
                        }}
                    ></MdDeleteOutline>
                </span>

                <IoSettingsOutline
                    className={`${hasBuildingDoc && 'opacity-20'}`}
                    title={hasBuildingDoc ? 'Building document, please wait' : 'Edit Resource'}
                    size={20}
                    onClick={(event) => {
                        event.stopPropagation();
                        if (hasBuildingDoc) {
                            return;
                        }
                        handleEditResource(event, displayConnection.id!);
                    }}
                />

            </div>
        </div>
    }
    const CollapseItems: CollapseProps['items'] = displayConnectionList.map((item) => {
        const documentTableList = item.documentList.map((doc) => {
            const statusText = doc.status == constant.DocumentStatus.Fail ? 'Fail' : doc.status == constant.DocumentStatus.Success ? 'Success' : 'Building';
            return {
                key: doc.id!,
                name: doc.name,
                created_at: dayjs(doc.created_at).format('YYYY-MM-DD'),
                status: doc.status,
                status_text: statusText
            }
        })
        return {
            key: item.id,
            extra: genExtra(item),
            label: item.name,
            children:
                <Table<DataType> pagination={false} rowSelection={{
                    selectedRowKeys: item.selectedRowKeys,
                    onChange: (selectedRowKeys) => {
                        item.selectedRowKeys = selectedRowKeys;
                        setDisplayConnectionList([...displayConnectionList]);
                    }
                }} columns={columns} dataSource={documentTableList} />
            ,
            classNames: {
                header: 'text-base !items-center',
                body: '!p-1'
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
            setUploadFileList([...info.fileList]);
        },
    };

    const clearOldResourceOperate = () => {
        resourceForm.resetFields();
    }
    const fetchConnectionList = async () => {
        setConnectionListLoading(true);

        const store = indexDBRef.current!;
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
                disPlayConnectionList: connectionList.map((item) => ({ ...item, selectedRowKeys: [], })),
                collapseActiveKey: connectionList.map(item => item.id)
            }
        }
        const disPlayConnectionList = connectionList.map((connection) => {
            const newConnection = { ...connection, selectedRowKeys: [], };
            newConnection.documentList = connection.documentList.filter((doc) => doc.name.includes(value));
            return newConnection;
        }).filter((connection) => connection.documentList.length);
        const collapseActiveKey = disPlayConnectionList.length ? disPlayConnectionList.map(item => item.id!) : [];
        return { disPlayConnectionList, collapseActiveKey };
    }
    const checkHasBuildingDoc = () => {
        return connectionList.some((connection) => connection.documentList.some((doc) => doc.status == constant.DocumentStatus.Building))
    }
    const getPureConnection = (connection: DB.ConnectionDocUnion): DB.CONNECTION => {
        return {
            id: connection.id!,
            name: connection.name,
            connector: connection.connector,
            lsh_index_ids: connection.lsh_index_ids,
            full_text_index_ids: connection.full_text_index_ids,
            documents: connection.documents
        }
    }



    const handleCollapseChange = (key: string[]) => {
        setCollapseActiveKey(key.map((item) => Number(item)));
    }


    // 根据搜索值过滤connection的document列表
    const handleSearch = (value: string) => {
        const { disPlayConnectionList, collapseActiveKey } = getSearchedData(value, connectionList);
        setDisplayConnectionList(disPlayConnectionList);
        setCollapseActiveKey(collapseActiveKey as number[]);
    }

    // document add/del
    const handleDocDelConfirm = async (event) => {
        const hasBuildDoc = checkHasBuildingDocInConnection(curConnection!.id!);
        if (hasBuildDoc) {
            message.warning('Please wait for the document builded.');
            return;
        }

        setDelDocLoading(true);
        try {
            const store = indexDBRef.current!;
            const delDocIds = displayConnectionList.find((item) => item.id == curConnection!.id)!.selectedRowKeys as number[];
            const removeDocList = curConnection!.documentList.filter((doc) => delDocIds.includes(doc.id!));

            await removeDocumentsInConnection(store, removeDocList, getPureConnection(curConnection!));

            await fetchConnectionList();

            message.success('Delete Success');
        } catch (error) {
            console.error('handleDocDelConfirm error', error)
            message.error('Delete Error' + error);
        }

        setDelConfirmModalOpen(false);
        setDelDocLoading(false);
    }
    const handleAddDocument = async (event, connectionId: number) => {
        // 判断当前的connections是否存在build中的document,存在则不允许编辑
        // 因为indexdb更新数据整体更新,没办法只更新某一个字段
        const hasBuildDoc = checkHasBuildingDocInConnection(connectionId);
        if (hasBuildDoc) {
            message.warning('Please wait for the document builded.');
            return;
        }

        const connection = connectionList.find((item) => item.id == connectionId)!;

        const connector = connection.connector;
        if (connector == constant.Connector.Crawl) {
            setCrawlModalOpen(true);
            setCrawlScene('add');
            crawlForm.resetFields();
        } else if (connector == constant.Connector.File) {
            setUploadModalOpen(true);
            setUploadFileList([]);
        } else {
            message.error('connector error');
            throw new Error('connector error')
        }

        setCurConnection(connection)
    }
    const handleUploadConfirm = async () => {
        if (!uploadFileList.length) {
            message.warning('Please upload file');
            return;
        }
        setUploadLoading(true);

        try {
            const store = indexDBRef.current!;

            const fileList = uploadFileList.map((file) => file.originFileObj!);
            const { docs, connectionAfterAddDoc } = await addFilesInConnection(store, fileList, getPureConnection(curConnection!));

            buildDocsIndexInConnection(store, docs, connectionAfterAddDoc).then(() => {
                fetchConnectionList();
            }).catch((error) => {
                fetchConnectionList();
                throw error;
            });

            // 更新页面resource列表
            await fetchConnectionList();
        } catch (error) {
            console.error('handleUploadConfirm error', error)
            message.error('Upload Error' + error);
        }


        setUploadLoading(false);
        setUploadModalOpen(false);
    }
    const handleCrawlConfirm = async () => {
        const validRes = await crawlForm.validateFields()
        if (!validRes) {
            return;
        }

        setCrawlLoading(true);

        try {
            const store = indexDBRef.current!;
            const { doc, connectionAfterAddDoc } = await addCrawlInConnection(store, validRes, getPureConnection(curConnection!));

            buildDocsIndexInConnection(store, [doc], connectionAfterAddDoc).then(() => {
                fetchConnectionList();
            });

            // 更新页面resource列表
            await fetchConnectionList();
        } catch (error) {
            console.error('handleCrawlConfirm error', error)
            message.error('Crawl Error' + error);
        }

        setCrawlLoading(false);
        setCrawlModalOpen(false);
    }


    // resource add/edit
    const handleAddResource = () => {
        clearOldResourceOperate();

        setOperateResourceModalOpen(true);
        setResourceScene('add');
    }
    const handleEditResource = (event, connectionId) => {
        // 判断当前的connections是否存在build中的document,存在则不允许编辑
        // 因为indexdb更新数据整体更新,没办法只更新某一个字段
        const hasBuildDoc = checkHasBuildingDocInConnection(connectionId);
        if (hasBuildDoc) {
            message.warning('Please wait for the document builded.');
            return;
        }

        const connection = connectionList.find((item) => item.id == connectionId)!;

        clearOldResourceOperate();

        setCurConnection(connection);
        setOperateResourceModalOpen(true);
        setResourceScene('edit');
        resourceForm.setFieldsValue({ name: connection.name, connector: connection.connector });
    }
    const handleOperateResourceConfirm = async () => {
        const validRes = await resourceForm.validateFields()
        if (!validRes) {
            return;
        }

        setOperateResourceLoading(true);

        try {
            const store = indexDBRef.current!;
            if (resourceScene == 'add') {
                // 数据库新增
                // 新增connection
                const connectionData: DB.CONNECTION = {
                    name: validRes.name,
                    connector: validRes.connector,
                    lsh_index_ids: [],
                    full_text_index_ids: [],
                    documents: []
                }


                await store.add({
                    storeName: constant.CONNECTION_STORE_NAME,
                    data: connectionData
                })
            } else if (resourceScene == 'edit') {
                // 数据库编辑
                const newConnection: DB.ConnectionDocUnion = {
                    ...curConnection!,
                    name: validRes.name,
                }

                await store.put({
                    storeName: constant.CONNECTION_STORE_NAME,
                    data: getPureConnection(newConnection)
                })
            }

            await fetchConnectionList();
            message.success(resourceScene === 'add' ? 'Add Resource Success' : 'Edit Resource Success');
        } catch (error) {
            console.error('handleOperateResourceConfirm error', error)
            message.error('Operation Error' + error);
        }

        setOperateResourceLoading(false);
        setOperateResourceModalOpen(false);
    }

    useEffect(() => {
        async function initIndexDB() {
            const store = new IndexDBStore();
            await store.connect(constant.DEFAULT_INDEXDB_NAME);
            indexDBRef.current = store;
        }

        initIndexDB().then(() => {
            fetchConnectionList()
        });


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

            {/* File add */}
            <Modal confirmLoading={uploadLoading} cancelButtonProps={{ loading: uploadLoading }} maskClosable={false} centered title='Upload File' open={uploadModalOpen} onOk={handleUploadConfirm} onCancel={() => { setUploadModalOpen(false) }}>

                <Dragger  {...uploadProps} fileList={uploadFileList} >
                    <p className="ant-upload-text">Click or drag file to this area</p>
                    <p className="ant-upload-hint">
                        All the data will be storage in your local database
                    </p>
                </Dragger>
            </Modal>

            {/* resource add/edit */}
            <Modal confirmLoading={operateResourceLoading} cancelButtonProps={{ loading: operateResourceLoading }} maskClosable={false} centered title={resourceScene == 'add' ? 'Add Resource' : 'Edit Resource'} open={operateResourceModalOpen} onOk={handleOperateResourceConfirm} onCancel={() => { setOperateResourceModalOpen(false) }}>
                <Form
                    form={resourceForm}
                    name="resource"
                    layout="vertical"
                >
                    <Form.Item label="Resource Name" name="name" rules={[{ required: true }]}>
                        <Input placeholder='A descriptive name for the resource.' />
                    </Form.Item>
                    <Form.Item
                        layout="vertical"
                        label="Resource Type"
                        name="connector"
                        rules={[{ required: true }]}
                    >
                        <Select disabled={resourceScene === 'edit'} placeholder="Select resource type">
                            <Option value={1}>File</Option>
                            <Option value={2}>Web Crawl</Option>
                        </Select>
                    </Form.Item>
                </Form>
            </Modal>

            {/* crawl add/edit */}
            <Modal confirmLoading={crawlLoading} cancelButtonProps={{ loading: crawlLoading }} maskClosable={false} centered title={crawlScene == 'add' ? 'Add Web Crawl' : 'Edit Web Crawl'} open={crawlModalOpen} onOk={handleCrawlConfirm} onCancel={() => { setCrawlModalOpen(false) }}>
                <Form
                    form={crawlForm}
                    name="name"
                    layout="vertical"
                >
                    <Form.Item label="Web Name" name="name" rules={[{ required: true }]}>
                        <Input placeholder='A descriptive name for the web.' />
                    </Form.Item>
                    <Form.Item
                        layout="vertical"
                        label="Url"
                        name="link"
                        rules={[{ required: true }]}
                    >
                        <Input placeholder='The web url' />
                    </Form.Item>
                </Form>
            </Modal>

            {/* del Modal */}
            <Modal
                title="Delete Confirm"
                centered
                open={delConfirmModalOpen}
                confirmLoading={delDocLoading} cancelButtonProps={{ loading: delDocLoading }}
                onOk={handleDocDelConfirm}
                onCancel={() => { setDelConfirmModalOpen(false) }}

            >
                <p>Are you sure to delete these items?</p>

            </Modal>
        </div>
    );
}

export default Resource;