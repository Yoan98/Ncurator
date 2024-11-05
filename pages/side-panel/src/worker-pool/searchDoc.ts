// 由于embedding过于占内存，只好将searchDoc抽出来
import { embedding, } from '@extension/shared';
import workerpool from 'workerpool';
// @ts-ignore
import WorkerURL from './searching?url&worker'

const searchingWorkerPool = workerpool.pool(WorkerURL);

//* doucment的定义为一个文件或notion的一个文档
// 搜索文档
const searchDocument = async (question: string) => {
    // 向量化句子
    await embedding.load()
    const embeddingOutput = await embedding.encode([question]);
    const queryVectorData = embeddingOutput.dataSync()
    embeddingOutput.dispose()

    const [lshRes, fullIndexRes] = await Promise.all([
        searchingWorkerPool.exec('searchLshIndex', [queryVectorData]),
        searchingWorkerPool.exec('searchFullTextIndex', [question]),
    ])

    return {
        lshRes,
        fullIndexRes
    }
}


workerpool.worker({
    searchDocument,
});