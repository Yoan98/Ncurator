import type * as LangChain from "@langchain/core/documents";
import { FullTextIndex } from '@src/utils/FullTextIndex';
import { LSHIndex } from '@src/utils/VectorIndex';
import { EmbedTaskManage } from '@src/utils/EmbedTask'
import type { EmbedTask } from '@src/utils/EmbedTask'
import * as math from 'mathjs';
import { FileConnector, CrawlerConnector } from '@src/utils/Connector';
import * as config from '@src/config';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import * as constant from '@src/utils/constant';
import dayjs from '@src/utils/dayjsGlobal';
import { message } from 'antd';
import type { GetChunksReturn } from '@src/utils/Connector'
import { t } from '@extension/i18n';

interface EmbeddingOutput {
    data: Float32Array,
    dims: [number, number]
}

// 提取要保存到数据库的chunk和要embedding的纯文本
export const transToTextList = (chunks: LangChain.Document[], documentId: number): [DB.TEXT_CHUNK[], string[][], number] => {
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
export const storageTextChunkToLSH = async ({ textChunkList, batchEmbeddingTextList, embeddingBatchSize, store,
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
    const lshIndexData: DB.LSH_INDEX = {
        table: LSHTables
    }
    const lshIndexId = await store.add({
        storeName: constant.LSH_INDEX_STORE_NAME,
        data: lshIndexData,
    });

    return lshIndexId as number
}
// 将大chunk数据构建全文搜索索引，并存储到indexDB
export const storageBigChunkToFullTextIndex = async ({ textChunkList, store }: {
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
export const buildIndexSplit = async ({ bigChunks, miniChunks, document, batchSize = config.BUILD_INDEX_CHUNKS_BATCH_SIZE, store }: {
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

        //todo embedding完后,会有一些ui卡顿,可能是这一块之后的执行时间过长,可考虑优化
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
interface BuildDocIndexReturn extends Result {
    connectionAfterIndexBuild?: DB.CONNECTION
    error?: Error
}
export const buildDocIndex = async ({ store, bigChunks, miniChunks, document, connection }: {
    store: IndexDBStore,
    bigChunks: LangChain.Document[],
    miniChunks: LangChain.Document[],
    connection: DB.CONNECTION,
    document: DB.DOCUMENT,
}): Promise<BuildDocIndexReturn> => {
    if (!bigChunks.length && !miniChunks.length) {
        throw new Error('no document content')
    }
    if (!connection) {
        throw new Error('no connection')
    }

    try {
        // 分批构建索引
        const chunkIndexRes = await buildIndexSplit({ bigChunks, miniChunks, document, store })

        // 保留只有将一个文档所有索引构建完,才认为这个doc构建成功,后期可基于文档无索引时,认定为失败
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
            error
        }

    }

}
// 删除某一个connection下的文档数据
export const removeDocumentsInConnection = async (store: IndexDBStore, removeDocList: DB.DOCUMENT[], connection: DB.CONNECTION) => {
    if (!removeDocList.length) { return { connectionAfterDelDoc: connection } }

    // 删除document的索引i以及resource(如果有的话)
    let delLshIndexIds: number[] = []
    let delFullTextIndexIds: number[] = []
    let delResourceIds: number[] = []
    removeDocList.forEach((doc) => {
        delLshIndexIds = delLshIndexIds.concat(doc.lsh_index_ids);
        delFullTextIndexIds = delFullTextIndexIds.concat(doc.full_text_index_ids);

        if (doc.connection.connector == constant.Connector.File && doc.resource) {
            delResourceIds.push(doc.resource.id)
        }
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
    // 删除resource
    if (delResourceIds.length) {
        await store.deleteBatch({
            storeName: constant.RESOURCE_STORE_NAME,
            keys: delResourceIds
        });
    }

    return {
        connectionAfterDelDoc: newConnection
    }
}
// 构建某一个connection下的新文档的索引
export const buildDocsIndexInConnection = async (store: IndexDBStore, docs: DB.DOCUMENT[], connection: DB.CONNECTION) => {
    let updatedConnection = connection;
    for (let doc of docs) {
        // 获取chunk数据
        let bigChunks: LangChain.Document[] = []
        let miniChunks: LangChain.Document[] = []
        let getChunkRes: GetChunksReturn
        if (connection.connector == constant.Connector.Crawl) {
            // 爬取网页数据生成chunk
            getChunkRes = await CrawlerConnector.getChunks({
                url: doc.link!,
                docName: doc.name
            });
        } else if (connection.connector == constant.Connector.File) {
            // resource表读取文件,将文件转成chunk
            const docResource = await store.get({
                storeName: constant.RESOURCE_STORE_NAME,
                key: doc.resource!.id
            })
            getChunkRes = await FileConnector.getChunks(docResource.file);
        } else {
            message.warning(`${doc.name} connector not supported`);
            console.error(`${doc.name} connector not supported, connector: ${connection.connector}`);
            continue;
        }

        if (getChunkRes.status == 'Fail') {
            console.error('getChunkRes error', getChunkRes.error)
            message.error(`${doc.name} Build Fail`);

            // 将该document状态置为fail
            await store.put({
                storeName: constant.DOCUMENT_STORE_NAME,
                data: {
                    ...doc,
                    status: constant.DocumentStatus.Fail
                }
            })
            continue;
        }

        bigChunks = getChunkRes.bigChunks!
        miniChunks = getChunkRes.miniChunks!

        // 向量化,并存储索引
        const buildDocIndexRes = await buildDocIndex({ store, bigChunks, miniChunks, document: doc, connection: updatedConnection }) as Storage.DocItemRes

        // 提示结果
        if (buildDocIndexRes.status == 'Success') {
            message.success(`${doc.name} ${t('build')} ${t('success')}`);
            updatedConnection = buildDocIndexRes.connectionAfterIndexBuild!;
        } else if (buildDocIndexRes.status == 'Fail') {
            console.error('buildDocIndex error', buildDocIndexRes.error)
            message.error(`${doc.name} ${t('build')} ${t('success')}`);
        } else {
            message.error(`${doc.name} Unknown Status`);
        }
    }
}
// 新增connector为file的为document并绑定到connection上
export const addFilesInConnection = async (store: IndexDBStore, addFileList: File[], connection: DB.CONNECTION) => {
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
export const addCrawlInConnection = async (store: IndexDBStore, crawlList: { name: string, link: string }[], connection: DB.CONNECTION) => {
    const docList: DB.DOCUMENT[] = []

    for (let crawlForm of crawlList) {
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
        docList.push(doc)
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
