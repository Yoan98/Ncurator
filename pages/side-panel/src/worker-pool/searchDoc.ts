// 由于embedding过于占内存，只好将searchDoc抽出来
import { embedding, constant, IndexDBStore } from '@extension/shared';
import workerpool from 'workerpool';
import type { DB } from '@extension/shared'
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
            const searchRes: SearchedLshItem[] = await searchingWorkerPool.exec('searchLshIndex', [queryVectorData, lshIndexStoreList, localProjections])
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

    const [lshRes, fullIndexRes] = await Promise.all([
        searchLshIndex(),
        searchFullTextIndex(),
    ])

    return {
        lshRes,
        fullIndexRes
    }
}


workerpool.worker({
    searchDocument,
});