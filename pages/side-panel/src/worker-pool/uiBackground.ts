import { embedding, constant, LSHIndex, IndexDBStore, tf } from '@extension/shared';
import type { LSH_INDEX_STORE, LSH_PROJECTION_STORE, TextChunk, langchainDocuments } from '@extension/shared'
import workerpool from 'workerpool';
// @ts-ignore
import WorkerURL from './calculation?url&worker'

const calculationWorkerPool = workerpool.pool(WorkerURL);

// 提取要保存到数据库的chunk和要embedding的纯文本
const transToTextList = (splits: langchainDocuments.Document[]): [TextChunk[], string[][], number] => {
    let perWorkerHandleTextSize = 10
    // 根据splits长度决定每个worker处理的纯文本数量
    if (splits.length <= 10) {
        perWorkerHandleTextSize = 3
    }

    const pureTextList: string[][] = []
    const textChunkList: TextChunk[] = []
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
// 将数据存入indexDB的text chunk表
const storageDataToTextChunk = async (textChunkList: TextChunk[]): Promise<TextChunk[]> => {
    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

    // 会自动添加id到textChunk里
    textChunkList = await store.addBatch<TextChunk>({
        storeName: constant.TEXT_CHUNK_STORE_NAME,
        data: textChunkList
    });

    return textChunkList;
}
// 将数据存入indexDB的LSH索引表
const storageTextChunkToLSH = async (textChunkList: TextChunk[], pureTextList: string[][], perWorkerHandleTextSize: number) => {
    // 多线程向量化句子
    console.time('embedding encode');
    const execTasks = pureTextList.map(item => {
        return calculationWorkerPool.exec('embeddingText', [item])
    })
    const embeddingOutput: { texts: string[], embeddedSentences: number[][] }[] = await Promise.all(execTasks)
    console.timeEnd('embedding encode');

    // 生成向量数组
    const vectors = textChunkList.map((chunk, index) => {
        const embeddingOutputIndex = Math.floor(index / perWorkerHandleTextSize)
        const curVectorIndex = index % perWorkerHandleTextSize
        const embeddingTensor = tf.tensor1d(embeddingOutput[embeddingOutputIndex].embeddedSentences[curVectorIndex])
        return {
            id: chunk.id!,
            vector: embeddingTensor,
            text: embeddingOutput[embeddingOutputIndex].texts[curVectorIndex]
        }
    });

    // * 构建索引
    // 获取库中是否已有LSH随机向量
    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);
    const localProjections: LSH_PROJECTION_STORE | undefined = await store.get({
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
    await store.add({
        storeName: constant.LSH_INDEX_STORE_NAME,
        data: {
            lsh_table: LSHTables
        }
    });
}

//* doucment的定义为一个文件或notion的一个文档
// 搜索文档
const searchDocument = async (question: string) => {
    // 向量化句子
    await embedding.load()
    const embeddingOutput = await embedding.encode(question);

    // 读取indexDB中的LSH索引表
    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);
    const lshIndexStoreList: LSH_INDEX_STORE[] = await store.getAll({
        storeName: constant.LSH_INDEX_STORE_NAME,
    });
    if (!lshIndexStoreList.length) throw new Error('No LSH index data found');


    // 遍历索引表，查找相似句子
    const localProjections: LSH_PROJECTION_STORE | undefined = await store.get({
        storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
        key: constant.LSH_PROJECTION_KEY_VALUE
    })
    const searchedRes: any = []
    for (const lshIndexData of lshIndexStoreList) {
        const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections: localProjections?.data, tables: lshIndexData.lsh_table });

        // 查找相似句子
        const res = lshIndex.findSimilar({
            queryVector: embeddingOutput.slice([0, 0], [1, -1]).reshape([-1]),
        })
        searchedRes.push(...res)

    }
    return searchedRes
}

// 存储文档
const storageDocument = async (bigSplits: langchainDocuments.Document[], miniSplits: langchainDocuments.Document[]) => {
    let [textChunkList, pureTextList, perWorkerHandleTextSize] = transToTextList(bigSplits.concat(miniSplits))

    // 将数据存入indexDB的text chunk表
    textChunkList = await storageDataToTextChunk(textChunkList)

    // 将文本向量化后存入indexDB的LSH索引表
    await storageTextChunkToLSH(textChunkList, pureTextList, perWorkerHandleTextSize);
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