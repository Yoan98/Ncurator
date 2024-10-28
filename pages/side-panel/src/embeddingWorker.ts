import { Embedding, constant } from '@extension/shared';
import { LSHIndex } from './VectorIndex';
import { IndexDBStore } from './IndexDBStore';

addEventListener('message', async (event: MessageEvent) => {

    console.log('Received message in worker:', event.data);

    const embedding = new Embedding();
    await embedding.init();

    // 获取库中是否已有LSH随机向量
    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);
    const localProjections: number[][] | undefined = await store.get({
        storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
        key: constant.LSH_PROJECTION_KEY_NAME
    })

    const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections });

    if (!localProjections) {
        // 如果库中没有LSH随机向量，则将其存储到库中
        await store.add({
            storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
            data: {
                [constant.LSH_PROJECTION_KEY_NAME]: lshIndex.projections
            }
        });
    }

    const output = await embedding.encode(['How is the weather today?']);

    lshIndex.addVector(1, output.slice([0, 0], [1, -1]).reshape([-1]));
    console.log('lshIndex', lshIndex.tables);


    // const res = await embedding.computeSimilarity('How is the weather today?', '今天天气怎么样?');
    // console.log('res', res);
});