import * as math from './math';
import * as constant from './constant';
import * as tf from '@tensorflow/tfjs';

export interface LSH_INDEX_STORE {
    id: number;
    lsh_table: LSHTables;
}
export interface LSH_PROJECTION_STORE {
    id: number;
    data: number[][];
}

interface HashBucket {
    id: string; // 哈希签名即桶ID
    vectors: {
        id: number;
        vector: Float32Array;
    }[];  // 向量集合
}

type LSHTables = Map<string, HashBucket>[]

interface LSHIndexConstructor {
    dimensions: number;
    numTables?: number;
    numHashesPerTable?: number;
    similarityThreshold?: number;
    localProjections?: number[][];
    tables?: LSHTables;
}
/**
 * LSH (Locality-Sensitive Hashing) 实现
 * * 使用时需尽量考虑,存入tables的数数量,
 * * 尽可能多存且考虑到内存大小,numTables, numHashesPerTable,计算机性能这几个因素
 * todo: 暂时先不考一组tables最大存储数量,等后续摸底实测后来调整
 */
export class LSHIndex {
    // 哈希表数量
    // 该数值越大,存储时间,空间,搜索时间增大,搜索范围性增高(变相提高搜索精度)
    // 因为哈希表越多,同一句子存在不同哈希表下不同桶的几率越大(因为不同表下的随机投影向量)
    private numTables: number;
    // 每个哈希表下桶的哈希位数
    // 该数值越大,存储时间增大,搜索时间减小(数据越大越明显)
    // 因为增加了桶的数量,减少了桶内的向量数量
    // 虽然计算每个哈希表的哈希函数时间略微增大,但这个哈希函数的时间复杂度是O(1),因为在同一组哈希表下,不会随着数据量增大而增大哈希函数的计算时间
    private numHashesPerTable: number;
    // 向量维度(一维向量的数量)
    private dimensions: number;
    // 所有的哈希表
    public tables: LSHTables;
    // 随机投影向量, 用于计算哈希签名
    public projections: number[][];
    // 相似度阈值,目前jinaai/jina-embeddings-v2-base-zh测试的感觉,超过0.5的相似度就是相似的
    private similarityThreshold: number;

    constructor({ dimensions, numTables = 10, numHashesPerTable = 4, similarityThreshold = 0.5, localProjections, tables }: LSHIndexConstructor) {
        this.dimensions = dimensions;
        this.numTables = numTables;
        this.numHashesPerTable = numHashesPerTable;
        this.similarityThreshold = similarityThreshold;

        this.initialTables(tables);
        this.projections = this.generateProjections(localProjections);
    }

    // 生成随机投影向量
    private generateProjections(localProjections?: number[][]): number[][] {
        if (localProjections?.length) {
            return localProjections
        }

        const projections: number[][] = []
        // 生成随机投影向量
        for (let i = 0; i < this.numTables * this.numHashesPerTable; i++) {
            const projection = Array(this.dimensions).fill(0)
                .map(() => (Math.random() * 2 - 1)); // 生成-1到1之间的随机数
            projections.push(projection);
        }
        return projections;
    }

    // 计算向量的LSH签名
    // 相对于数据量增加,时间复杂度O(1),因为投影向量是固定的
    private computeHash(vector: tf.Tensor1D, tableIndex: number): string {
        const signature: number[] = [];
        for (let i = 0; i < this.numHashesPerTable; i++) {
            const projIndex = tableIndex * this.numHashesPerTable + i;
            const projection = this.projections[projIndex];

            const projectionTensor = tf.tensor1d(projection);
            // 计算向量点积
            const dotProduct = vector.dot(projectionTensor) as tf.Scalar;

            // 使用符号作为hash位
            signature.push(dotProduct.dataSync()[0] > 0 ? 1 : 0);

            dotProduct.dispose();
            projectionTensor.dispose();
        }
        return signature.join('');
    }

    // 添加向量到索引
    async addVector(id: number, vector: tf.Tensor1D): Promise<void> {
        for (let i = 0; i < this.numTables; i++) {
            const hash = this.computeHash(vector, i);
            if (!this.tables[i].has(hash)) {
                this.tables[i].set(hash, { id: hash, vectors: [] });
            }
            this.tables[i].get(hash)!.vectors.push({ id, vector: vector.dataSync() as Float32Array });
        }
    }

