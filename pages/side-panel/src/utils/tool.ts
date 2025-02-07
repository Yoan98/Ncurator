import { CHAT_SYSTEM_PROMPT, KNOWLEDGE_USER_PROMPT } from '@src/config'
import type { LlmEngineController } from '@src/utils/LlmEngineController'
import { STORAGE_DEPPSEEK_API_INFO } from '@src/utils/constant'

// 检测WebGPU是否可用
export async function checkWebGPU() {
    //@ts-ignore
    if (!navigator.gpu) {
        console.error("WebGPU is not supported.");
        return false;
    }
    try {
        //@ts-ignore
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
            return true;
        } else {
            console.error("WebGPU is supported but no suitable adapter was found.");
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

export function getFileName(fileName: string) {
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex === -1) return fileName;  // 没有扩展名时返回文件名本身
    return fileName.substring(0, dotIndex);
}


export function getSearchResMaxTextSize(llmEngine: LlmEngineController) {
    const contextWindowSize = llmEngine.modelInfo.contextWindowSize;
    const promoteTokenSize = calculateTokens([CHAT_SYSTEM_PROMPT, KNOWLEDGE_USER_PROMPT])

    return contextWindowSize - promoteTokenSize - 100
}


export function calculateTokens(content: string[]): number {
    // 判断中文字符的正则
    const chineseRegex = /[\u4e00-\u9fa5]/;
    // 匹配英文字符和标点符号的正则
    const englishRegex = /[a-zA-Z0-9]/;

    let totalTokens = 0;
    content.forEach((msg) => {
        for (let i = 0; i < msg.length; i++) {
            const char = msg[i];

            if (chineseRegex.test(char)) {
                // 中文字符按每个字符算一个token
                totalTokens += 1;
            } else if (englishRegex.test(char)) {
                // 英文字符按每 8 个字符算一个token
                // 这里只考虑英文单个字符的计数，最终用 word 来统计词的数量
                let wordStart = i;
                while (i < msg.length && englishRegex.test(msg[i])) {
                    i++;
                }
                const word = msg.slice(wordStart, i);
                totalTokens += Math.ceil(word.length / 8);
                i--; // 因为for循环会继续自增，需要回退一步
            } else {
                // 标点符号算一个token
                totalTokens += 1;
            }
        }
    });

    console.log('msgTokens', totalTokens)

    return totalTokens;
}

// 获取当前激活的标签页信息
export const getActiveTabInfo = (): Promise<CurTabPageInfo> => {

    return new Promise((resolve, reject) => {

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];

            if (!tab || !tab.id) {
                return reject('No active tab');
            }

            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    return document.documentElement.innerHTML;
                }
            }, (result) => {
                if (!result || !result[0] || !result[0].result) {
                    return reject('No tab result');
                }
                const curTabHtml = result[0].result;
                if (!curTabHtml) {
                    return reject('No tab content');
                }

                resolve({ title: tab.title || '', url: tab.url || '', tabId: tab.id, rawHtml: curTabHtml });
            })

        });


    })
}

// 根据模型名称获取localstorage的key
export const getLlmModelStorageKey = (id: string): string => {
    const LLM_CUSTOM_STORAGE_KEY_MAP = {
        'deepseek': STORAGE_DEPPSEEK_API_INFO
    }

    return LLM_CUSTOM_STORAGE_KEY_MAP[id]
}

// sleep函数
export const sleep = (ms: number = 100) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}