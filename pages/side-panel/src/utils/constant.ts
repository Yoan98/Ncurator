
export const DEFAULT_INDEXDB_NAME = 'YCURATOR'; // 默认的IndexDB数据库名称
// 表名
export const LSH_PROJECTION_DB_STORE_NAME = 'lsh_projection';
export const LSH_INDEX_STORE_NAME = 'lsh_index';
export const TEXT_CHUNK_STORE_NAME = 'text_chunk_index';
export const CONNECTION_STORE_NAME = 'connection';
export const FULL_TEXT_INDEX_STORE_NAME = 'full_text_index';
export const DOCUMENT_STORE_NAME = 'document';
export const RESOURCE_STORE_NAME = 'resource';

export const LSH_PROJECTION_DATA_NAME = 'data'; // 本地存储LSH随机向量数据属性名
export const LSH_PROJECTION_KEY_VALUE = 1; // 本地存储LSH随机向量的key值,因为只有一条数据,所以key值为1

// 最大的embedding worker数量,后期做成动态的，让用户自己设置，默认为一，以加快storage的速度
//! 注意，一个embedding的worker内存占用近1G(少量数据情况下)
export const MAX_EMBEDDING_WORKER_NUM = 4;

export const enum Connector {
    File,
    Notion
}
export const enum DocumentStatus {
    Building = 1,
    Fail,
    Success
}
export const enum EncodePrefix {
    SearchDocument = 'search_document',
    SearchQuery = 'search_query'
}
export const WEBLLM_CONFIG_INDEXDB_NAME = 'webllm/config'; // webllm配置的indexdb名称
export const WEBLLM_CONFIG_STORE_NAME = 'urls'; // webllm配置的store名称
export const STORAGE_DEFAULT_MODEL_ID = 'defaultModelId'; // localStorage中默认模型id的名称
export const STORAGE_LOADED_MODEL_IDS = 'loadedModelIds'; // localStorage中

export const APP_NAME = 'YCurator'; // app名称

export const ZH_STOP_WORDS = '的 一 不 在 人 有 是 为 為 以 于 於 上 他 而 后 後 之 来 來 及 了 因 下 可 到 由 这 這 与 與 也 此 但 并 並 个 個 其 已 无 無 小 我 们 們 起 最 再 今 去 好 只 又 或 很 亦 某 把 那 你 乃 它 吧 被 比 别 趁 当 當 从 從 得 打 凡 儿 兒 尔 爾 该 該 各 给 給 跟 和 何 还 還 即 几 幾 既 看 据 據 距 靠 啦 另 么 麽 每 嘛 拿 哪 您 凭 憑 且 却 卻 让 讓 仍 啥 如 若 使 谁 誰 虽 雖 随 隨 同 所 她 哇 嗡 往 些 向 沿 哟 喲 用 咱 则 則 怎 曾 至 致 着 著 诸 諸 自'.split(' ')
export const EN_STOP_WORDS = "a about above after again against all am an and any are aren't as at be because been before being below between both but by can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves".split(' ');