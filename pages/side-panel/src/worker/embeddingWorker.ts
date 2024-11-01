import { embedding, constant, LSHIndex, IndexDBStore, tool } from '@extension/shared';
import type { LSH_INDEX_STORE, LSH_PROJECTION_STORE, tf, TextChunk, langchainDocuments } from '@extension/shared'


// 后面给存储chunk和lsh单独写一个worker
// 搜索单独写一个worker
addEventListener('message', async (event: MessageEvent) => {
    console.log('Received message in embedding worker:');

    // 将数据存入indexDB的text chunk表
    const storageDataToTextChunk = async (splits: langchainDocuments.Document[]): Promise<[TextChunk[], string[]]> => {
        const pureTextList: string[] = []
        let textChunkList: TextChunk[] = []

        for (const split of splits) {
            pureTextList.push(split.pageContent);

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

        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);

        // 会自动添加id到textChunk里
        textChunkList = await store.addBatch<TextChunk>({
            storeName: constant.TEXT_CHUNK_STORE_NAME,
            data: textChunkList
        });

        return [textChunkList, pureTextList];
    }

    // 将数据存入indexDB的LSH索引表
    const storageTextChunkToLSH = async (textChunkList: TextChunk[], pureTextList: string[]) => {
        // 向量化句子
        // 此处也可考虑抽成worker,并行处理,如一个worker执行50条,因为这里耗时较长
        const embeddingOutput = await embedding.encode(pureTextList);

        // 生成向量数组
        const vectors = textChunkList.map((chunk, index) => {
            return {
                id: chunk.id!,
                vector: embeddingOutput.slice([index, 0], [1, -1]).reshape([-1]) as tf.Tensor1D
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

            const [textChunkList, pureTextList] = await storageDataToTextChunk(splits)
            console.log('start LSH storage');
            await storageTextChunkToLSH(textChunkList, pureTextList);
            console.log('finished LSH storage');

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

            const ress = await embedding.computeSimilarity('打包工具', '打包⼯具的基本思路1打包⼯具的基本思路1打包⼯具的基本思路');
            console.log('res', ress);
            break;
        case 'testExtractSentence':
            // 提取句子
            const sentences1 = tool.extractSentence(messageData);
            console.log('sentences', sentences1.map(item => item.segment));

        default:
            break;
    }






});