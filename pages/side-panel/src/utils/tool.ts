import init, * as jieba from 'jieba-wasm';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import { EmbedTaskManage } from '@src/utils/EmbedTask'
import type { EmbedTask } from '@src/utils/EmbedTask'
import * as constant from '@src/utils/constant';
import workerpool from 'workerpool';
import * as config from '@src/config';
// @ts-ignore
import searchWorkerURL from '@src/worker-pool/search?url&worker'

const searchingWorkerPool = workerpool.pool(searchWorkerURL, {
    maxWorkers: config.SEARCH_WORKER_NUM,
});

// 检测WebGPU是否可用
export async function checkWebGPU() {
    //@ts-ignore
    if (!navigator.gpu) {
        console.log("WebGPU is not supported.");
        return false;
    }
    try {
        //@ts-ignore
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
            console.log("WebGPU is available and the adapter was successfully created.");
            return true;
        } else {
            console.log("WebGPU is supported but no suitable adapter was found.");
            return false;
        }
    } catch (error) {
        console.error("An error occurred while requesting the WebGPU adapter:", error);
        return false;
    }
}

/**
 * 将文件大小转换为适当的单位（B、KB、MB、GB）
 * @param file - File 对象
 * @returns 文件大小的字符串表示（带单位）
 */
export function formatFileSize(size: number): string {
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;

    if (size < GB) {
        return `${(size / MB).toFixed(2)} MB`; // 小于 1 GB 显示为 MB，保留两位小数
    } else {
        return `${(size / GB).toFixed(2)} GB`; // 1 GB 及以上显示为 GB，保留两位小数
    }
}

const zhStopWords = '的 一 不 在 人 有 是 为 為 以 于 於 上 他 而 后 後 之 来 來 及 了 因 下 可 到 由 这 這 与 與 也 此 但 并 並 个 個 其 已 无 無 小 我 们 們 起 最 再 今 去 好 只 又 或 很 亦 某 把 那 你 乃 它 吧 被 比 别 趁 当 當 从 從 得 打 凡 儿 兒 尔 爾 该 該 各 给 給 跟 和 何 还 還 即 几 幾 既 看 据 據 距 靠 啦 另 么 麽 每 嘛 拿 哪 您 凭 憑 且 却 卻 让 讓 仍 啥 如 若 使 谁 誰 虽 雖 随 隨 同 所 她 哇 嗡 往 些 向 沿 哟 喲 用 咱 则 則 怎 曾 至 致 着 著 诸 諸 自'.split(' ')
const enStopWords = "a about above after again against all am an and any are aren't as at be because been before being below between both but by can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves".split(' ');


// 分割关键词,英文按照空格,中文按照jieba分词
export async function splitKeywords(keywords: string) {
    //@ts-ignore
    await init()
    const reg = new RegExp("[\\u4E00-\\u9FFF]+");
    if (reg.test(keywords)) {
        return jieba.cut_for_search(keywords).filter(word => !zhStopWords.includes(word)) as string[];
    } else {
        const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
        const segments = Array.from(segmenter.segment(keywords));
        const words = segments.map(segment => segment.segment).filter(word => !enStopWords.includes(word.toLowerCase()));

        return words;
    }
}


