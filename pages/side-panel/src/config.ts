// build lsh(embedding) index relate
export const BUILD_INDEX_EMBEDDING_MAX_WORKER_NUM = 1; // embedding 开启worker数量(只有使用cpu时才有用,还未兼容,先统一设为1)
export const BUILD_INDEX_CHUNKS_BATCH_SIZE = 100; // 分批构建索引时,每批处理的chunk数量,该值控制整体构建索引时,消化chunk的速度,每一批chunk也就对应一个lsh和全文索引块,这意味着该值越大,对后续的搜索会有提升,但构建时内存占比也会越大
export const BUILD_INDEX_EMBEDDING_BATCH_SIZE = 10; // 每次embedding的chunk数量,该值控制增GPU或CPU(多worker)每次embedding处理数据的大小,这意味着该值越大,embedding的速度也会相对越快,但显存和内存占比也会越大,造成页面卡顿
export const MAX_BUILDING_MINUTES = 60; // 最大构建时间,超过该时间则认为构建出问题,可让用户继续操作

// search relate
export const SEARCHED_VECTOR_WEIGHT = 0.8; // 向量的权重
export const SEARCHED_FULL_TEXT_WEIGHT = 0.2; // 全文索引的权重
// 最多开一半的cpu核数,避免内存过大
export const SEARCH_WORKER_NUM = Math.max(2, Math.floor(navigator.hardwareConcurrency / 2)); // 搜索时开启的worker数量
// export const SEARCH_WORKER_NUM = 2; // 搜索时开启的worker数量,不能小于2
export const SEARCH_INDEX_BATCH_SIZE = 50; // 搜索索引表时,每次取的索引数据的数量
export const DEFAULT_VECTOR_SIMILARITY_THRESHOLD = 0.5; // 默认的向量相似度阈值
export const SEARCH_SCORE_THRESHOLD = 0.5; // 搜索结果的阈值
export const SEARCH_RESULT_HEADER_SLICE_SIZE = 100; // 搜索结果的头部结果截取数量

// split chunk relate
export const SPLITTER_BIG_CHUNK_SIZE = 1000; // 分割大文本的字符数
export const SPLITTER_BIG_CHUNK_OVERLAP = 200; // 分割大文本的重叠字符数
export const SPLITTER_MINI_CHUNK_SIZE = 150; // 分割小文本的字符数
export const SPLITTER_MINI_CHUNK_OVERLAP = 30; // 分割小文本的重叠字符数
export const SPLITTER_SEPARATORS = ["\n\n", "\n", "。", ";", ",", " ", ""]

// embedding model relate
export const EMBEDDING_HIDDEN_SIZE = 768; // 目前使用的两个模型都是768维的向量

// other
export const THEME_COLOR = '#404040'; // 主题色

// prompt
export const CHAT_SYSTEM_PROMPT =
    `You are a helpful AI assistant.` + '\n' +
    `Please answer the Question in the same language, where "language" refers specifically to distinct human languages (such as English, Mandarin, Spanish, etc.), not the broader concept of communication.`
export const KNOWLEDGE_USER_PROMPT = "Use the following context when answering the question at the end. Don't use any other knowledge. The documents below have been retrieved and sorted by relevance. Please use them in the order they are presented, with the most relevant ones first.If the document is not match question, ignore them."
// llm
export const LLM_GENERATE_MAX_TOKENS = 300;

export const OFFICIAL_WEBSITE = 'https://www.guanzhangai.cn'