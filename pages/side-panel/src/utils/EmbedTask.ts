import workerpool from 'workerpool';
// @ts-ignore
import embeddingWorkerURL from '@src/worker-pool/embeddingText?url&worker'
import * as config from '@src/config';
import type { Pool } from 'workerpool';

interface EmbeddingOutput {
    data: Float32Array,
    dims: [number, number]
}
export interface EmbedTask {
    text: string[];
    prefix?: EncodePrefixUnion;
    embedModelId: EmbeddingModelIdUnion
    resolve: (data: EmbeddingOutput) => void;
    reject: (error: any) => void;
}
// 对embedding worker的任务队列管理
export class EmbedTaskManage {
    static workerPool: Pool
    static buildTaskQueue: EmbedTask[] = []
    static searchTaskQueue: EmbedTask[] = []
    private static load(workerNumber = config.BUILD_INDEX_EMBEDDING_MAX_WORKER_NUM) {
        if (this.workerPool) {
            return;
        }
        //TODO 兼容只有gpu时固定workerNumber为1,cpu时由配置项决定
        this.workerPool = workerpool.pool(embeddingWorkerURL, {
            maxWorkers: workerNumber,
        });
        console.log('workerPool is initialized')
    }

    // 订阅需要embedding的文本
    static async subscribe(task: EmbedTask, type: 'search' | 'build') {
        if (!this.workerPool) {
            throw new Error('workerPool is not initialized')
        }
        const taskQueue = type === 'search' ? this.searchTaskQueue : this.buildTaskQueue

        taskQueue.push(task)
    }

    static async start(workerNumber = config.BUILD_INDEX_EMBEDDING_MAX_WORKER_NUM) {
        if (this.workerPool) {
            return console.warn('workerPool is already started');
        }

        this.load(workerNumber)

        setInterval(() => {
            if (this.searchTaskQueue.length) {
                const searchTask = this.searchTaskQueue.shift() as EmbedTask
                this.workerPool.exec('embeddingText', [searchTask.text, searchTask.embedModelId, searchTask.prefix]).then((res: EmbeddingOutput) => {
                    searchTask.resolve(res)
                }).catch((error) => {
                    searchTask.reject(error)
                })
            } else if (this.buildTaskQueue.length) {
                const buildTask = this.buildTaskQueue.shift() as EmbedTask
                this.workerPool.exec('embeddingText', [buildTask.text, buildTask.embedModelId, buildTask.prefix]).then((res: EmbeddingOutput) => {
                    buildTask.resolve(res)
                }).catch((error) => {
                    buildTask.reject(error)
                })
            } else {
                console.log('No task to execute')
            }
        }, 1000)
    }
}