import { AutoModel, AutoTokenizer } from '@huggingface/transformers';
import { cosineSimilarity } from './math';
import * as tf from '@tensorflow/tfjs';

export class Embedding {
    private model: any;
    private tokenizer: any;

    constructor() {
    }

    async init() {

        // 初始化模型和分词器
        [this.model, this.tokenizer] = await Promise.all([
            AutoModel.from_pretrained('jinaai/jina-embeddings-v2-base-zh', {
                dtype: 'fp16'
            }),
            AutoTokenizer.from_pretrained('jinaai/jina-embeddings-v2-base-zh'),
        ]);


    }

    // 计算平均值池化
    private meanPooling(
        lastHiddenState: { data: Float32Array; dims: number[]; }
        , attentionMask: {
            data: BigInt64Array; dims: number[];
        }): tf.Tensor {

        // tf.tensor 无法处理 BigInt64Array, 所以我们需要将其转换为普通数组
        const attentionMaskArray = Array.from(attentionMask.data, (value: bigint) => Number(value));

        return tf.tidy(() => {
            // 转换为 TensorFlow 张量
            const hiddenState = tf.tensor(lastHiddenState.data,
                lastHiddenState.dims);
            const mask = tf.tensor(attentionMaskArray, attentionMask.dims);

            // 扩展 mask 维度以匹配隐藏状态
            const expandedMask = tf.expandDims(mask, -1);

            // 应用 mask 并计算平均值
            const maskedEmbeddings = tf.mul(hiddenState, expandedMask);
            const sumEmbeddings = tf.sum(maskedEmbeddings, 1);
            const sumMask = tf.maximum(tf.sum(expandedMask, 1), tf.scalar(1e-9));


            return tf.div(sumEmbeddings, sumMask);

        });
    }

    async encode(texts: string | string[]): Promise<tf.Tensor> {
        if (!this.model || !this.tokenizer) {
            await this.init();
        }
        const inputTexts = Array.isArray(texts) ? texts : [texts];

        const encoded = await this.tokenizer(inputTexts, {
            padding: true,
            truncation: true,
            maxLength: 512,
            return_tensors: 'pt',
        });

        // 获取模型输出
        const output = await this.model(encoded);

        return this.meanPooling(
            output.last_hidden_state,
            encoded.attention_mask
        );
    }

    async computeSimilarity(text1: string, text2: string): Promise<number> {
        let embeddings: tf.Tensor | null = null;

        try {
            // 批量获取嵌入
            embeddings = await this.encode([text1, text2]);


            const embedding1 = embeddings.slice([0, 0], [1, -1]) as tf.Tensor;
            const embedding2 = embeddings.slice([1, 0], [1, -1]) as tf.Tensor;

            // 计算余弦相似度
            const similarity = cosineSimilarity(
                embedding1.arraySync()[0],
                embedding2.arraySync()[0]
            );

            return similarity;

        } finally {
            if (embeddings) embeddings.dispose();
        }
    }
}
