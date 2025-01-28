import { globalConstant } from '@extension/shared';

export const DEFAULT_INDEXDB_NAME = globalConstant.DEFAULT_INDEXDB_NAME; // 默认的IndexDB数据库名称
// 表名
export const LSH_PROJECTION_DB_STORE_NAME = globalConstant.LSH_PROJECTION_DB_STORE_NAME;
export const LSH_INDEX_STORE_NAME = globalConstant.LSH_INDEX_STORE_NAME;
export const TEXT_CHUNK_STORE_NAME = globalConstant.TEXT_CHUNK_STORE_NAME;
export const CONNECTION_STORE_NAME = globalConstant.CONNECTION_STORE_NAME;
export const FULL_TEXT_INDEX_STORE_NAME = globalConstant.FULL_TEXT_INDEX_STORE_NAME;
export const DOCUMENT_STORE_NAME = globalConstant.DOCUMENT_STORE_NAME;
export const RESOURCE_STORE_NAME = globalConstant.RESOURCE_STORE_NAME;

export const LSH_PROJECTION_DATA_NAME = 'data'; // 本地存储LSH随机向量数据属性名
export const LSH_PROJECTION_KEY_VALUE = 1; // 本地存储LSH随机向量的key值,因为只有一条数据,所以key值为1

// 最大的embedding worker数量,后期做成动态的，让用户自己设置，默认为一，以加快storage的速度
//! 注意，一个embedding的worker内存占用近1G(少量数据情况下)
export const MAX_EMBEDDING_WORKER_NUM = 4;

export const enum Connector {
    File = 1,
    Crawl
}
export const DocumentStatus = globalConstant.DocumentStatus
export const enum EncodePrefix {
    SearchDocument = 'search_document',
    SearchQuery = 'search_query'
}
export enum MessageType {
    USER = 'user',
    ASSISTANT = 'assistant',
};
export enum ModelSort {
    Api = 1,
    Webllm
}
export const STORAGE_DEFAULT_MODEL_ID = 'defaultModelId'; // localStorage中默认模型id的名称
export const STORAGE_LOADED_MODEL_IDS = 'loadedModelIds'; // localStorage中


export const ZH_STOP_WORDS = '的 一 不 在 人 有 是 为 為 以 于 於 上 他 而 后 後 之 来 來 及 了 因 下 可 到 由 这 這 与 與 也 此 但 并 並 个 個 其 已 无 無 小 我 们 們 起 最 再 今 去 好 只 又 或 很 亦 某 把 那 你 乃 它 吧 被 比 别 趁 当 當 从 從 得 打 凡 儿 兒 尔 爾 该 該 各 给 給 跟 和 何 还 還 即 几 幾 既 看 据 據 距 靠 啦 另 么 麽 每 嘛 拿 哪 您 凭 憑 且 却 卻 让 讓 仍 啥 如 若 使 谁 誰 虽 雖 随 隨 同 所 她 哇 嗡 往 些 向 沿 哟 喲 用 咱 则 則 怎 曾 至 致 着 著 诸 諸 自'.split(' ')
export const EN_STOP_WORDS = "a about above after again against all am an and any are aren't as at be because been before being below between both but by can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves".split(' ');

export const ERROR_COLOR = '#ff4d4f'
export const WARNING_COLOR = '#faad14'
export const SUCCESS_COLOR = '#52c41a'

export const UN_TEXT_TAGS = ['script', 'style', 'svg', 'img', 'canvas', 'audio', 'video', 'object', 'embed', 'applet', 'map', 'area']

export const LLM_MODEL_LIST = [
    // API 模型
    {
        sort: ModelSort.Api,
        apiKey: 'sk-da34773d39e948129436839cae2bea4d',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        name: 'Qwen',
        modelId: 'qwen-turbo-latest',
        contextWindowSize: 12800,
    },

    // WebLLM 模型
    {
        sort: ModelSort.Webllm,
        name: 'Qwen2.5-3B',
        modelSizeType: 2,
        modelId: 'Qwen2.5-3B-Instruct-q4f32_1-MLC',
        wasmFileName: 'Qwen2.5-3B-Instruct-q4f32_1-ctx4k_cs1k-webgpu.wasm',
        vramRequiredMB: 2893,
        contextWindowSize: 4096,
    },
    {
        sort: ModelSort.Webllm,
        name: 'Qwen2.5-7B',
        modelSizeType: 1,
        modelId: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',
        wasmFileName: 'Qwen2-7B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm',
        vramRequiredMB: 5106,
        contextWindowSize: 4096,
    },
    {
        sort: ModelSort.Webllm,
        name: 'Llama-3.2-3B',
        modelSizeType: 2,
        modelId: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
        wasmFileName: 'Llama-3.2-3B-Instruct-q4f32_1-ctx4k_cs1k-webgpu.wasm',
        vramRequiredMB: 2951,
        contextWindowSize: 4096

    },
    {
        sort: ModelSort.Webllm,
        name: 'Llama-3.1-8B',
        modelSizeType: 1,
        modelId: 'Llama-3.1-8B-Instruct-q4f16_1-MLC',
        wasmFileName: 'Llama-3_1-8B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm',
        vramRequiredMB: 5001,
        contextWindowSize: 4096

    },]
