// 由于embedding过于占内存，只好将storageDoc抽出来
import * as tf from '@tensorflow/tfjs';
import { embedding } from '@src/utils/Embedding';
import { LSHIndex } from '@src/utils/VectorIndex';
import { fullTextIndex } from '@src/utils/FullTextIndex';
import * as constant from '@src/utils/constant';
import type * as langchain from "@langchain/core/documents";
import { IndexDBStore } from '@src/utils/IndexDBStore';
import { getIndexStoreName, checkWebGPU } from '@src/utils/tool';
import workerpool from 'workerpool';
// @ts-ignore
import WorkerURL from './embedding?url&worker'


let embeddingWorkerPool;
let embeddingWorkerNumber = 1
let maxEmbeddingBatchSize = 50
let isSupportWebGPU = false

interface EmbeddingOutput {
    embeddedSentences: Float32Array,
    shape: [number, number]
}

// 提取要保存到数据库的chunk和要embedding的纯文本
const transToTextList = (chunks: langchain.Document[], documentId: number): [DB.TEXT_CHUNK[], string[][], number] => {
    let cpuBatchSize = Math.max(1, Math.floor(chunks.length / embeddingWorkerNumber))

    // 限制embeddingBatchSize大小
    // 如果cpuBatchSize小于maxEmbeddingBatchSize,则使用cpuBatchSize(尽可能提高在cpu上的并行度)
    let embeddingBatchSize = isSupportWebGPU ?
        maxEmbeddingBatchSize : cpuBatchSize < maxEmbeddingBatchSize
            ? cpuBatchSize : maxEmbeddingBatchSize

    const pureTextList: string[][] = []
    const textChunkList: DB.TEXT_CHUNK[] = []
    // 将数据拆平均分成多份
    let temp: string[] = []
    for (let i = 0; i < chunks.length; i++) {
        // 截取纯文本,方便后续多worker并行处理
        temp.push(chunks[i].
            pageContent
        )
        if (temp.length === embeddingBatchSize) {
            pureTextList.push(temp)
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
        pureTextList.push(temp)
    }

    return [textChunkList, pureTextList, embeddingBatchSize]
}
// 将数据存入indexDB的LSH索引表
const storageTextChunkToLSH = async ({ textChunkList, pureTextList, embeddingBatchSize, store,
    connection
}: {
    textChunkList: DB.TEXT_CHUNK[],
    pureTextList: string[][],
    embeddingBatchSize: number,
    store: IndexDBStore,
    connection: DB.CONNECTION
}) => {

    if (!embeddingWorkerPool) {
        await initialEmbeddingWorkerPool()
    }

    // 多线程向量化句子
    console.time('embedding encode');
    console.log('pureTextList', pureTextList);

    const execTasks = pureTextList.map(item => {
        return embeddingWorkerPool.exec('embeddingText', [item])
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
    const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections: localProjections?.data, });
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
        storeName: getIndexStoreName(connection.connector, connection.id!, constant.LSH_INDEX_STORE_NAME),
        data: {
            lsh_table: LSHTables
        },
    });

    return lshIndexId as number
}
// 将大chunk数据构建全文搜索索引，并存储到indexDB
const storageBigChunkToFullTextIndex = async ({ textChunkList, store, connection }: {
    textChunkList: DB.TEXT_CHUNK[],
    store: IndexDBStore,
    connection: DB.CONNECTION
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
        storeName: getIndexStoreName(connection.connector, connection.id!, constant.FULL_TEXT_INDEX_STORE_NAME),
        data: {
            index: lunrIndex.toJSON()
        },
    });

    return fullTextIndexId as number
}


// 存储文档
// 后期如果碰到大文档,导致内存占用过高,可以考虑将文档分块存入indexDB,对于索引则要保证多个块依然存在同一条索引中
const storageDocument = async ({ bigChunks, miniChunks, resource, documentName, connection }: {
    bigChunks: langchain.Document[],
    miniChunks: langchain.Document[],
    resource?: File,
    documentName: string,
    connection: DB.CONNECTION
}) => {
    if (!bigChunks.length && !miniChunks.length) {
        throw new Error('no document content')
    }
    if (!documentName) {
        throw new Error('no document name')
    }
    if (!connection) {
        throw new Error('no connection')
    }


    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

    // 存入document表数据
    let document: DB.DOCUMENT = {
        name: documentName,
        text_chunk_id_range: {
            from: 0,
            to: 0
        },
        lsh_index_id: 0,
        full_text_index_id: 0,
        resource,
    }
    let documentId = await store.add({
        storeName: constant.DOCUMENT_STORE_NAME,
        data: document,
    });

    // 提取要保存到数据库的chunk和要embedding的纯文本
    let [textChunkList, pureTextList, embeddingBatchSize] = transToTextList(bigChunks.concat(miniChunks), documentId)

    // 将数据存入indexDB的text chunk表
    // 存入标后,会自动添加id到textChunkList里
    textChunkList = await store.addBatch<DB.TEXT_CHUNK>({
        storeName: getIndexStoreName(connection.connector, connection.id!, constant.TEXT_CHUNK_STORE_NAME),
        data: textChunkList,
    });

    // 将文本向量化后存入indexDB的LSH索引表
    const lshIndexId = await storageTextChunkToLSH({ textChunkList, pureTextList, embeddingBatchSize, store, connection });

    // 将大chunk数据构建全文搜索索引，并存储到indexDB
    const bigTextChunkList = textChunkList.slice(0, bigChunks.length)
    const fullTextIndexId = await storageBigChunkToFullTextIndex({ textChunkList: bigTextChunkList, store, connection })

    // 修改document表相应的索引与文本位置字段
    document = {
        ...document,
        id: documentId,
        text_chunk_id_range: {
            from: textChunkList[0].id!,
            to: textChunkList[textChunkList.length - 1].id!
        },
        lsh_index_id: lshIndexId,
        full_text_index_id: fullTextIndexId
    }
    await store.put({
        storeName: constant.DOCUMENT_STORE_NAME,
        data: document,
    });

    // 将document数据添加到connection表
    await store.put({
        storeName: constant.CONNECTION_STORE_NAME,
        data: {
            ...connection,
            id: connection.id,
            documents: connection.documents.concat({ id: documentId, name: documentName })
        },
    });

}

const initialEmbeddingWorkerPool = async (workerNumber = 1, maxEmbeddingBatchSize = 50) => {
    if (embeddingWorkerPool) {
        embeddingWorkerPool.terminate()
    }
    // 检测是否支持WebGPU
    isSupportWebGPU = await checkWebGPU()

    embeddingWorkerNumber = isSupportWebGPU ? 1 : workerNumber
    maxEmbeddingBatchSize = maxEmbeddingBatchSize
    embeddingWorkerPool = workerpool.pool(WorkerURL, {
        maxWorkers: workerNumber,
    });


}


// 测试相似度
const testSimilarity = async (text1, text2) => {
    await embedding.load()
    const similarity = await embedding.computeSimilarity(text1, text2)
    return similarity
}

workerpool.worker({
    storageDocument,
    initialEmbeddingWorkerPool,
    testSimilarity
});