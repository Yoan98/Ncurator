import { AutoModel, AutoTokenizer } from '@huggingface/transformers';
import * as tf from '@tensorflow/tfjs';

class Embedding {
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


    // 计算余弦相似度
    private cosineSimilarity(a: tf.Tensor, b: tf.Tensor): tf.Tensor {
        return tf.tidy(() => {
            const dotProduct = a.mul(b).sum(1);

            const normA = tf.norm(a);
            const normB = tf.norm(b);
            return dotProduct.div(normA.mul(normB).maximum(tf.scalar(1e-9)));
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

    async computeSimilarity(text1: string, text2: string): Promise<number | number[] | number[][] | number[][][] | number[][][][] | number[][][][][] | number[][][][][][]> {
        let embeddings: tf.Tensor | null = null;
        let similarity: tf.Tensor | null = null;

        try {
            // 批量获取嵌入
            embeddings = await this.encode([text1, text2]);


            const embedding1 = embeddings.slice([0, 0], [1, -1]) as tf.Tensor;
            const embedding2 = embeddings.slice([1, 0], [1, -1]) as tf.Tensor;

            // 计算余弦相似度
            similarity = this.cosineSimilarity(
                embedding1,
                embedding2
            );

            console.log('Similarity:', similarity.arraySync());

            return similarity.arraySync();

        } finally {
            if (embeddings) embeddings.dispose();
            if (similarity) similarity.dispose();
        }
    }
    async computeSimilarityBatch(pairs: [string, string][]): Promise<number[]> {
        let allEmbeddings: tf.Tensor | null = null;
        let similarities: tf.Tensor | null = null;

        try {
            // 展平所有文本并批量获取嵌入
            const allTexts = pairs.flat();
            allEmbeddings = await this.encode(allTexts);

            const results: number[] = [];
            for (let i = 0; i < pairs.length; i++) {
                const idx1 = i * 2;
                const idx2 = i * 2 + 1;

                similarities = this.cosineSimilarity(
                    allEmbeddings.slice([idx1, 0], [1, -1]),
                    allEmbeddings.slice([idx2, 0], [1, -1])
                );

                results.push((await similarities.array())[0]);
                similarities.dispose();
            }

            return results;

        } finally {
            if (allEmbeddings) allEmbeddings.dispose();
            if (similarities) similarities.dispose();
        }
    }

    // 新增：批量计算嵌入向量之间的相似度矩阵
    async computeSimilarityMatrix(texts: string[]): Promise<number[][]> {
        let embeddings: tf.Tensor | null = null;
        const similarities: tf.Tensor | null = null;

        try {
            // 批量获取所有文本的嵌入
            embeddings = await this.encode(texts);

            // 计算相似度矩阵
            return tf.tidy(() => {
                // 归一化嵌入向量
                const normalized = tf.div(
                    embeddings!,
                    tf.norm(embeddings!, 2, 1, true).maximum(tf.scalar(1e-9))
                );

                // 计算相似度矩阵
                const similarityMatrix = normalized.matMul(normalized.transpose());

                return similarityMatrix.arraySync() as number[][];
            });

        } finally {
            if (embeddings) embeddings.dispose();
            if (similarities) similarities.dispose();
        }
    }
}

export default Embedding;