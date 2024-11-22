import init, * as jieba from 'jieba-wasm';

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
export function formatFileSize(file: File): string {
    const size = file.size; // 获取文件大小（单位：字节）
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