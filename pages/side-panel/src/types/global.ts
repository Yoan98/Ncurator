
type ValueOf<T> = T[keyof T]
type ConnectorUnion = 0 | 1
type DocumentStatusUnion = 1 | 2 | 3
type EncodePrefixUnion = 'search_document' | 'search_query'

interface Window {
    gIsSupportWebGPU: boolean
}

namespace Chat {
    type UiMessageType = 'user' | 'assistant'
    type LlmRole = 'user' | 'assistant' | 'system'
    export interface LlmMessage {
        role: LlmRole;
        content
    }
    export interface UiMessage {
        type: UiMessageType;
        content: string;
        timestamp: string;
        relateDocs?: Search.TextItemRes[];
    }
    export interface LocalHistory {
        historyId: number
        uiMessages: UiMessage[]
        llmMessages: { role: LlmRole, content: string }[]
    }
}

namespace Search {
    export type TextItemRes = (DB.TEXT_CHUNK & { document: DB.DOCUMENT, score: number })
    export interface LshItemRes {
        id: number,
        similarity: number
    }
}
namespace Storage {
    export interface DocItemRes {
        status: 'Success' | 'Fail'
        document: DB.DOCUMENT
        error?: any
        connectionAfterIndexBuild?: DB.CONNECTION
    }
}

namespace DB {
    // chunk表
    export interface TEXT_CHUNK {
        id?: number;
        text: string;
        metadata?: {
            loc: {
                lines: {
                    from: number;
                    to: number;
                }
                pageNumber: number;
            }
        }
        document_id: number
    }
    // LSH随机向量表
    export interface LSH_PROJECTION {
        id: number;
        data: number[][];
    }
    // LSH索引表
    export type LSHTables = Map<string, HashBucket>[]
    export interface HashBucket {
        id: string; // 哈希签名即桶ID
        vectors: {
            id: number;
            vector: Float32Array;
        }[];  // 向量集合
    }
    export interface LSH_INDEX {
        id: number;
        lsh_table: LSHTables;
    }
    // document表
    export interface DOCUMENT {
        id?: number;
        name: string;
        text_chunk_id_range: {
            from: number;
            to: number;
        };
        lsh_index_ids: number[];
        full_text_index_ids: number[];
        resource?: {
            id: number
            size: number
            type: string
        }
        created_at: string // iso string
        status: DocumentStatusUnion // 1: building 2: fail 3: success
        connection: {
            id: number
            name: string
        }
    }
    // resource表,存储相关文件信息
    export interface RESOURCE {
        id?: number;
        name: string;
        type: string;
        created_at: string;
        file: File;
        size: number;
    }
    // connection表 记录相关配置,以及document的关联等
    export interface CONNECTION {
        id?: number;
        name: string;
        documents: { id: number, name: string }[];
        lsh_index_ids: number[];
        full_text_index_ids: number[];
        connector: ConnectorUnion; // 参考constant.ts的Connector
        // 相关配置等,如gmail,notion等
    }
    export type ConnectionDocUnion = DB.CONNECTION & { documentList: DB.DOCUMENT[] }
    // full text索引表
    export interface FULL_TEXT_INDEX {
        id: number;
        index: object;
    }
}