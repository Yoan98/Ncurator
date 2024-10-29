import { Embedding, constant } from '@extension/shared';
import { LSHIndex } from './VectorIndex';
import { IndexDBStore } from './IndexDBStore';
import type { LSH_INDEX_STORE, LSH_PROJECTION_STORE } from './VectorIndex'

addEventListener('message', async (event: MessageEvent) => {

    console.log('Received message in worker:', event.data);

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

    // 测试读取
    const embedding = new Embedding();
    await embedding.init();

    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

    const lshIndexData: LSH_INDEX_STORE = await store.get({
        storeName: constant.LSH_INDEX_STORE_NAME,
        key: 1
    });
    const localProjections: LSH_PROJECTION_STORE = await store.get({
        storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
        key: 1
    })

    const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections: localProjections.data, similarityThreshold: 0.7, tables: lshIndexData.lsh_table });

    const question = await embedding.encode(['今天天气如何?']);

    const res = await lshIndex.findSimilar({
        queryVector: question.slice([0, 0], [1, -1]).reshape([-1]),

    })
    console.log('lshIndexData', lshIndexData);
    console.log('res', res);




    // const res = await embedding.computeSimilarity('天气好好', 'build的时候，docker会校验每个步骤是否使用缓存，机制是根据前后相同指令是否有更改来决定，字符串的命令则会校验字符串是否相等，相等则使用缓存；如果是copy这类文件命令，则会对比前后文件是否相同来使用缓存；当某一步缓存失效后，下面的步骤都将不使用缓存；');
    // console.log('res', res);
});