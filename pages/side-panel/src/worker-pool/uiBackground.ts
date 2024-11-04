import { embedding, constant, LSHIndex, IndexDBStore, tf } from '@extension/shared';
import type { DB, langchainDocuments } from '@extension/shared'
import workerpool from 'workerpool';
// @ts-ignore
import WorkerURL from './calculation?url&worker'

const embeddingWorkerPool = workerpool.pool(WorkerURL, {
    maxWorkers: constant.MAX_EMBEDDING_WORKER_NUM,
});

interface EmbeddingOutput {
    embeddedSentences: Float32Array,
    shape: [number, number]
}

// 提取要保存到数据库的chunk和要embedding的纯文本
const transToTextList = (splits: langchainDocuments.Document[]): [DB.TEXT_CHUNK[], string[][], number] => {

    let perWorkerHandleTextSize = Math.floor(splits.length / constant.MAX_EMBEDDING_WORKER_NUM)
    console.log('perWorkerHandleTextSize', perWorkerHandleTextSize);

    const pureTextList: string[][] = []
    const textChunkList: DB.TEXT_CHUNK[] = []
    // 将数据拆平均分成多份
    let temp: string[] = []
    for (let i = 0; i < splits.length; i++) {
        // 截取纯文本,方便后续多worker并行处理
        temp.push(splits[i].
            pageContent
        )
        if (temp.length === perWorkerHandleTextSize) {
            pureTextList.push(temp)
            temp = []
        }

        // 保存textChunkList
        const split = splits[i]
        textChunkList.push({
            text: split.pageContent,
            metadata: {
                loc: {
                    lines: {
                        from: split.metadata.loc.lines.from,
                        to: split.metadata.loc.lines.to
                    },
                    pageNumber: split.metadata.loc.pageNumber
                }
            }
        })
    }
    if (temp.length) {
        pureTextList.push(temp)
    }

    return [textChunkList, pureTextList, perWorkerHandleTextSize]
}
// 将数据存入connection表
const storageDataToConnection = async (textChunkList: DB.TEXT_CHUNK[], lshIndexId: number, resource?: File) => {
    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

    const connection: DB.CONNECTION = {
        type: 'file',
        text_chunk_ids: textChunkList.map(item => item.id!),
        lsh_index_ids: [lshIndexId],
        resource
    }
    await store.add({
        storeName: constant.CONNECTION_STORE_NAME,
        data: connection
    });

}
// 将数据存入indexDB的text chunk表
const storageDataToTextChunk = async (textChunkList: DB.TEXT_CHUNK[]): Promise<DB.TEXT_CHUNK[]> => {
    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

    // 会自动添加id到textChunk里
    textChunkList = await store.addBatch<DB.TEXT_CHUNK>({
        storeName: constant.TEXT_CHUNK_STORE_NAME,
        data: textChunkList
    });

    return textChunkList;
}
// 将数据存入indexDB的LSH索引表
const storageTextChunkToLSH = async (textChunkList: DB.TEXT_CHUNK[], pureTextList: string[][], perWorkerHandleTextSize: number) => {
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
        const embeddingOutputIndex = Math.floor(index / perWorkerHandleTextSize)
        const curVectorIndex = index % perWorkerHandleTextSize

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
    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);
    const localProjections: DB.LSH_PROJECTION | undefined = await store.get({
        storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
        key: constant.LSH_PROJECTION_KEY_VALUE
    })
    // 初始化LSH索引
    const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections: localProjections?.data, });
    // 如果库中没有LSH随机向量，则将其存储到库中
    if (!localProjections) {
        await store.add({
            storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
            data: {
                [constant.LSH_PROJECTION_DATA_NAME]: lshIndex.projections
            }
        });
    }

    // 将LSH索引存储到indexDB
    const LSHTables = await lshIndex.addVectors(vectors);
    const lshIndexId = await store.add({
        storeName: constant.LSH_INDEX_STORE_NAME,
        data: {
            lsh_table: LSHTables
        }
    });

    return lshIndexId as number
}

//* doucment的定义为一个文件或notion的一个文档
// 搜索文档
const searchDocument = async (question: string) => {
    // 向量化句子
    const embeddingOutput: EmbeddingOutput = await embeddingWorkerPool.exec('embeddingText', [question])
    const embeddingTensor = tf.tensor(embeddingOutput.embeddedSentences, embeddingOutput.shape)
    const queryVector = embeddingTensor.slice([0, 0], [1, -1]).reshape([-1]) as tf.Tensor1D
    embeddingTensor.dispose()

    // 读取indexDB中的LSH索引表
    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);
    const lshIndexStoreList: DB.LSH_INDEX[] = await store.getAll({
        storeName: constant.LSH_INDEX_STORE_NAME,
    });
    if (!lshIndexStoreList.length) throw new Error('No LSH index data found');


    // 遍历索引表，查找相似句子
    const localProjections: DB.LSH_PROJECTION | undefined = await store.get({
        storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
        key: constant.LSH_PROJECTION_KEY_VALUE
    })
    const searchedRes: any = []
    for (const lshIndexData of lshIndexStoreList) {
        const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections: localProjections?.data, tables: lshIndexData.lsh_table });

        // 查找相似句子
        const res = lshIndex.findSimilar({
            queryVector,
        })
        searchedRes.push(...res)

    }
    return searchedRes
}

// 存储文档
const storageDocument = async (bigChunks: langchainDocuments.Document[], miniChunks: langchainDocuments.Document[], resource?: File) => {
    let [textChunkList, pureTextList, perWorkerHandleTextSize] = transToTextList(bigChunks.concat(miniChunks))

    // 将数据存入indexDB的text chunk表
    textChunkList = await storageDataToTextChunk(textChunkList)

    // 将文本向量化后存入indexDB的LSH索引表
    const lshIndexId = await storageTextChunkToLSH(textChunkList, pureTextList, perWorkerHandleTextSize);

    console.log('lshIndexId', lshIndexId);
    // 将数据存入connection表
    await storageDataToConnection(textChunkList, lshIndexId, resource)
}

// 测试相似度
const testSimilarity = async (text1, text2) => {
    await embedding.load()
    const similarity = await embedding.computeSimilarity(text1, text2)
    return similarity
}

workerpool.worker({
    searchDocument,
    storageDocument,
    testSimilarity
});