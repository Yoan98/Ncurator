import { IndexDBStore } from '@src/utils/IndexDBStore';
import { EmbedTaskManage } from '@src/utils/EmbedTask'
import type { EmbedTask } from '@src/utils/EmbedTask'
import workerpool from 'workerpool';
import * as config from '@src/config';
import * as constant from '@src/utils/constant';
import { FullTextIndex } from '@src/utils/FullTextIndex';

// @ts-ignore
import searchWorkerURL from '@src/worker-pool/search?url&worker'

const searchingWorkerPool = workerpool.pool(searchWorkerURL, {
    maxWorkers: config.SEARCH_WORKER_NUM,
});
// 并行搜索
export const searchParallel = async ({ store, storeName, workerMethod, question, connections, extraWorkerParam = [], maxGetStoreItemSize = config.SEARCH_INDEX_BATCH_SIZE }: {
    store: IndexDBStore,
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

        const indexList: (DB.LSH_INDEX | DB.FULL_TEXT_INDEX)[] = await store.getBatch({
            storeName,
            keys: sliceIndexKeyIds
        });


        if (!indexList.length) {
            hasRestData = false
            break
        }

        // 按cpu核数，分割出worker执行任务
        const searchTasks: workerpool.Promise<any, Error>[] = []
        // 一个worker执行的最大数量
        // 除2的原因，是因为会同时搜索向量索引表和全文索引表
        const singleSearchWorkerNumber = Math.max(1, Math.floor(config.SEARCH_WORKER_NUM / 2))
        const workerExecuteSize = Math.max(1, Math.floor(indexList.length / singleSearchWorkerNumber))

        for (let i = 0; i < indexList.length; i += workerExecuteSize) {
            const workerHandleData = indexList.slice(i, i + workerExecuteSize)
            searchTasks.push(searchingWorkerPool.exec(workerMethod, [question, workerHandleData, ...extraWorkerParam]))
        }

        // 等待所有worker执行完,并汇总结果
        const multipleSearchRes: (Search.LshItemRes | lunr.Index.Result)[][] = await Promise.all(searchTasks)

        const curSearchRes = multipleSearchRes.flat()
        searchedRes.push(...curSearchRes)

        // 清空
        indexList.length = 0

        // 下一批数据
        startEndIndex[0] = startEndIndex[1]
        startEndIndex[1] = startEndIndex[1] + maxGetStoreItemSize
    }



    return searchedRes
}
// 搜索文档
export const searchDoc = async (question: string, connections: DB.CONNECTION[], k: number = 10): Promise<{
    searchedRes: Search.TextItemRes[]
}> => {
    if (!question || !connections.length) {
        return {
            searchedRes: []
        }
    }

    console.time('total search')
    // 向量化句子
    const embeddingOutput = await new Promise((resolve: EmbedTask['resolve'], reject) => {
        EmbedTaskManage.subscribe({
            text: [question],
            prefix: constant.EncodePrefix.SearchDocument,
            resolve,
            reject
        }, 'search')
    })
    const queryVectorData = embeddingOutput.data

    const store = new IndexDBStore();
    await store.connect(constant.DEFAULT_INDEXDB_NAME);

    // 随机向量数据
    const localProjections = await store.get({
        storeName: constant.LSH_PROJECTION_DB_STORE_NAME,
        key: constant.LSH_PROJECTION_KEY_VALUE
    })

    // 搜索向量索引表
    const searchLshIndex = async () => {
        console.time('searchLshIndex')
        const lshRes: Search.LshItemRes[] = await searchParallel({
            store,
            storeName: constant.LSH_INDEX_STORE_NAME,
            workerMethod: 'searchLshIndex',
            question: queryVectorData,
            connections,
            extraWorkerParam: [localProjections.data]
        })
        console.timeEnd('searchLshIndex')

        return lshRes

    }

    // 搜索全文索引表
    const searchFullTextIndex = async () => {
        console.time('searchFullTextIndex')
        const fullTextIndexRes: lunr.Index.Result[] = await searchParallel({
            store,
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
    let [lshRes, fullIndexResFromDB] = await Promise.all([
        searchLshIndex(),
        searchFullTextIndex(),
    ]) as [Search.LshItemRes[], lunr.Index.Result[]]
    console.timeEnd('search index total')


    // 将全文索结果根据现有结果重新打分,再排序，然后归一化
    let reRankFullIndexRes: lunr.Index.Result[] = []
    if (fullIndexResFromDB.length) {
        // 重新打分
        await FullTextIndex.loadJieBa()
        let fullIndexFromDBTextChunkRes: DB.TEXT_CHUNK[] = await store.getBatch({
            storeName: constant.TEXT_CHUNK_STORE_NAME,
            keys: fullIndexResFromDB.map((item) => Number(item.ref))
        })
        const fields = [{
            field: 'text'
        }]
        const data = fullIndexFromDBTextChunkRes.map((item) => {
            return {
                id: item.id,
                text: item.text
            }
        })
        FullTextIndex.add(fields, data)
        let newFullIndexRes = FullTextIndex.search(question)

        // 重新排序归一化
        newFullIndexRes = newFullIndexRes.sort((a, b) => b.score - a.score)
        const maxScore = newFullIndexRes[0].score
        reRankFullIndexRes = newFullIndexRes.map((item) => {
            item.score = item.score / maxScore
            return item
        })
    }
    // 根据权重计算混合排序结果
    let mixIndexSearchedRes: { id: number, score: number }[] = []
    const alreadyFullIndexIds: number[] = []
    const vectorWeight = config.SEARCHED_VECTOR_WEIGHT
    const fullTextWeight = config.SEARCHED_FULL_TEXT_WEIGHT
    lshRes.forEach((lshItem) => {
        const sameIndex = reRankFullIndexRes.findIndex((fullItem) => Number(fullItem.ref) === lshItem.id)
        if (sameIndex === -1) {
            // 只有向量索引,不需要权重
            mixIndexSearchedRes.push({
                id: lshItem.id,
                score: lshItem.similarity,
            })
        } else {
            // 向量索引与全文索引同一个text_chunk id,权重相加
            mixIndexSearchedRes.push({
                id: lshItem.id,
                score: (lshItem.similarity * vectorWeight) + (fullTextWeight * reRankFullIndexRes[sameIndex].score),
            })
            alreadyFullIndexIds.push(lshItem.id)
        }
    })
    reRankFullIndexRes.forEach((item) => {
        if (alreadyFullIndexIds.includes(Number(item.ref))) {
            return
        }
        // 这里都是没有与向量索引重复的全文索引结果
        mixIndexSearchedRes.push({
            id: Number(item.ref),
            // 考虑到向量全都没匹配中时,全文索引的重要性应该提高
            // 好处:尽可能会根据关键词匹配到相关的文本
            // 坏处:可能会匹配到不相关的文本
            // 但是,引进全文搜索的目的就是补全向量搜索的不足
            // todo 后期可增加精准搜索按钮来控制是否匹配全文索引
            score: lshRes.length ? item.score * fullTextWeight : item.score,
        })
    })
    mixIndexSearchedRes = mixIndexSearchedRes.sort((a, b) => b.score - a.score).filter((item) => item.score > config.SEARCH_SCORE_THRESHOLD)

    // text_chunk表查询结果
    let textChunkRes: DB.TEXT_CHUNK[] = await store.getBatch({
        storeName: constant.TEXT_CHUNK_STORE_NAME,
        keys: mixIndexSearchedRes.map((item) => item.id)
    })
    // 过滤掉相同的文本,因为大小chunk的原因,导致有些大小chunk会重复(大chunk按页划分,且一页内容很少时,会重复)
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
    const searchedRes = textChunkRes.map((textChunkItem) => {
        const document = documentRes.find((doc) => doc.id === textChunkItem.document_id)!
        return {
            ...textChunkItem,
            document,
            score: mixIndexSearchedRes.find((mixItem) => mixItem.id === textChunkItem.id)!.score
        }
    })

    console.timeEnd('total search')

    console.log('Res', {
        lshRes,
        fullIndexResFromDB: fullIndexResFromDB.sort((a, b) => b.score - a.score),
        reRankFullIndexRes,
        mixIndexSearchedRes,
        searchedRes,
    })

    return {
        searchedRes
    }
}
