// build lsh(embedding) index relate
export const BUILD_INDEX_EMBEDDING_WORKER_NUM = 1; // embedding 开启worker数量(只有使用cpu时才有用)
export const BUILD_INDEX_CHUNKS_BATCH_SIZE = 100; // 分批构建索引时,每次处理的chunk数量,该值控制整体构建索引时,批量处理数据的大小
export const BUILD_INDEX_EMBEDDING_BATCH_SIZE = 10; // 每次embedding的chunk数量(只有使用GPU时才有用),该值控制增GPU每次embedding处理数据的大小

// search relate
export const SEARCHED_VECTOR_WEIGHT = 0.8; // 向量的权重
export const SEARCHED_FULL_TEXT_WEIGHT = 0.2; // 全文索引的权重

// split chunk relate
export const SPLITTER_BIG_CHUNK_SIZE = 1000; // 分割大文本的字符数
export const SPLITTER_BIG_CHUNK_OVERLAP = 200; // 分割大文本的重叠字符数
export const SPLITTER_MINI_CHUNK_SIZE = 150; // 分割小文本的字符数
export const SPLITTER_MINI_CHUNK_OVERLAP = 30; // 分割小文本的重叠字符数
export const SPLITTER_SEPARATORS = ["\n\n", "\n", "。", ";", ",", " ", ""]

// embedding model relate
export const DEFAULT_EMBEDDING_MODEL = 'jinaai/jina-embeddings-v2-base-zh'
// export const DEFAULT_EMBEDDING_MODEL = 'nomic-ai/nomic-embed-text-v1'
export const EMBEDDING_HIDDEN_SIZE = 768; // 目前使用的两个模型都是768维的向量

// other
export const THEME_COLOR = '#404040'; // 主题色