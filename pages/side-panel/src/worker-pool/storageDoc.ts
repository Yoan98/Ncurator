// 由于embedding过于占内存，只好将storageDoc抽出来
import * as tf from '@tensorflow/tfjs';
import { embedding } from '@src/utils/Embedding';
import { LSHIndex } from '@src/utils/VectorIndex';
import { fullTextIndex } from '@src/utils/FullTextIndex';
import * as constant from '@src/utils/constant';
import type * as langchain from "@langchain/core/documents";
import { IndexDBStore } from '@src/utils/IndexDBStore';
import workerpool from 'workerpool';
// @ts-ignore
import WorkerURL from './embedding?url&worker'


const embeddingWorkerPool = workerpool.pool(WorkerURL, {
    maxWorkers: constant.MAX_EMBEDDING_WORKER_NUM,
});

interface EmbeddingOutput {
    embeddedSentences: Float32Array,
    shape: [number, number]
}

// 提取要保存到数据库的chunk和要embedding的纯文本
const transToTextList = (chunks: langchain.Document[]): [DB.TEXT_CHUNK[], string[][], number] => {

    let perWorkerHandleTextSize = Math.floor(chunks.length / constant.MAX_EMBEDDING_WORKER_NUM)
    console.log('perWorkerHandleTextSize', perWorkerHandleTextSize);

    const pureTextList: string[][] = []
    const textChunkList: DB.TEXT_CHUNK[] = []
    // 将数据拆平均分成多份
    let temp: string[] = []
    for (let i = 0; i < chunks.length; i++) {
        // 截取纯文本,方便后续多worker并行处理
        temp.push(chunks[i].
            pageContent
        )
        if (temp.length === perWorkerHandleTextSize) {
            pureTextList.push(temp)
            temp = []
        }

        // 保存textChunkList
        const chunk = chunks[i]
        textChunkList.push({
            text: chunk.pageContent,
            metadata: {
                loc: {
                    lines: {
                        from: chunk.metadata.loc.lines.from,
                        to: chunk.metadata.loc.lines.to
                    },
                    pageNumber: chunk.metadata.loc.pageNumber
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
const storageDataToConnection = async ({ textChunkList, lshIndexId, resource, fullTextIndexId }: {
    textChunkList: DB.TEXT_CHUNK[],
    lshIndexId: number,
    resource?: File,
    fullTextIndexId: number
}) => {
    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

    const connection: DB.CONNECTION = {
        connector_type: 'file',
        text_chunk_ids: textChunkList.map(item => item.id!),
        lsh_index_ids: [lshIndexId],
        resource,
        full_text_index_ids: [fullTextIndexId]
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
// 将大chunk数据构建全文搜索索引，并存储到indexDB
const storageBigChunkToFullTextIndex = async (textChunkList: DB.TEXT_CHUNK[]) => {
    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

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
        }
    });

    return fullTextIndexId as number
}

// 存储文档
const storageDocument = async ({ bigChunks, miniChunks, resource, connectionId, documentName }: {
    bigChunks: langchain.Document[],
    miniChunks: langchain.Document[],
    resource?: File,
    connectionId: number,
    documentName: string
}) => {
    let [textChunkList, pureTextList, perWorkerHandleTextSize] = transToTextList(bigChunks.concat(miniChunks))

    // 存入document表数据
    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);
    const document: DB.DOCUMENT = {
        name: documentName,
        text_chunk_id_range: {
            from: 0,
            to: 0
        },
        lsh_index_id: 0,
        full_text_index_id: 0,
        connection_id: connectionId,
        resource,
    }



    // 将数据存入indexDB的text chunk表
    textChunkList = await storageDataToTextChunk(textChunkList)

    // 将文本向量化后存入indexDB的LSH索引表
    const lshIndexId = await storageTextChunkToLSH(textChunkList, pureTextList, perWorkerHandleTextSize);

    // 将大chunk数据构建全文搜索索引，并存储到indexDB
    const bigTextChunkList = textChunkList.slice(0, bigChunks.length)
    const fullTextIndexId = await storageBigChunkToFullTextIndex(bigTextChunkList)

    // 将数据存入connection表
    await storageDataToConnection({
        textChunkList, lshIndexId, resource, fullTextIndexId
    })
}

// 测试相似度
const testSimilarity = async (text1, text2) => {
    await embedding.load()
    const similarity = await embedding.computeSimilarity(text1, text2)
    return similarity
}

workerpool.worker({
    storageDocument,
    testSimilarity
});