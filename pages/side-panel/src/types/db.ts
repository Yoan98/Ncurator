import { LSHTables } from '../utils/VectorIndex';

export namespace DB {
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
    }
    // LSH随机向量表
    export interface LSH_PROJECTION {
        id: number;
        data: number[][];
    }
    // LSH索引表
    export interface LSH_INDEX {
        id: number;
        lsh_table: LSHTables;
    }
    // connection表
    export interface CONNECTION {
        id?: number;
        connector_type: 'file' | 'notion';
        text_chunk_ids: number[];
        lsh_index_ids: number[];
        full_text_index_ids: number[];
        resource?: File
    }
    // full text索引表
    export interface FULL_TEXT_INDEX {
        id: number;
        index: object;
    }
}