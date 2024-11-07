import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers';
import { cosineSimilarity } from './math';
import * as tf from '@tensorflow/tfjs';

// @ts-ignore
// 配置本地wasm文件路径
// embedding被用于worker线程中,所以被打包到assest中了,而wasm文件在public中,被打包到外层了,所以这里这里路径是../
env.backends.onnx.wasm.wasmPaths = '../';
// 使用本地模型
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '../models';
// 这里可以配置远程服务器地址，加载模型将走这个地址，避免有些人没发翻墙，无法加载模型
// env.remoteHost = 'http://localhost:3000';
// console.log('env', env)


export class Embedding {
    private model: any;
    private tokenizer: any;

    constructor() {
    }

    /**
     * 加载模型和分词器
     * !注意:该方法执行后,内存会占用较多(q8下0.7G,fp16为1G),尤其注意多线程的使用
     * @returns
     */
    async load() {
        if (this.model && this.tokenizer) {
            return;
        }
        // 初始化模型和分词器
        [this.model, this.tokenizer] = await Promise.all([
            AutoModel.from_pretrained('jina-embeddings-v2-base-zh', {
                dtype: 'fp16',
                local_files_only: true,
            }),
            AutoTokenizer.from_pretrained('jina-embeddings-v2-base-zh', {
                local_files_only: true,
            }),
        ]);

        console.log('Model and tokenizer initialized');
    }

    /**
     * 计算平均值池化
     * @param lastHiddenState
     * @param attentionMask
     * @returns  {tf.Tensor2D} 返回的张量的形状为 [batchSize, hiddenSize] [句子数量, 句子向量数组长度]
     */
    private meanPooling(
        lastHiddenState: { data: Float32Array; dims: [number, number, number]; }
        , attentionMask: {
            data: BigInt64Array; dims: [number, number];
        }): tf.Tensor2D {

        // tf.tensor 无法处理 BigInt64Array, 所以我们需要将其转换为普通数组
        const attentionMaskArray = Array.from(attentionMask.data, (value: bigint) => Number(value));

        return tf.tidy(() => {
            // 转换为 TensorFlow 张量
            const hiddenState = tf.tensor(lastHiddenState.data,
                lastHiddenState.dims) as tf.Tensor3D;
            const mask = tf.tensor(attentionMaskArray, attentionMask.dims) as tf.Tensor2D;

            // 扩展 mask 维度以匹配隐藏状态
            const expandedMask = tf.expandDims(mask, -1) as tf.Tensor3D;

            // 应用 mask 并计算平均值
            const maskedEmbeddings = tf.mul(hiddenState, expandedMask) as tf.Tensor3D;
            const sumEmbeddings = tf.sum(maskedEmbeddings, 1) as tf.Tensor2D;
            const sumMask = tf.maximum(tf.sum(expandedMask, 1), tf.scalar(1e-9)) as tf.Tensor2D;

            return tf.div(sumEmbeddings, sumMask);
        });
    }

    /**
     * 将文本向量化且平均池化
     * 注:批量文本处理会比循环执行encode更快
     * 这里是耗时最久的地方,112个句子,耗时十分钟多点,例子(图形学笔记)
     * @param texts
     * @returns
     */
    async encode(texts: string | string[]): Promise<tf.Tensor2D> {
        if (!this.model || !this.tokenizer) {
            throw new Error('Model or tokenizer not initialized');
        }
        const inputTexts = Array.isArray(texts) ? texts : [texts];

        // 分词
        // 此处耗时可忽略不计
        const encoded = await this.tokenizer(inputTexts, {
            padding: true,
            truncation: true,
            // 如果句子分词后的token超过2048，将被截断,也意味着信息丢失,精确度降低,但是速度会更快
            // jina-embeddings-v2-base-zh模型所能支持的最大长度为8192
            maxLength: 2048,
            return_tensors: 'pt',
        });

        // 获取模型输出
        // 此处耗时最久,model大概占了整个encode的93%,加载43个句子的情况,句子越多占比越大
        const output = await this.model(encoded);

        // 计算平均值池化
        // 此处耗时可忽略不计
        const meanRes = this.meanPooling(
            output.last_hidden_state,
            encoded.attention_mask
        );


        return meanRes

    }

    async computeSimilarity(text1: string, text2: string): Promise<number> {
        let embeddings: tf.Tensor2D | null = null;

        try {
            // 批量获取嵌入
            embeddings = await this.encode([text1, text2]);

            const embedding1 = embeddings.slice([0, 0], [1, -1]).reshape([-1]) as tf.Tensor1D;
            const embedding2 = embeddings.slice([1, 0], [1, -1]).reshape([-1]) as tf.Tensor1D;

            // 计算余弦相似度
            const similarity = cosineSimilarity(
                embedding1,
                embedding2
            );

            return similarity;

        } finally {
            if (embeddings) embeddings.dispose();
        }
    }
}

export const embedding = new Embedding()
