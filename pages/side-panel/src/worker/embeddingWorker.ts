import { Embedding, constant, LSHIndex, IndexDBStore, util } from '@extension/shared';
import type { LSH_INDEX_STORE, LSH_PROJECTION_STORE, tf, TextChunk } from '@extension/shared'

addEventListener('message', async (event: MessageEvent) => {

    console.log('Received message in worker:', event.data);

    // 将数据存入indexDB的text chunk表
    const storageDataToTextChunk = async (sentences: Intl.SegmentData[]) => {
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
        console.log('embeddingOutput', embeddingOutput);


        // 生成向量数组
        const vectors = textChunkList.map((chunk, index) => {
            return {
                id: chunk.id!,
                vector: embeddingOutput.slice([index, 0], [1, -1]).reshape([-1]) as tf.Tensor1D
            }
        });
        console.log('vectors', vectors);

        // 获取库中是否已有LSH随机向量
        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);
        const localProjections: number[][] | undefined = await store.get({
            storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
            key: constant.LSH_PROJECTION_KEY_NAME
        })
        // 初始化LSH索引
        const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections, similarityThreshold: 0.7 });
        // 如果库中没有LSH随机向量，则将其存储到库中
        if (!localProjections) {
            await store.add({
                storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
                data: {
                    [constant.LSH_PROJECTION_KEY_NAME]: lshIndex.projections
                }
            });
        }

        // 将LSH索引存储到indexDB
        const LSHTables = await lshIndex.addVectors(vectors);
        console.log('LSHTables', LSHTables);
        await store.add({
            storeName: constant.LSH_INDEX_STORE_NAME,
            data: {
                lsh_table: LSHTables
            }
        });
        return LSHTables;
    }


    switch (event.data.action) {
        case 'text':
            const text = event.data.data;
            // 提取句子
            const sentences = util.extractSentence(text);
            console.log('sentences', sentences);

            const res = await storageDataToTextChunk(sentences)
            console.log('res', res);


            break;
        default:
            break;
    }

    //!写入向量索引
    // const embedding = new Embedding();
    // await embedding.init();

    // // 获取库中是否已有LSH随机向量
    // const store = new IndexDBStore();
    // await store.connect(constant.DEFAULT_INDEXDB_NAME);
    // const localProjections: number[][] | undefined = await store.get({
    //     storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
    //     key: constant.LSH_PROJECTION_KEY_NAME
    // })

    // const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections, similarityThreshold: 0.7 });

    // if (!localProjections) {
    //     // 如果库中没有LSH随机向量，则将其存储到库中
    //     await store.add({
    //         storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
    //         data: {
    //             [constant.LSH_PROJECTION_KEY_NAME]: lshIndex.projections
    //         }
    //     });
    // }

    // const output = await embedding.encode(['How is the weather today?']);


    // // 测试将LSH索引存储到indexDB
    // const LSHTables = await lshIndex.addVectors([{ id: 1, vector: output.slice([0, 0], [1, -1]).reshape([-1]) }]);

    // console.log('LSHTables', LSHTables);
    // await store.add({
    //     storeName: constant.LSH_INDEX_STORE_NAME,
    //     data: {
    //         lsh_table: LSHTables
    //     }
    // });
    // console.log('LSH Index added to IndexDB');

    // !写入text chunk


    //! 测试读取
    // const embedding = new Embedding();
    // await embedding.init();

    // const store = new IndexDBStore();
    // await store.connect(constant.DEFAULT_INDEXDB_NAME);

    // const lshIndexData: LSH_INDEX_STORE = await store.get({
    //     storeName: constant.LSH_INDEX_STORE_NAME,
    //     key: 1
    // });
    // const localProjections: LSH_PROJECTION_STORE = await store.get({
    //     storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
    //     key: 1
    // })

    // const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections: localProjections.data, similarityThreshold: 0.7, tables: lshIndexData.lsh_table });

    // const question = await embedding.encode(['今天天气如何?']);

    // const res = await lshIndex.findSimilar({
    //     queryVector: question.slice([0, 0], [1, -1]).reshape([-1]),

    // })
    // console.log('lshIndexData', lshIndexData);
    // console.log('res', res);




    // const res = await embedding.computeSimilarity('天气好好', 'build的时候，docker会校验每个步骤是否使用缓存，机制是根据前后相同指令是否有更改来决定，字符串的命令则会校验字符串是否相等，相等则使用缓存；如果是copy这类文件命令，则会对比前后文件是否相同来使用缓存；当某一步缓存失效后，下面的步骤都将不使用缓存；');
    // console.log('res', res);
});