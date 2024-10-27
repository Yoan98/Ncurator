// 定义基础类型
interface TextChunk {
    id: string;
    text: string;
    parentId: string;  // 父文档ID
    vector: number[];  // 向量表示
    metadata?: Record<string, any>;
}

interface SearchResult {
    chunk: TextChunk;
    score: number;
}

// 向量操作工具类
class VectorUtils {
    // 计算余弦相似度
    static cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) throw new Error('Vectors must have same length');

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

// 主存储类
export class VectorStore {
    private dbName: string;
    private db: IDBDatabase | null = null;

    constructor(dbName: string) {
        this.dbName = dbName;
    }

    // 初始化数据库
    async initialize(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => reject(request.error);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // 创建主存储
                const store = db.createObjectStore('chunks', { keyPath: 'id' });

                // 创建索引
                store.createIndex('parentId', 'parentId', { unique: false });
                store.createIndex('vector', 'vector', { unique: false });

                // 为向量的每个维度创建索引以支持范围查询
                // 注意：实际使用时应根据向量维度动态创建
                for (let i = 0; i < 10; i++) {
                    store.createIndex(`vector_${i}`, `vector.${i}`, { unique: false });
                }
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
        });
    }

    // 批量存储文本块和向量
    async batchStore(chunks: TextChunk[]): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        const BATCH_SIZE = 1000;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            await new Promise<void>((resolve, reject) => {
                const transaction = this.db!.transaction('chunks', 'readwrite');
                const store = transaction.objectStore('chunks');

                batch.forEach(chunk => {
                    store.put(chunk);
                });

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
        }
    }

    // 使用LSH (Locality-Sensitive Hashing)进行向量搜索
    async search(queryVector: number[], limit: number = 10): Promise<SearchResult[]> {
        if (!this.db) throw new Error('Database not initialized');

        // 实现近似最近邻搜索
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction('chunks', 'readonly');
            const store = transaction.objectStore('chunks');
            const results: SearchResult[] = [];

            // 使用游标遍历，在实际应用中应该使用更高效的索引查询
            store.openCursor().onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;

                if (cursor) {
                    const chunk = cursor.value as TextChunk;
                    const similarity = VectorUtils.cosineSimilarity(queryVector, chunk.vector);

                    results.push({
                        chunk,
                        score: similarity
                    });

                    cursor.continue();
                } else {
                    // 排序并返回前N个结果
                    results.sort((a, b) => b.score - a.score);
                    resolve(results.slice(0, limit));
                }
            };

            transaction.onerror = () => reject(transaction.error);
        });
    }

    // 按父文档ID查询
    async getByParentId(parentId: string): Promise<TextChunk[]> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction('chunks', 'readonly');
            const store = transaction.objectStore('chunks');
            const index = store.index('parentId');
            const request = index.getAll(parentId);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // 清理数据库
    async clear(): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction('chunks', 'readwrite');
            const store = transaction.objectStore('chunks');
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

// 工具函数：将大文本分割成小块
function splitTextIntoChunks(text: string, maxLength: number = 500): string[] {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
        if ((currentChunk + sentence).length <= maxLength) {
            currentChunk += sentence;
        } else {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = sentence;
        }
    }

    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
}