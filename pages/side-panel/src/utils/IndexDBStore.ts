import * as constant from './constant';

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
        // 创建connection表
        db.createObjectStore(constant.CONNECTION_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        // 创建full text索引表
        db.createObjectStore(constant.FULL_TEXT_INDEX_STORE_NAME, { keyPath: 'id', autoIncrement: true });

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
        key: IDBValidKey | IDBKeyRange;
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
                        resolve(res)
                    }
                }

                request.onerror = () => reject(request.error);
            }

        });
    }
}
