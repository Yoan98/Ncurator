
export const DEFAULT_INDEXDB_NAME = 'MAIN_DB'; // 默认的IndexDB数据库名称
// 表名
let counter = 1;
function getStoreName(name: string): string {
    //todo shared的里没有配置dev模式,需要整体改,才能判断逻辑
    const isDevelopment = false
    return isDevelopment ? name : `$_${counter++}`;
}
export const LSH_PROJECTION_DB_STORE_NAME = getStoreName('lsh_projection');
export const LSH_INDEX_STORE_NAME = getStoreName('lsh_index');
export const TEXT_CHUNK_STORE_NAME = getStoreName('text_chunk_index');
export const CONNECTION_STORE_NAME = getStoreName('connection');
export const FULL_TEXT_INDEX_STORE_NAME = getStoreName('full_text_index');
export const DOCUMENT_STORE_NAME = getStoreName('document');
export const RESOURCE_STORE_NAME = getStoreName('resource');
export enum DocumentStatus {
    Building = 1,
    Fail,
    Success
}
