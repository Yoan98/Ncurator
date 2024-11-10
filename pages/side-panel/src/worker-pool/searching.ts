import workerpool from 'workerpool';
import * as tf from '@tensorflow/tfjs';
import { LSHIndex } from '@src/utils/VectorIndex';
import { fullTextIndex } from '@src/utils/FullTextIndex';
import * as constant from '@src/utils/constant';
import lunr from 'lunr';
import type { SearchedLshItem } from './searchDoc'


// 搜索向量索引表
const searchLshIndex = async (queryVectorData: Float32Array, lshIndexStoreList: DB.LSH_INDEX[], localProjections: DB.LSH_PROJECTION['data']) => {


    const searchedRes: SearchedLshItem[] = []
    const queryVectorTensor = tf.tensor1d(queryVectorData) as tf.Tensor1D
    for (const lshIndexData of lshIndexStoreList) {
        const lshIndex = new LSHIndex({ dimensions: constant.EMBEDDING_HIDDEN_SIZE, localProjections, tables: lshIndexData.lsh_table });

        console.time('searching findSimilar per doc')
        // 查找相似句子
        const res = lshIndex.findSimilar({
            queryVector: queryVectorTensor,
        })
        console.timeEnd('searching findSimilar per doc')
        searchedRes.push(...res)
    }

    queryVectorTensor.dispose()


    return searchedRes
}
// 搜索全本索引表
const searchFullTextIndex = async (question: string, fullTextIndexStoreList: DB.FULL_TEXT_INDEX[]) => {

    const searchedRes: lunr.Index.Result[] = []
    await fullTextIndex.loadLunr()

    for (const fullTextIndexStore of fullTextIndexStoreList) {
        fullTextIndex.loadSerializer(fullTextIndexStore.index)
        const res = fullTextIndex.search(question)

        searchedRes.push(...res)
    }

    return searchedRes
}
workerpool.worker({
    searchLshIndex,
    searchFullTextIndex
});