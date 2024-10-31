export const EMBEDDING_HIDDEN_SIZE = 768; // 目前使用的jina-embeddings-v2-base-zh模型的隐藏层大小
export const DEFAULT_INDEXDB_NAME = 'YCURATOR'; // 默认的IndexDB数据库名称
export const LSH_PROJECTION_DB_STORE_NAME = 'lsh_projection';
export const LSH_PROJECTION_DATA_NAME = 'data'; // 本地存储LSH随机向量数据属性名
export const LSH_PROJECTION_KEY_VALUE = 1; // 本地存储LSH随机向量的key值,因为只有一条数据,所以key值为1
export const LSH_INDEX_STORE_NAME = 'lsh_index';
export const TEXT_CHUNK_STORE_NAME = 'text_chunk_index';
export const MAX_LSH_CHUNK_SIZE = 1000; //LSH索引表,每条数据存储的最大chunk数量,即所有table下所有bucket里的向量或chunk数量