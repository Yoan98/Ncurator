// 由于embedding过于占内存，只好将searchDoc抽出来
import { embedding } from '@src/utils/Embedding';
import * as constant from '@src/utils/constant';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import workerpool from 'workerpool';
// @ts-ignore
import WorkerURL from './searching?url&worker'
import { getIndexStoreName } from '@src/utils/tool';

// 最多开一半的cpu核数,避免内存过大
const maxWorkers = Math.max(1, Math.floor(navigator.hardwareConcurrency / 2))
const searchingWorkerPool = workerpool.pool(WorkerURL, {
    maxWorkers,
});

export interface SearchedLshItem {
    id: number,
    similarity: number
}
interface TempConnection {
    connector: ConnectorUnion,
    id: number
}
// 搜索文档
const search = async (question: string, connections: DB.CONNECTION[], k: number = 10) => {
    // 向量化句子
    await embedding.load()
    const embeddingOutput = await embedding.encode([question]);
    const queryVectorData = embeddingOutput.dataSync() as Float32Array
    embeddingOutput.dispose()

    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

    // 随机向量数据
    const localProjections = await store.get({
        storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
        key: constant.LSH_PROJECTION_KEY_VALUE
    })

    // 并行搜索
    const searchParallel = async ({ storeName, workerMethod, question, connections, extraWorkerParam = [], maxGetStoreItemSize = 100 }: {
        storeName: string,
        workerMethod: string,
        question: string | Float32Array,
        connections: DB.CONNECTION[],
        extraWorkerParam?: any[],
        // 每次次从表里取出的最大数据条数（避免数据过多，撑爆内存）
        maxGetStoreItemSize?: number
    }) => {
        let curConnectionIndex = 0

        // 搜索结果汇总
        const searchedRes: any[] = []
        // 循环根据connection搜索(一个connection一个store)
        while (curConnectionIndex < connections.length) {
            // 读取索引表相关数据
            const connection = connections[curConnectionIndex]
            // todo 待选择document搜索后，根据document的from和to来限制搜索范围

            // 按照id范围搜索，避免取数据超出最大限制，待这一批搜索完结果，再取下一批数据搜索
            let hasRestData = true
            const keyRange = [0, maxGetStoreItemSize]
            while (hasRestData) {
                const indexStoreName = getIndexStoreName(connection.connector, connection.id!, storeName)
                const storeList: (DB.LSH_INDEX | DB.FULL_TEXT_INDEX)[] = await store.getAll({
                    storeName: indexStoreName,
                    key: IDBKeyRange.bound(keyRange[0], keyRange[1], false, true)
                });

                if (!storeList.length) {
                    hasRestData = false
                    break
                }

                // 按cpu核数，分割出worker执行任务
                const searchTasks: workerpool.Promise<any, Error>[] = []
                // 一个worker执行的最大数量
                // 除2的原因，是因为会同时搜索向量索引表和全文索引表
                const cpuCore = Math.max(1, Math.floor(maxWorkers / 2))
                const workerExecuteSize = Math.max(1, Math.floor(storeList.length / cpuCore))

                for (let i = 0; i < storeList.length; i += workerExecuteSize) {
                    const workerHandleData = storeList.slice(i, i + workerExecuteSize)
                    searchTasks.push(searchingWorkerPool.exec(workerMethod, [question, workerHandleData, ...extraWorkerParam]))
                }

                // 等待所有worker执行完,并汇总结果
                const multipleSearchRes: any[][] = await Promise.all(searchTasks)
                const curSearchRes = multipleSearchRes.flat()
                searchedRes.push(...(curSearchRes.map((item) => {
                    item.connection = {
                        connector: connection.connector,
                        id: connection.id
                    }
                    return item
                })))

                // 清空
                storeList.length = 0

                // 更新keyRange
                keyRange[0] = keyRange[1]
                keyRange[1] += maxGetStoreItemSize
            }


            curConnectionIndex++
        }

        return searchedRes
    }

    // 搜索向量索引表
    const searchLshIndex = async () => {
        console.time('searchLshIndex')
        const lshRes: SearchedLshItem[] = await searchParallel({
            storeName: constant.LSH_INDEX_STORE_NAME,
            workerMethod: 'searchLshIndex',
            question: queryVectorData,
            connections,
            extraWorkerParam: [localProjections.data]
        })
        console.timeEnd('searchLshIndex')

        return lshRes

    }

    // 搜索全本索引表
    const searchFullTextIndex = async () => {
        console.time('searchFullTextIndex')
        const fullTextIndexRes: lunr.Index.Result[] = await searchParallel({
            storeName: constant.FULL_TEXT_INDEX_STORE_NAME,
            workerMethod: 'searchFullTextIndex',
            question,
            connections,
        })
        console.timeEnd('searchFullTextIndex')

        return fullTextIndexRes
    }

    console.time('search table')
    // 同时搜索向量索引表和全文索引表
    let [lshRes, fullIndexRes] = await Promise.all([
        searchLshIndex(),
        searchFullTextIndex(),
    ]) as [(SearchedLshItem & { connection: TempConnection })[], (lunr.Index.Result & { connection: TempConnection })[]]
    console.timeEnd('search table')


    // 将全文索引排序，然后使用max归一化
    fullIndexRes = fullIndexRes.sort((a, b) => b.score - a.score)
    const maxScore = fullIndexRes[0].score
    fullIndexRes = fullIndexRes.map((item) => {
        item.score = item.score / maxScore
        return item
    })
    // 根据权重计算最终排序结果
    let finalRes: { id: number, score: number, connection: TempConnection }[] = []
    const alreadyFullIndexIds: number[] = []
    const vectorWeight = 0.8
    const fullTextWeight = 0.2
    lshRes.forEach((item) => {
        const sameIndex = fullIndexRes.findIndex((fullItem) => Number(fullItem.ref) === item.id)
        if (sameIndex === -1) {
            // 只有向量索引
            finalRes.push({
                id: item.id,
                score: item.similarity * vectorWeight,
                connection: item.connection
            })
        } else {
            // 向量索引与全文索引同一个text_chunk id
            finalRes.push({
                id: item.id,
                score: (item.similarity * vectorWeight) + (fullTextWeight * fullIndexRes[sameIndex].score),
                connection: item.connection
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
            score: item.score * fullTextWeight,
            connection: item.connection
        })
    })
    finalRes = finalRes.sort((a, b) => b.score - a.score)

    // 按照storeName分组
    const groupByStoreName = finalRes.reduce((acc, cur) => {
        const storeName = getIndexStoreName(cur.connection.connector, cur.connection.id!, constant.TEXT_CHUNK_STORE_NAME)
        if (!acc[storeName]) {
            acc[storeName] = []
        }
        acc[storeName].push(cur.id)
        return acc
    }, {} as Record<string, number[]>)


    // text_chunk表查询结果
    let textChunkRes: DB.TEXT_CHUNK[] = []
    for (const storeName in groupByStoreName) {
        const res = await store.getBatch({
            storeName,
            keys: groupByStoreName[storeName]
        })
        textChunkRes.push(...res)
    }
    textChunkRes = textChunkRes.slice(0, k)

    // 读取document表数据，并拼凑
    const documentRes: DB.DOCUMENT[] = []
    for (const item of textChunkRes) {
        const document = await store.get({
            storeName: constant.DOCUMENT_STORE_NAME,
            key: item.document_id
        })
        documentRes.push(document)
    }
    textChunkRes = textChunkRes.map((item) => {
        const document = documentRes.find((doc) => doc.id === item.document_id)
        return {
            ...item,
            document
        }
    })



    console.log('Res', {
        lshRes,
        fullIndexRes,
        finalRes,
        textChunkRes,
    })

    return {
        textChunkRes
    }
}


workerpool.worker({
    search,
});