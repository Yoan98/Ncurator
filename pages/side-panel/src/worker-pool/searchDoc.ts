// 由于embedding过于占内存，只好将searchDoc抽出来
import { embedding } from '@src/utils/Embedding';
import * as constant from '@src/utils/constant';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import workerpool from 'workerpool';
// @ts-ignore
import WorkerURL from './searching?url&worker'

// 最多开一半的cpu核数,避免内存过大
const maxWorkers = Math.max(1, Math.floor(navigator.hardwareConcurrency / 2))
const searchingWorkerPool = workerpool.pool(WorkerURL, {
    maxWorkers,
});

export interface SearchedLshItemRes {
    id: number,
    similarity: number
}
// 搜索文档
const search = async (question: string, connections: DB.CONNECTION[], k: number = 10) => {
    if (!question || !connections.length) {
        return {
            searchedRes: []
        }
    }

    console.time('total search')
    // 向量化句子
    await embedding.load()
    const embeddingOutput = await embedding.encode(question, constant.EncodePrefix.SearchQuery);
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

        // 搜索结果汇总
        const searchedRes: any[] = []
        // 按照id范围搜索，避免取数据超出最大限制，待这一批搜索完结果，再取下一批数据搜索
        let hasRestData = true
        const indexKeyIds = workerMethod == 'searchLshIndex' ? connections.map((item) => item.lsh_index_ids).flat() : connections.map((item) => item.full_text_index_ids).flat()
        let startEndIndex = [0, maxGetStoreItemSize]

        while (hasRestData) {
            const sliceIndexKeyIds = indexKeyIds.slice(startEndIndex[0], startEndIndex[1])

            const storeList: (DB.LSH_INDEX | DB.FULL_TEXT_INDEX)[] = await store.getBatch({
                storeName,
                keys: sliceIndexKeyIds
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
            const multipleSearchRes: (SearchedLshItemRes | lunr.Index.Result)[][] = await Promise.all(searchTasks)

            const curSearchRes = multipleSearchRes.flat()
            searchedRes.push(...curSearchRes)

            // 清空
            storeList.length = 0

            // 下一批数据
            startEndIndex[0] = startEndIndex[1]
            startEndIndex[1] = startEndIndex[1] + maxGetStoreItemSize
        }



        return searchedRes
    }

    // 搜索向量索引表
    const searchLshIndex = async () => {
        console.time('searchLshIndex')
        const lshRes: SearchedLshItemRes[] = await searchParallel({
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

    console.time('search index total')
    // 同时搜索向量索引表和全文索引表
    let [lshRes, fullIndexRes] = await Promise.all([
        searchLshIndex(),
        searchFullTextIndex(),
    ]) as [SearchedLshItemRes[], lunr.Index.Result[]]
    console.timeEnd('search index total')


    if (fullIndexRes.length) {
        // 将全文索引排序，然后使用max归一化
        fullIndexRes = fullIndexRes.sort((a, b) => b.score - a.score)
        const maxScore = fullIndexRes[0].score
        fullIndexRes = fullIndexRes.map((item) => {
            item.score = item.score / maxScore
            return item
        })
    }
    // 根据权重计算混合排序结果
    let mixRes: { id: number, score: number }[] = []
    const alreadyFullIndexIds: number[] = []
    const vectorWeight = constant.SEARCHED_VECTOR_WEIGHT
    const fullTextWeight = constant.SEARCHED_FULL_TEXT_WEIGHT
    lshRes.forEach((item) => {
        const sameIndex = fullIndexRes.findIndex((fullItem) => Number(fullItem.ref) === item.id)
        if (sameIndex === -1) {
            // 只有向量索引
            mixRes.push({
                id: item.id,
                score: item.similarity * vectorWeight,
            })
        } else {
            // 向量索引与全文索引同一个text_chunk id
            mixRes.push({
                id: item.id,
                score: (item.similarity * vectorWeight) + (fullTextWeight * fullIndexRes[sameIndex].score),
            })
            alreadyFullIndexIds.push(item.id)
        }
    })
    fullIndexRes.forEach((item) => {
        if (alreadyFullIndexIds.includes(Number(item.ref))) {
            return
        }
        mixRes.push({
            id: Number(item.ref),
            score: item.score * fullTextWeight,
        })
    })
    mixRes = mixRes.sort((a, b) => b.score - a.score)


    // text_chunk表查询结果
    let textChunkRes: DB.TEXT_CHUNK[] = await store.getBatch({
        storeName: constant.TEXT_CHUNK_STORE_NAME,
        keys: mixRes.map((item) => item.id)
    })
    // 过滤掉相同的文本,因为大小chunk的原因,导致有些小文本会重复
    textChunkRes = textChunkRes.filter((item, index, self) =>
        index === self.findIndex((t) => (
            t.text === item.text
        ))
    )
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
    const searchedRes = textChunkRes.map((item) => {
        const document = documentRes.find((doc) => doc.id === item.document_id)
        return {
            ...item,
            document
        }
    })

    console.timeEnd('total search')

    console.log('Res', {
        lshRes,
        fullIndexRes,
        mixRes,
        searchedRes,
    })

    return {
        searchedRes
    }
}

// 用于提前加载embedding模型
const loadEmbedding = async () => {
    await embedding.load()

}

workerpool.worker({
    search,
    loadEmbedding
});