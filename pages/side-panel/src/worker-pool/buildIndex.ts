// 由于embedding过于占内存，只好将storageDoc抽出来
import * as tf from '@tensorflow/tfjs';
import { embedding } from '@src/utils/Embedding';
import { LSHIndex } from '@src/utils/VectorIndex';
import { fullTextIndex } from '@src/utils/FullTextIndex';
import * as constant from '@src/utils/constant';
import * as config from '@src/config';
import type * as langchain from "@langchain/core/documents";
import { IndexDBStore } from '@src/utils/IndexDBStore';
import { checkWebGPU } from '@src/utils/tool';
import workerpool from 'workerpool';
// @ts-ignore
import WorkerURL from './embedding?url&worker'


let gEmbeddingWorkerPool;
let gEmbeddingWorkerNumber = config.BUILD_INDEX_EMBEDDING_WORKER_NUM
let gEmbeddingBatchSize = config.BUILD_INDEX_EMBEDDING_BATCH_SIZE
let gIsSupportWebGPU = false

interface EmbeddingOutput {
    embeddedSentences: Float32Array,
    shape: [number, number]
}

// 提取要保存到数据库的chunk和要embedding的纯文本
const transToTextList = (chunks: langchain.Document[], documentId: number): [DB.TEXT_CHUNK[], string[][], number] => {
    let cpuBatchSize = Math.max(1, Math.floor(chunks.length / gEmbeddingWorkerNumber))

    // 限制embeddingBatchSize大小
    // 如果cpuBatchSize小于maxEmbeddingBatchSize,则使用cpuBatchSize(尽可能提高在cpu上的并行度)
    let embeddingBatchSize = gIsSupportWebGPU ?
        gEmbeddingBatchSize : cpuBatchSize < gEmbeddingBatchSize
            ? cpuBatchSize : gEmbeddingBatchSize

    const batchEmbeddingTextList: string[][] = []
    const textChunkList: DB.TEXT_CHUNK[] = []
    // 将数据拆平均分成多份
    let temp: string[] = []
    for (let i = 0; i < chunks.length; i++) {
        // 截取纯文本,方便后续多worker并行处理
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
        return gEmbeddingWorkerPool.exec('embeddingText', [item, constant.EncodePrefix.SearchDocument])
    })
    const embeddingOutput: EmbeddingOutput[] = await Promise.all(execTasks)
    console.timeEnd('embedding encode');
    console.log('embeddingOutput', embeddingOutput);

    // 生成向量数组
    const vectors = textChunkList.map((chunk, index) => {
        const embeddingOutputIndex = Math.floor(index / embeddingBatchSize)
        const curVectorIndex = index % embeddingBatchSize

        const embeddingBlock = embeddingOutput[embeddingOutputIndex]
        const embeddingTensor = tf.tensor(embeddingBlock.embeddedSentences, embeddingBlock.shape) as tf.Tensor2D

        const vector = embeddingTensor.slice([curVectorIndex, 0], [1, -1]).reshape([-1]) as tf.Tensor1D
        embeddingTensor.dispose()

        return {
            id: chunk.id!,
            vector: vector,
        }
    });

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

    await fullTextIndex.loadLunr()
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
    const lunrIndex = fullTextIndex.add(fields, data)

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
    bigChunks: langchain.Document[],
    miniChunks: langchain.Document[],
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
        const curBatchChunks = chunks.slice(starEndIndex[0], starEndIndex[1])

        if (!curBatchChunks.length) {
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
const buildDocIndex = async ({ bigChunks, miniChunks, document, connection }: {
    bigChunks: langchain.Document[],
    miniChunks: langchain.Document[],
    connection: DB.CONNECTION,
    document: DB.DOCUMENT,
}) => {
    if (!bigChunks.length && !miniChunks.length) {
        throw new Error('no document content')
    }
    if (!connection) {
        throw new Error('no connection')
    }
    if (!gEmbeddingWorkerPool) {
        await initialEmbeddingWorkerPool()
    }

    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

    try {

        // 构建chunk索引
        const chunkIndexRes = await buildIndexSplit({ bigChunks, miniChunks, document, store })

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

const initialEmbeddingWorkerPool = async (workerNumber = config.BUILD_INDEX_EMBEDDING_WORKER_NUM, gEmbeddingBatchSize = config.BUILD_INDEX_EMBEDDING_BATCH_SIZE) => {
    if (gEmbeddingWorkerPool) {
        gEmbeddingWorkerPool.terminate()
    }
    // 检测是否支持WebGPU
    gIsSupportWebGPU = await checkWebGPU()

    gEmbeddingWorkerNumber = gIsSupportWebGPU ? 1 : workerNumber
    gEmbeddingBatchSize = gEmbeddingBatchSize
    gEmbeddingWorkerPool = workerpool.pool(WorkerURL, {
        maxWorkers: workerNumber,
    });


}


// 测试相似度
const testSimilarity = async (text1, text2) => {
    await embedding.load()
    const similarity = await embedding.computeSimilarity(text1, text2)
    return similarity
}
// 测试encode
const testEmbedding = async (texts: string[] | string) => {
    await embedding.load()
    const embeddingOutput = await embedding.encode(texts);

    const data = embeddingOutput.arraySync();

    console.log(data)
}

workerpool.worker({
    buildDocIndex,
    initialEmbeddingWorkerPool,
    testSimilarity,
    testEmbedding
});