    /**
     * 批量添加向量
     * @param vectors
     * @returns
     */
    async addVectors(vectors: { id: number, vector: tf.Tensor1D }[]): Promise<LSHTables> {
        for (let i = 0; i < vectors.length; i++) {
            const { id, vector } = vectors[i];
            await this.addVector(id, vector);
        }

        return this.tables;
    }

    initialTables(tables?: LSHTables) {
        this.tables = tables ? tables : Array(this.numTables).fill(null).map(() => new Map());
    }

    // 查找相似向量
    findSimilar({ queryVector, tables = this.tables }: {
        queryVector: tf.Tensor1D,
        tables?: LSHTables
    }): { id: number, similarity: number }[] {
        const candidate: { id: number, similarity: number }[] = []

        // 在每个hash表中查找候选项
        for (let i = 0; i < this.numTables; i++) {
            const hash = this.computeHash(queryVector, i);

            const bucket = tables[i].get(hash);
            if (bucket) {
                for (const { id, vector } of bucket.vectors) {
                    // 计算余弦相似度
                    const storageVector = tf.tensor1d(vector);
                    const similarity = math.cosineSimilarity(queryVector, storageVector);
                    storageVector.dispose();

                    if (similarity > this.similarityThreshold) {
                        if (!candidate.some(item => item.id === id)) {
                            candidate.push({
                                id,
                                similarity
                            });
                        }
                    }
                }
            }
        }

        return candidate;
    }
}


// 基础类型定义
// interface VectorNode {
//     id: string;
//     vector: number[];
//     connections: Set<string>;  // 邻居节点的ID
//     layers: number;  // HNSW层级
// }

// HNSW (Hierarchical Navigable Small World) 实现
// class HNSWIndex {
//     private maxLevel: number;
//     private levelMult: number;
//     private efConstruction: number;
//     private M: number;  // 最大邻居数
//     private nodes: Map<string, VectorNode>;
//     private entryPoint?: string;

//     constructor(maxLevel = 4, levelMult = 1 / Math.log(2), efConstruction = 40, M = 10) {
//         this.maxLevel = maxLevel;
//         this.levelMult = levelMult;
//         this.efConstruction = efConstruction;
//         this.M = M;
//         this.nodes = new Map();
//     }

//     // 计算向量距离
//     private distance(a: number[], b: number[]): number {
//         let sum = 0;
//         for (let i = 0; i < a.length; i++) {
//             const diff = a[i] - b[i];
//             sum += diff * diff;
//         }
//         return Math.sqrt(sum);
//     }

//     // 生成随机层级
//     private generateRandomLevel(): number {
//         const r = Math.random();
//         return Math.floor(-Math.log(r) * this.levelMult);
//     }

//     // 在指定层级搜索最近邻
//     private searchLayer(
//         queryVector: number[],
//         entryPoint: string,
//         ef: number,
//         level: number
//     ): string[] {
//         const visited = new Set<string>([entryPoint]);
//         const candidates = new Map<string, number>([[entryPoint, this.distance(queryVector, this.nodes.get(entryPoint)!.vector)]]);
//         const results = new Map<string, number>([[entryPoint, this.distance(queryVector, this.nodes.get(entryPoint)!.vector)]]);

//         while (candidates.size > 0) {
//             // 找到距离最近的候选节点
//             let closest = Array.from(candidates.entries())
//                 .reduce((a, b) => a[1] < b[1] ? a : b)[0];
//             candidates.delete(closest);

//             // 如果当前最远的结果比最近的候选项更近，就结束搜索
//             const furthestResult = Array.from(results.entries())
//                 .reduce((a, b) => a[1] > b[1] ? a : b)[1];
//             if (results.size >= ef && furthestResult < candidates.values().next().value) {
//                 break;
//             }

//             // 检查当前节点的所有邻居
//             const node = this.nodes.get(closest)!;
//             for (const neighborId of node.connections) {
//                 if (!visited.has(neighborId)) {
//                     visited.add(neighborId);
//                     const neighbor = this.nodes.get(neighborId)!;
//                     const distance = this.distance(queryVector, neighbor.vector);

