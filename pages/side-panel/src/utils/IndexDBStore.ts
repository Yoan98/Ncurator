import * as constant from './constant';

// 主存储类
export class IndexDBStore {
    private dbName: string;
    private db: IDBDatabase | null = null;

    constructor() {
    }

    // 连接数据库
    connect(dbName: string, initialStoreCb?: (db: IDBDatabase) => void): Promise<IDBDatabase> {

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);

            this.dbName = dbName;

            request.onerror = () => reject(request.error);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                if (dbName === constant.DEFAULT_INDEXDB_NAME) {
                    this.initialRAGStore(db);
                } else {
                    initialStoreCb && initialStoreCb(db)
                }
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
        });
    }

    // 初始化表与索引
    private async initialRAGStore(db: IDBDatabase) {
        // 创建document表
        db.createObjectStore(constant.DOCUMENT_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        // 创建LSH随机向量表
        db.createObjectStore(constant.LSH_PROJECTION_DB_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        // 创建connection表
        db.createObjectStore(constant.CONNECTION_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        // 创建text chunk表
        db.createObjectStore(constant.TEXT_CHUNK_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        // 创建LSH索引表
        db.createObjectStore(constant.LSH_INDEX_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        // 创建full text索引表
        db.createObjectStore(constant.FULL_TEXT_INDEX_STORE_NAME, { keyPath: 'id', autoIncrement: true });

    }
    startTransaction(storeName: string | string[], mode: IDBTransactionMode): IDBTransaction {
        if (!this.db) throw new Error('Database not initialized');

        return this.db.transaction(storeName, mode);
    }
    // 创建connection
    // 插入数据
    add({ storeName, data, transaction }: {
        storeName: string;
        data: Record<string, any>;
        transaction?: IDBTransaction
    }): Promise<number> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            if (!transaction) {
                transaction = this.db!.transaction(storeName, 'readwrite');
            }
            const store = transaction.objectStore(storeName);

            const addRes = store.add(data);
            let addId: number;
            addRes.onsuccess = () => {
                addId = addRes.result as number;
                resolve(addId);
            };

            addRes.onerror = () => {
                transaction!.abort();
                reject(addRes.error)
            };
        });
    }
    // 批量插入数据,返回插入后的数据包含id
    addBatch<T>({ storeName, data, transaction }: {
        storeName: string;
        data: T[];
        transaction?: IDBTransaction
    }): Promise<(T & { id: number })[]> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            if (!transaction) {
                transaction = this.db!.transaction(storeName, 'readwrite');
            }
            const store = transaction.objectStore(storeName);

            const res: (T & { id: number })[] = [];
            data.forEach((item, index) => {
                const addRes = store!.add(item);
                addRes.onsuccess = () => {
                    const item = {
                        ...data[index],
                        id: addRes.result as number
                    }
                    res.push(item);

                    if (res.length === data.length) {
                        resolve(res);
                    }
                };

                addRes.onerror = () => {
                    transaction!.abort();
                    reject(addRes.error)
                };
            });

        });
    }
    // put数据,如果存在则更新，不存在则插入
    // 表设计都是用的是in-line key,所以不需要指定key,只需保证data里有id字段即可
    put({ storeName, data, transaction }: {
        storeName: string;
        data: Record<string, any>;
        transaction?: IDBTransaction
    }): Promise<number> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            if (!transaction) {
                transaction = this.db!.transaction(storeName, 'readwrite');
            }
            const store = transaction.objectStore(storeName);


            const putRes = store.put(data);
            let putId: number;
            putRes.onsuccess = () => {
                putId = putRes.result as number;
                resolve(putId);
            };

            putRes.onerror = () => {
                transaction!.abort();
                reject(putRes.error)
            };
        });
    }
    // 删除数据
    delete({ storeName, key, transaction }: {
        storeName: string;
        key: IDBValidKey | IDBKeyRange;
        transaction?: IDBTransaction
    }): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            if (!transaction) {
                transaction = this.db!.transaction(storeName, 'readwrite');
            }

            const store = transaction.objectStore(storeName);

            const delRes = store.delete(key);

            delRes.onsuccess = () => resolve();
            delRes.onerror = () => {
                transaction!.abort();
                reject(delRes.error);
            };
        });
    }

    // 删除多个数据
    deleteBatch({ storeName, keys, transaction }: {
        storeName: string;
        keys: number[];
        transaction?: IDBTransaction
    }): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            if (!transaction) {
                transaction = this.db!.transaction(storeName, 'readwrite');
            }

            const store = transaction.objectStore(storeName);

            const res: any[] = [];
            keys.forEach(key => {
                const delRes = store.delete(key);
                delRes.onsuccess = () => {
                    res.push(key);

                    if (res.length === keys.length) {
                        resolve();
                    }
                };

                delRes.onerror = () => {
                    transaction!.abort();
                    reject(delRes.error);
                };
            });

        });
    }
    // 查询单个数据
    get({ storeName, key, indexName, transaction }: {
        storeName: string;
        key: IDBValidKey | IDBKeyRange;
        indexName?: string;
        transaction?: IDBTransaction
    }): Promise<any> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            if (!transaction) {
                transaction = this.db!.transaction(storeName, 'readonly');
            }
            const store = transaction.objectStore(storeName);

            let request: IDBRequest;
            if (indexName) {
                const index = store.index(indexName);
                request = index.get(key);
            } else {
                request = store.get(key);
            }

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                transaction!.abort();
                reject(request.error);
            };
        });
    }
    // 查询连续范围数据,或者全部数据
    getAll({ storeName, indexName, key }: {
        storeName: string;
        indexName?: string;
        key?: IDBKeyRange
    }): Promise<any> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);

            let request: IDBRequest;
            if (indexName) {
                const index = store.index(indexName);
                request = index.getAll(key);
            } else {
                request = store.getAll(key);
            }

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    // 查询非连续范围数据
    // 先只使用get,遍历取,后面再优化范围查询
    getBatch({ storeName, indexName, keys }: {
        storeName: string;
        indexName?: string;
        keys: number[]
    }): Promise<any> {
        if (!this.db) throw new Error('Database not initialized');
        if (!keys.length) return Promise.resolve([]);

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);

            let proxyStore = indexName ? store.index(indexName) : store;

            const res: any[] = []
            for (const key of keys) {
                const request = proxyStore.get(key);
                request.onsuccess = () => {
                    res.push(request.result)

                    if (res.length === keys.length) {
                        resolve(res.filter(item => item));
                    }
                }

                request.onerror = () => reject(request.error);
            }

        });
    }
}
