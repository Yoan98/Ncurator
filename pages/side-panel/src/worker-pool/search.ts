import workerpool from 'workerpool';
import { LSHIndex } from '@src/utils/VectorIndex';
import { FullTextIndex } from '@src/utils/FullTextIndex';
import * as config from '@src/config';
import lunr from 'lunr';


// 搜索向量索引表
const searchLshIndex = async (queryVectorData: Float32Array, lshIndexStoreList: DB.LSH_INDEX[], localProjections: DB.LSH_PROJECTION['data']) => {
    const searchedRes: Search.LshItemRes[] = []
    for (const lshIndexData of lshIndexStoreList) {
        const lshIndex = new LSHIndex({ dimensions: config.EMBEDDING_HIDDEN_SIZE, localProjections, tables: lshIndexData.table });

        // 查找相似句子
        const res = lshIndex.findSimilar({
            queryVector: Array.from(queryVectorData),
        })
        searchedRes.push(...res)
    }

    return searchedRes
}
// 搜索全本索引表
const searchFullTextIndex = async (question: string, fullTextIndexStoreList: DB.FULL_TEXT_INDEX[]) => {

    const searchedRes: lunr.Index.Result[] = []
    await FullTextIndex.loadJieBa()

    for (const fullTextIndexStore of fullTextIndexStoreList) {
        FullTextIndex.loadSerializer(fullTextIndexStore.index)
        const res = FullTextIndex.search(question)

        searchedRes.push(...res)
    }

    return searchedRes
}
workerpool.worker({
    searchLshIndex,
    searchFullTextIndex
});