//                     if (results.size < ef || distance < furthestResult) {
//                         candidates.set(neighborId, distance);
//                         results.set(neighborId, distance);

//                         // 保持结果集大小在ef以内
//                         if (results.size > ef) {
//                             const furthest = Array.from(results.entries())
//                                 .reduce((a, b) => a[1] > b[1] ? a : b)[0];
//                             results.delete(furthest);
//                         }
//                     }
//                 }
//             }
//         }

//         return Array.from(results.keys());
//     }

//     // 添加向量到索引
//     async addVector(id: string, vector: number[]): Promise<void> {
//         const level = Math.min(this.generateRandomLevel(), this.maxLevel);
//         const node: VectorNode = {
//             id,
//             vector,
//             connections: new Set(),
//             layers: level
//         };

//         this.nodes.set(id, node);

//         // 如果这是第一个节点，将其设为入口点
//         if (!this.entryPoint) {
//             this.entryPoint = id;
//             return;
//         }

//         let currentEntryPoint = this.entryPoint;

//         // 从最高层开始构建连接
//         for (let currentLevel = Math.min(level, this.nodes.get(this.entryPoint)!.layers);
//             currentLevel >= 0;
//             currentLevel--) {

//             // 在当前层找到最近的邻居
//             const neighbors = this.searchLayer(vector, currentEntryPoint, this.efConstruction, currentLevel);

//             // 选择最近的M个邻居
//             neighbors.slice(0, this.M).forEach(neighborId => {
//                 node.connections.add(neighborId);
//                 this.nodes.get(neighborId)!.connections.add(id);
//             });

//             // 更新入口点
//             if (currentLevel > 0) {
//                 currentEntryPoint = neighbors[0];
//             }
//         }

//         // 如果新节点的层级更高，更新入口点
//         if (level > this.nodes.get(this.entryPoint)!.layers) {
//             this.entryPoint = id;
//         }
//     }

//     // 搜索最近邻
//     async findNearest(queryVector: number[], k: number): Promise<string[]> {
//         if (!this.entryPoint) return [];

//         let currentLevel = this.nodes.get(this.entryPoint)!.layers;
//         let entryPoint = this.entryPoint;

//         // 从顶层开始向下搜索
//         while (currentLevel > 0) {
//             entryPoint = this.searchLayer(queryVector, entryPoint, 1, currentLevel)[0];
//             currentLevel--;
//         }

//         // 在底层进行最终搜索
//         return this.searchLayer(queryVector, entryPoint, k, 0);
//     }
// }

// // 组合索引管理器
// class VectorIndexManager {
//     private lshIndex: LSHIndex;
//     private hnswIndex: HNSWIndex;
//     private dimensions: number;

//     constructor(dimensions: number) {
//         this.dimensions = dimensions;
//         this.lshIndex = new LSHIndex(dimensions);
//         this.hnswIndex = new HNSWIndex();
//     }

//     // 添加向量到两个索引
//     async addVector(id: string, vector: number[]): Promise<void> {
//         await Promise.all([
//             this.lshIndex.addVector(id, vector),
//             this.hnswIndex.addVector(id, vector)
//         ]);
//     }

//     // 使用两阶段搜索：先用LSH快速筛选，再用HNSW精确排序
//     async search(queryVector: number[], limit: number): Promise<string[]> {
//         // 第一阶段：LSH快速筛选候选集
//         const candidates = await this.lshIndex.findSimilar(queryVector, limit * 2);

//         // 第二阶段：使用HNSW进行精确排序
//         const results = await this.hnswIndex.findNearest(queryVector, limit);

//         // 返回两种方法的交集
//         return results.filter(id => candidates.has(id)).slice(0, limit);
//     }

//     // 批量添加向量
//     async addVectors(vectors: { id: string, vector: number[] }[]): Promise<void> {
//         const batchSize = 1000;
//         for (let i = 0; i < vectors.length; i += batchSize) {
//             const batch = vectors.slice(i, i + batchSize);
//             await Promise.all(
//                 batch.map(({ id, vector }) => this.addVector(id, vector))
//             );
//         }
//     }
// }