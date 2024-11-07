// 由于embedding过于占内存，只好将searchDoc抽出来
import { embedding } from '@src/utils/Embedding';
import * as constant from '@src/utils/constant';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import workerpool from 'workerpool';
// @ts-ignore
import WorkerURL from './searching?url&worker'

const searchingWorkerPool = workerpool.pool(WorkerURL);

export interface SearchedLshItem {
    id: number,
    similarity: number
}
//* doucment的定义为一个文件或notion的一个文档
// 搜索文档
const searchDocument = async (question: string) => {
    // 向量化句子
    await embedding.load()
    const embeddingOutput = await embedding.encode([question]);
    const queryVectorData = embeddingOutput.dataSync() as Float32Array
    embeddingOutput.dispose()

    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

    // 搜索向量索引表
    const searchLshIndex = () => {
        return new Promise(async (resolve, reject) => {
            const [lshIndexStoreList, localProjections] = await Promise.all([
                store.getAll({
                    storeName: constant.LSH_INDEX_STORE_NAME,
                }),
                store.get({
                    storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
                    key: constant.LSH_PROJECTION_KEY_VALUE
                })
            ])
            if (!lshIndexStoreList.length) {
                // LSH索引表为空
                resolve([])
                return
            }

            // 多线程搜索LSH索引表
            //todo 后期可将数据拆分,然后多线程执行
            const searchRes: SearchedLshItem[] = await searchingWorkerPool.exec('searchLshIndex', [queryVectorData, lshIndexStoreList, localProjections.data])
            resolve(searchRes)
        })
    }

    // 搜索全本索引表
    const searchFullTextIndex = () => {
        return new Promise(async (resolve, reject) => {
            // 读取全文索引表相关数据
            const fullTextIndexStoreList: DB.FULL_TEXT_INDEX[] = await store.getAll({
                storeName: constant.FULL_TEXT_INDEX_STORE_NAME,
            });

            const fullTextIndexRes: lunr.Index.Result[] = await searchingWorkerPool.exec('searchFullTextIndex', [question, fullTextIndexStoreList])

            resolve(fullTextIndexRes)
        })
    }

    // 同时搜索向量索引表和全文索引表
    const [lshRes, fullIndexRes] = await Promise.all([
        searchLshIndex(),
        searchFullTextIndex(),
    ]) as [SearchedLshItem[], lunr.Index.Result[]]

    // 根据权重计算最终排序结果
    let finalRes: { id: number, score: number }[] = []
    const alreadyFullIndexIds: number[] = []
    const vectorWeight = 0.8
    const fullTextWeight = 0.2
    lshRes.forEach((item) => {
        const sameIndex = fullIndexRes.findIndex((fullItem) => Number(fullItem.ref) === item.id)
        if (sameIndex === -1) {
            finalRes.push({
                id: item.id,
                score: item.similarity * vectorWeight
            })
        } else {
            // 存在全文索引表中
            finalRes.push({
                id: item.id,
                score: (item.similarity * vectorWeight) + (fullTextWeight * fullIndexRes[sameIndex].score)
            })
            alreadyFullIndexIds.push(item.id)
        }
    })
    fullIndexRes.forEach((item) => {
        if (alreadyFullIndexIds.includes(Number(item.ref))) {
            return
        }
        finalRes.push({
            id: Number(item.ref),
            score: item.score * fullTextWeight
        })
    })
    finalRes = finalRes.sort((a, b) => b.score - a.score)

    // text_chunk表查询结果
    const ids = finalRes.map((item) => item.id)
    const textChunkRes = await store.getBatch({
        storeName: constant.TEXT_CHUNK_STORE_NAME,
        keys: ids
    })

    return {
        lshRes,
        fullIndexRes,
        finalRes,
        textChunkRes
    }
}


workerpool.worker({
    searchDocument,
});