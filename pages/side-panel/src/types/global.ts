
type ValueOf<T> = T[keyof T]

enum Connector {
    File,
    Notion
}
type ConnectorUnion = ValueOf<Connector>

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
        connection_id: number
        text_chunk_id_range: {
            from: number;
            to: number;
        };
        lsh_index_id: number;
        full_text_index_id: number;
        resource?: File
    }
    // connection表 记录相关配置,以及document的关联等
    export interface CONNECTION {
        id: number;
        name: string;
        documents: { id: number, name: string }[];
        // 相关配置等,如gmail,notion等
    }
    // full text索引表
    export interface FULL_TEXT_INDEX {
        id: number;
        index: object;
    }
}