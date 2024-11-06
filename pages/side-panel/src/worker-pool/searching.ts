import workerpool from 'workerpool';
import { constant, LSHIndex, IndexDBStore, tf } from '@extension/shared';
import type { DB } from '@extension/shared'
import lunr from 'lunr';
import type { SearchedLshItem } from './searchDoc'


// 搜索向量索引表
const searchLshIndex = async (queryVectorData: Float32Array, lshIndexStoreList: DB.LSH_INDEX[], localProjections: DB.LSH_PROJECTION['data']) => {

    const searchedRes: SearchedLshItem[] = []
    const queryVectorTensor = tf.tensor1d(queryVectorData) as tf.Tensor1D
    for (const lshIndexData of lshIndexStoreList) {
        const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections, tables: lshIndexData.lsh_table });

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
const searchFullTextIndex = async (question: string, fullTextIndexStoreList: DB.FULL_TEXT_INDEX[]) => {

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