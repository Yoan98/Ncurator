import { Embedding, constant, LSHIndex, IndexDBStore, tool } from '@extension/shared';
import type { LSH_INDEX_STORE, LSH_PROJECTION_STORE, tf, TextChunk } from '@extension/shared'

addEventListener('message', async (event: MessageEvent) => {
    console.log('Received message in embedding worker:');

    // 将数据存入indexDB的text chunk表
    const storageDataToTextChunk = async (sentences: Intl.SegmentData[]): Promise<[TextChunk[], string[]]> => {
        const pureTextList: string[] = []
        let textChunkList: TextChunk[] = []

        for (const sentence of sentences) {
            pureTextList.push(sentence.segment);

            textChunkList.push({
                text: sentence.segment
            })

        }

        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);

        textChunkList = await store.addBatch<TextChunk>({
            storeName: constant.TEXT_CHUNK_STORE_NAME,
            data: textChunkList
        });

        return [textChunkList, pureTextList];
    }

    // 将数据存入indexDB的LSH索引表
    const storageTextChunkToLSH = async (textChunkList: TextChunk[], pureTextList: string[]) => {
        // 向量化句子
        const embedding = new Embedding();
        await embedding.init();
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
        const embedding = new Embedding();
        await embedding.init();
        const embeddingOutput = await embedding.encode(question);

        // 读取indexDB中的LSH索引表
        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);
        const lshIndexStoreList: LSH_INDEX_STORE[] = await store.getAll({
            storeName: constant.LSH_INDEX_STORE_NAME,
        });
        if (!lshIndexStoreList.length) throw new Error('No LSH index data found');

        console.time('find similar');
        // 遍历索引表，查找相似句子
        const localProjections: LSH_PROJECTION_STORE | undefined = await store.get({
            storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
            key: constant.LSH_PROJECTION_KEY_VALUE
        })
        console.log('localProjections', localProjections);
        const similarKeys: Set<number> = new Set();
        for (const lshIndexData of lshIndexStoreList) {
            console.log('lshIndexData', lshIndexData);
            const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections: localProjections?.data, similarityThreshold: 0.7, tables: lshIndexData.lsh_table });

            // 查找相似句子
            const res = await lshIndex.findSimilar({
                queryVector: embeddingOutput.slice([0, 0], [1, -1]).reshape([-1]),

            })
            res.forEach(key => similarKeys.add(key));
        }
        console.log('similar keys', similarKeys);
        console.timeEnd('find similar');
    }


    switch (event.data.action) {
        case 'text':
            const text = event.data.data;
            if (!text) throw new Error('No text data received');
            // 提取句子
            const sentences = tool.extractSentence(text);
            console.log('sentences', sentences);

            const [textChunkList, pureTextList] = await storageDataToTextChunk(sentences)
            console.log('start LSH storage');
            await storageTextChunkToLSH(textChunkList, pureTextList);
            console.log('finished LSH storage');

            break;
        case 'question':
            const question = event.data.data;
            if (!question) throw new Error('No question data received');
            console.log('question', question);

            await similarSentenceMatch(question);

        case 'test':
            console.log('test');

            const embedding = new Embedding();
            await embedding.init();

            const res = await embedding.computeSimilarity('打包工具', '打包⼯具的基本思路1打包⼯具的基本思路1打包⼯具的基本思路');
            console.log('res', res);
        default:
            break;
    }






});