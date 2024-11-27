
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