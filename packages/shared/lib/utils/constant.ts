
export const DEFAULT_INDEXDB_NAME = 'MAIN_DB'; // 默认的IndexDB数据库名称
export const LSH_PROJECTION_DB_STORE_NAME = 'lsh_projection'
export const LSH_INDEX_STORE_NAME = 'lsh_index'
export const TEXT_CHUNK_STORE_NAME = 'text_chunk_index'
export const CONNECTION_STORE_NAME = 'connection'
export const FULL_TEXT_INDEX_STORE_NAME = 'full_text_index'
export const DOCUMENT_STORE_NAME = 'document'
export const RESOURCE_STORE_NAME = 'resource'
export enum DocumentStatus {
    Building = 1,
    Fail,
    Success
}
