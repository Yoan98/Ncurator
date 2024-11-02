import { embedding, constant, LSHIndex, IndexDBStore, tool, tf } from '@extension/shared';
import type { LSH_INDEX_STORE, LSH_PROJECTION_STORE, TextChunk, langchainDocuments } from '@extension/shared'
import workerpool from 'workerpool';
// @ts-ignore
import WorkerURL from './embeddingWorker?url&worker'

const embeddingWorkerPool = workerpool.pool(WorkerURL);

embedding.init()
addEventListener('message', async (event: MessageEvent) => {
    console.log('Received message in embedding worker:');
    // 提取要保存到数据库的chunk和要embedding的纯文本
    const transToTextList = (splits: langchainDocuments.Document[]): [TextChunk[], string[][], number] => {
        let splitPureSize = 10
        // 根据splits长度决定每个worker处理的纯文本数量
        if (splits.length <= 10) {
            splitPureSize = 3
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
            if (temp.length === splitPureSize) {
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

        return [textChunkList, pureTextList, splitPureSize]
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
    const storageTextChunkToLSH = async (textChunkList: TextChunk[], pureTextList: string[][], splitPureSize: number) => {
        // 多线程向量化句子
        console.time('embedding encode');
        const execTasks = pureTextList.map(item => {
            return embeddingWorkerPool.exec('embeddingText', [item])
        })
        const embeddingOutput: { texts: string[], embeddedSentences: number[][] }[] = await Promise.all(execTasks)
        console.timeEnd('embedding encode');

        // 生成向量数组
        const vectors = textChunkList.map((chunk, index) => {
            const embeddingOutputIndex = Math.floor(index / splitPureSize)
            const curVectorIndex = index % splitPureSize
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
        const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections: localProjections?.data, similarityThreshold: 0.7 });
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

    // 相似句子匹配
    const similarSentenceMatch = async (question: string) => {

        // 向量化句子
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
        let matchedData: any = []
        for (const lshIndexData of lshIndexStoreList) {
            console.log('lshIndexData', lshIndexData);
            const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections: localProjections?.data, tables: lshIndexData.lsh_table });

            // 查找相似句子
            matchedData = await lshIndex.findSimilar({
                queryVector: embeddingOutput.slice([0, 0], [1, -1]).reshape([-1]),

            })
        }
        return matchedData
    }


    const messageData = event.data.data;
    if (!messageData) throw new Error('No message data received');

    switch (event.data.action) {
        case 'storage_chunk':
            const splits = messageData
            // 提取句子
            console.log('splits', splits);
            let [textChunkList, pureTextList, splitPureSize] = transToTextList(splits)

            // 将数据存入indexDB的text chunk表
            textChunkList = await storageDataToTextChunk(textChunkList)

            // 将数据存入indexDB的LSH索引表
            await storageTextChunkToLSH(textChunkList, pureTextList, splitPureSize);

            break;
        case 'question':
            const question = messageData;
            console.log('question', question);

            console.time('searching similar');
            const res = await similarSentenceMatch(question);
            console.log('search res', res);
            console.timeEnd('searching similar');

            break;
        case 'test':
            console.log('test');

            break;
        case 'testExtractSentence':
            // 提取句子
            const sentences1 = tool.extractSentence(messageData);
            console.log('sentences', sentences1.map(item => item.segment));

        default:
            break;
    }






});