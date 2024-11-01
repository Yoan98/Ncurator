import * as constant from './constant';


export interface TextChunk {
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

interface SearchResult {
    chunk: TextChunk;
    score: number;
}

// 主存储类
export class IndexDBStore {
    private dbName: string;
    private db: IDBDatabase | null = null;

    constructor() {
    }

    // 连接数据库
    connect(dbName: string): Promise<IDBDatabase> {

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);

            this.dbName = dbName;

            request.onerror = () => reject(request.error);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                this.initialStore(db);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
        });
    }

    // 初始化表与索引
    private initialStore(db: IDBDatabase): void {
        // 创建主存储表
        db.createObjectStore(constant.TEXT_CHUNK_STORE_NAME, { keyPath: 'id', autoIncrement: true });

        // 创建LSH随机向量表
        db.createObjectStore(constant.LSH_PROJECTION_DB_STORE_NAME, { keyPath: 'id', autoIncrement: true });

        // 创建LSH索引表
        db.createObjectStore(constant.LSH_INDEX_STORE_NAME, { keyPath: 'id', autoIncrement: true });

        console.log('IndexDB Store initialized');
    }

    // 插入数据
    add({ storeName, data }: {
        storeName: string;
        data: Record<string, any>;
    }): Promise<IDBValidKey> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);

            const addRes = store.add(data);
            let addId: IDBValidKey;
            addRes.onsuccess = () => {
                addId = addRes.result;
            };
            transaction.oncomplete = () => resolve(addId);
            transaction.onerror = () => reject(transaction.error);
        });
    }
    // 批量插入数据,返回插入后的数据包含id
    addBatch<T>({ storeName, data }: {
        storeName: string;
        data: T[];
    }): Promise<(T & { id: IDBValidKey })[]> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);

            data.forEach((item, index) => {
                const addRes = store.add(item);

                addRes.onsuccess = () => {
                    // @ts-ignore
                    data[index].id = addRes.result;
                };
            });

            // @ts-ignore
            transaction.oncomplete = () => resolve(data);
            transaction.onerror = () => reject(transaction.error);
        });
    }
    // put数据,如果存在则更新，不存在则插入
    put({ storeName, data }: {
        storeName: string;
        data: Record<string, any>;
    }): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);

            store.put(data);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }
    // 删除数据
    delete({ storeName, key }: {
        storeName: string;
        key: string | number;
    }): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);

            store.delete(key);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }
    // 查询单个数据
    get({ storeName, key, indexName }: {
        storeName: string;
        key: string | number;
        indexName?: string;
    }): Promise<any> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);

            let request: IDBRequest;
            if (indexName) {
                const index = store.index(indexName);
                request = index.get(key);
            } else {
                request = store.get(key);
            }

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    // 查询所有数据
    getAll({ storeName, indexName }: {
        storeName: string;
        indexName?: string;
    }): Promise<any> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);

            let request: IDBRequest;
            if (indexName) {
                const index = store.index(indexName);
                request = index.getAll();
            } else {
                request = store.getAll();
            }

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }



    // 使用LSH (Locality-Sensitive Hashing)进行向量搜索
    // async search(queryVector: number[], limit: number = 10): Promise<SearchResult[]> {
    //     if (!this.db) throw new Error('Database not initialized');

    //     // 实现近似最近邻搜索
    //     return new Promise((resolve, reject) => {
    //         const transaction = this.db!.transaction('chunks', 'readonly');
    //         const store = transaction.objectStore('chunks');
    //         const results: SearchResult[] = [];

    //         // 使用游标遍历，在实际应用中应该使用更高效的索引查询
    //         store.openCursor().onsuccess = (event) => {
    //             const cursor = (event.target as IDBRequest).result;

    //             // if (cursor) {
    //             //     const chunk = cursor.value as TextChunk;
    //             //     const similarity = VectorUtils.cosineSimilarity(queryVector, chunk.vector);

    //             //     results.push({
    //             //         chunk,
    //             //         score: similarity
    //             //     });

    //             //     cursor.continue();
    //             // } else {
    //             //     // 排序并返回前N个结果
    //             //     results.sort((a, b) => b.score - a.score);
    //             //     resolve(results.slice(0, limit));
    //             // }
    //         };

    //         transaction.onerror = () => reject(transaction.error);
    //     });
    // }

}
