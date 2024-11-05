import workerpool from 'workerpool';
import { constant, LSHIndex, IndexDBStore, tf } from '@extension/shared';
import type { DB } from '@extension/shared'
import lunr from 'lunr';


// 搜索向量索引表
// todo:后面可传递表明，来达到多worker并行处理
const searchLshIndex = async (queryVectorData: Float32Array) => {
    // 读取indexDB中的LSH索引表相关数据
    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

    const lshIndexStoreList: DB.LSH_INDEX[] = await store.getAll({
        storeName: constant.LSH_INDEX_STORE_NAME,
    });
    if (!lshIndexStoreList.length) return [];
    const localProjections: DB.LSH_PROJECTION = await store.get({
        storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
        key: constant.LSH_PROJECTION_KEY_VALUE
    })

    const searchedRes: { id: number, similarity: number }[] = []
    const queryVectorTensor = tf.tensor1d(queryVectorData) as tf.Tensor1D
    for (const lshIndexData of lshIndexStoreList) {
        const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections: localProjections.data, tables: lshIndexData.lsh_table });

        // 查找相似句子
        const res = lshIndex.findSimilar({
            queryVector: queryVectorTensor,
        })
        searchedRes.push(...res)
    }

    queryVectorTensor.dispose()

    return searchedRes
}
// 搜索全本索引表
const searchFullTextIndex = async (question: string) => {
    // 读取全文索引表相关数据
    const store = new IndexDBStore();

    await store.connect(constant.DEFAULT_INDEXDB_NAME);
    const fullTextIndexStoreList: DB.FULL_TEXT_INDEX[] = await store.getAll({
        storeName: constant.FULL_TEXT_INDEX_STORE_NAME,
    });
    const searchedRes: lunr.Index.Result[] = []
    for (const fullTextIndex of fullTextIndexStoreList) {
        const lurIndex = lunr.Index.load(fullTextIndex.index)
        const res = lurIndex.search(question)

        searchedRes.push(...res)
    }

    return searchedRes
}
workerpool.worker({
    searchLshIndex,
    searchFullTextIndex
});