export function getWebLlmCacheType(fileName: string) {
    if (fileName.includes(".wasm")) {
        return "webllm/wasm";
    } else if (
        fileName.includes(".bin") ||
        fileName.includes("ndarray-cache.json") ||
        fileName.includes("tokenizer.json")
    ) {
        return "webllm/model";
    } else if (fileName.includes("mlc-chat-config.json")) {
        return "webllm/config";
    } else {
        console.log("No model file suffix found");
        return "file-cache";
    }
}
// 下载LLM模型文件
export async function downloadLlmModelFiles(
    modelId: string,
    modelLibURLPrefix: string,
    modelVersion: string,
    wasmFileName: string,
    onProgress: (progressPercent: number) => void
): Promise<void> {
    // 构建基础URL
    const huggingfaceBaseUrl = `https://huggingface.co/mlc-ai/${modelId}/resolve/main`;
    const wasmBaseUrl = `${modelLibURLPrefix}${modelVersion}`;

    // 工具函数：获取文件内容
    async function fetchFile(url: string) {
        const cache = await caches.open(getWebLlmCacheType(url));
        const cachedResponse = await cache.match(url);
        if (cachedResponse) {
            return cachedResponse;
        }

        const response = await fetch(url, {
            headers: {
                "Content-Type": "application/octet-stream"
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }
        return response;
    }


    // 先获取 ndarray-cache.json
    const ndarrayResponse = await fetchFile(`${huggingfaceBaseUrl}/ndarray-cache.json`)
    const clonedResponse = ndarrayResponse.clone();
    // 解析 ndarray-cache.json 获取需要下载的文件列表
    const ndarrayContent = await ndarrayResponse.json();
    const records: {
        dataPath: string;
        nbytes: number;
    }[] = ndarrayContent.records;

    const cache = await caches.open(getWebLlmCacheType('ndarray-cache.json'));
    await cache.put(`${huggingfaceBaseUrl}/ndarray-cache.json`, clonedResponse);


    // 收集所有需要下载的文件
    interface DownloadFile {
        name: string;
        url: string;
        type: 'text' | 'arraybuffer';
        size: number;
    }

    const filesToDownload: DownloadFile[] = [
        // 必需的JSON文件
        {
            name: 'mlc-chat-config.json',
            url: `${huggingfaceBaseUrl}/mlc-chat-config.json`,
            type: 'text',
            size: 0,
        },
        {
            name: 'tokenizer.json',
            url: `${huggingfaceBaseUrl}/tokenizer.json`,
            type: 'arraybuffer',
            size: 0,
        },
        // WASM文件
        {
            name: `${wasmFileName}`,
            url: `${wasmBaseUrl}/${wasmFileName}`,
            type: 'arraybuffer',
            size: 0,
        }
    ];

    // 添加从ndarray-cache中解析出的bin文件
    records.forEach(record => {
        if (record.dataPath.endsWith('.bin')) {
            filesToDownload.push({
                name: record.dataPath,
                url: `${huggingfaceBaseUrl}/${record.dataPath}`,
                type: 'arraybuffer',
                size: record.nbytes
            });
        }
    });

    // 计算总大小用于进度计算
    const binFileTotalSize = filesToDownload.filter(file => file.url.endsWith('.bin')).reduce((acc, file) => acc + file.size, 0);
    let downloadedSize = 0;
    let progressPercent = 0;

    // 依次下载所有文件
    for (const file of filesToDownload) {
        try {
            const response = await fetchFile(file.url);
            const cache = await caches.open(getWebLlmCacheType(file.name));
            await cache.put(file.url, response);

            // 更新进度
            downloadedSize += file.size || 0;
            progressPercent = downloadedSize / binFileTotalSize
            onProgress(progressPercent);
        } catch (error) {
            console.error(`Error downloading ${file.name}:`, error);
            throw new Error(`Failed to download ${file.name}: ${error.message}`);
        }
    }
}
// 上传模型文件
export async function uploadByCacheFiles(modelId: string, files: File[], modelLibURLPrefix, modelVersion): Promise<void> {
    async function cacheFile(file: File, response: Response) {
        const cache = await caches.open(getWebLlmCacheType(file.name)); // Ensure getFileType is a synchronous function or awaited if async

        let urlPrefix = file.name.includes('wasm') ? `${modelLibURLPrefix}${modelVersion}/` : `https://huggingface.co/mlc-ai/${modelId}/resolve/main/`

        const url = `${urlPrefix}${file.name}`;
        await cache.put(url, response);
    }
    for (const file of files) {
        let fileContent = await file.arrayBuffer()

        const response = new Response(fileContent, {
            status: 200,
            statusText: "OK",
            headers: {
                "Content-Type": "application/octet-stream",
                "Content-Length": fileContent.byteLength.toString(),
            },
        });
        await cacheFile(file, response);
    }
}

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
    let [lshRes, fullIndexRes] = await Promise.all([
        searchLshIndex(),
        searchFullTextIndex(),
    ]) as [Search.LshItemRes[], lunr.Index.Result[]]
    console.timeEnd('search index total')


    // 将全文索引排序，然后使用max归一化
    if (fullIndexRes.length) {
        fullIndexRes = fullIndexRes.sort((a, b) => b.score - a.score)
        const maxScore = fullIndexRes[0].score
        fullIndexRes = fullIndexRes.map((item) => {
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
        const sameIndex = fullIndexRes.findIndex((fullItem) => Number(fullItem.ref) === lshItem.id)
        if (sameIndex === -1) {
            // 只有向量索引
            mixIndexSearchedRes.push({
                id: lshItem.id,
                score: lshItem.similarity * vectorWeight,
            })
        } else {
            // 向量索引与全文索引同一个text_chunk id
            mixIndexSearchedRes.push({
                id: lshItem.id,
                score: (lshItem.similarity * vectorWeight) + (fullTextWeight * fullIndexRes[sameIndex].score),
            })
            alreadyFullIndexIds.push(lshItem.id)
        }
    })
    fullIndexRes.forEach((item) => {
        if (alreadyFullIndexIds.includes(Number(item.ref))) {
            return
        }
        mixIndexSearchedRes.push({
            id: Number(item.ref),
            score: item.score * fullTextWeight,
        })
    })
    mixIndexSearchedRes = mixIndexSearchedRes.sort((a, b) => b.score - a.score)

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
        fullIndexRes,
        mixIndexSearchedRes,
        searchedRes,
    })

    return {
        searchedRes
    }
}
