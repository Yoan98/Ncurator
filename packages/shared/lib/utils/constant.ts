export const EMBEDDING_HIDDEN_SIZE = 768; // 目前使用的jina-embeddings-v2-base-zh模型的隐藏层大小
export const DEFAULT_INDEXDB_NAME = 'YCURATOR'; // 默认的IndexDB数据库名称
// 表名
export const LSH_PROJECTION_DB_STORE_NAME = 'lsh_projection';
export const LSH_INDEX_STORE_NAME = 'lsh_index';
export const TEXT_CHUNK_STORE_NAME = 'text_chunk_index';
export const CONNECTION_STORE_NAME = 'connection';
export const FULL_TEXT_INDEX_STORE_NAME = 'full_text_index';

export const LSH_PROJECTION_DATA_NAME = 'data'; // 本地存储LSH随机向量数据属性名
export const LSH_PROJECTION_KEY_VALUE = 1; // 本地存储LSH随机向量的key值,因为只有一条数据,所以key值为1
export const SPLITTER_BIG_CHUNK_SIZE = 1000; // 分割大文本的字符数
export const SPLITTER_BIG_CHUNK_OVERLAP = 200; // 分割大文本的重叠字符数

export const SPLITTER_MINI_CHUNK_SIZE = 150; // 分割小文本的字符数
export const SPLITTER_MINI_CHUNK_OVERLAP = 30; // 分割小文本的重叠字符数
export const SPLITTER_SEPARATORS = ["\n\n", "\n", "。", ";", ",", " ", ""]
// 最大的embedding worker数量,后期做成动态的，让用户自己设置，默认为一，以加快storage的速度
//! 注意，一个embedding的worker内存占用近1G
export const MAX_EMBEDDING_WORKER_NUM = 4;