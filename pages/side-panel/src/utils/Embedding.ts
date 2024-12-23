import { AutoModel, AutoTokenizer, env, pipeline } from '@huggingface/transformers';
import type { AllTasks } from '@huggingface/transformers';
import { checkWebGPU } from '@src/utils/tool';
import { DEFAULT_EMBEDDING_MODEL } from '@src/config';


//* 使用本地模型的配置
// env.localModelPath = '../';
// env.allowRemoteModels = false;
// env.allowLocalModels = true;


// 配置远程服务器地址，加载模型将走这个地址，避免有些人没发翻墙，无法加载模型
// env.remoteHost = 'http://www.hongbanbangbang.cn/';
// console.log('env', env)

export class Embedding {
    // private modelId: PreTrainedModel | null;
    // private tokenizer: PreTrainedTokenizer | null;
    static extractor: AllTasks['feature-extraction'] | null;
    static modelId: EmbeddingModelIdUnion

    constructor() {
    }

    /**
     * 加载模型和分词器
     * !注意:该方法执行后,内存会占用较多(fp16为近1G,在不算数据的情况下)尤其注意多线程的使用
     * @returns
     */
    // async load() {
    //     if (this.modelId && this.tokenizer) {
    //         return;
    //     }

    //     const isSupportWebGPU = await checkWebGPU();

    //     // 初始化模型和分词器
    //     [this.modelId, this.tokenizer] = await Promise.all([
    //         AutoModel.from_pretrained('jinaai/jina-embeddings-v2-base-zh', {
    //             // 该模型在webpgu下,如果使用fp16会有精度问题,一些数据在向量化时会出现nan
    //             // dtype: 'fp32',
    //             // local_files_only: true,
    //             device: isSupportWebGPU ? 'webgpu' : undefined

    //         }),
    //         AutoTokenizer.from_pretrained('jinaai/jina-embeddings-v2-base-zh', {
    //             // local_files_only: true,
    //         }),
    //     ]);

    //     console.log('Model and tokenizer initialized');
    // }


    /**
     * 计算平均值池化
     * @param lastHiddenState
     * @param attentionMask
     * @returns  {tf.Tensor2D} 返回的张量的形状为 [batchSize, hiddenSize] [句子数量, 句子向量数组长度]
     */
    // private meanPooling(
    //     lastHiddenState: { data: Float32Array; dims: [number, number, number]; }
    //     , attentionMask: {
    //         data: BigInt64Array; dims: [number, number];
    //     }): tf.Tensor2D {

    //     // tf.tensor 无法处理 BigInt64Array, 所以我们需要将其转换为普通数组
    //     const attentionMaskArray = Array.from(attentionMask.data, (value: bigint) => Number(value));

    //     return tf.tidy(() => {
    //         // 转换为 TensorFlow 张量
    //         const hiddenState = tf.tensor(lastHiddenState.data,
    //             lastHiddenState.dims) as tf.Tensor3D;
    //         const mask = tf.tensor(attentionMaskArray, attentionMask.dims) as tf.Tensor2D;

    //         // 扩展 mask 维度以匹配隐藏状态
    //         const expandedMask = tf.expandDims(mask, -1) as tf.Tensor3D;

    //         // 应用 mask 并计算平均值
    //         const maskedEmbeddings = tf.mul(hiddenState, expandedMask) as tf.Tensor3D;
    //         const sumEmbeddings = tf.sum(maskedEmbeddings, 1) as tf.Tensor2D;
    //         const sumMask = tf.maximum(tf.sum(expandedMask, 1), tf.scalar(1e-9)) as tf.Tensor2D;

    //         return tf.div(sumEmbeddings, sumMask);
    //     });
    // }

    /**
     * 将文本向量化且平均池化
     * 注:批量文本处理会比循环执行encode更快
     * 这里是耗时最久的地方,112个句子,耗时十分钟多点,例子(图形学笔记)
     * @param texts
     * @returns
     */
    // async encode(texts: string | string[]): Promise<tf.Tensor2D> {
    //     if (!this.modelId || !this.tokenizer) {
    //         throw new Error('Model or tokenizer not initialized');
    //     }
    //     const inputTexts = Array.isArray(texts) ? texts : [texts];

    //     // 分词
    //     // 此处耗时可忽略不计
    //     const encoded = await this.tokenizer(inputTexts, {
    //         padding: true,
    //         truncation: true,
    //         // 如果句子分词后的token超过2048，将被截断,也意味着信息丢失,精确度降低,但是速度会更快
    //         // jina-embeddings-v2-base-zh模型所能支持的最大长度为8192
    //         max_length: 2048,
    //     });

    //     // 获取模型输出
    //     // 此处耗时最久,model大概占了整个encode的93%,加载43个句子的情况,句子越多占比越大
    //     const output = await this.modelId(encoded);

    //     // 计算平均值池化
    //     // 此处耗时可忽略不计
    //     const meanRes = this.meanPooling(
    //         output.last_hidden_state,
    //         encoded.attention_mask
    //     );


    //     return meanRes

    // }

    /**
     * 加载模型和分词器
     * !注意:该方法执行后,内存会占用较多(fp16为近1G,在不算数据的情况下)尤其注意多线程的使用
     * !一定要以单例化的形式调用，重复load会导致内存占用一直累加
     * @returns
     */
    static async load(modelId: EmbeddingModelIdUnion, pretrainedModelOptions: {
        progress_callback?: (progress: number) => void;
        wasmPath?: string;
    } = { wasmPath: '../' }) {
        console.log('select modelId', modelId)

        if (!modelId) {
            throw new Error('ModelId is required');
        }

        if (this.extractor && this.modelId === modelId) {
            return this.extractor;
        }

        if (pretrainedModelOptions.wasmPath) {
            // 配置本地ort-wasm-simd-threaded.jsep.wasm文件路径,避免内网请求失败
            // 在worker中加载模型的路径必须是'../'
            // @ts-ignore
            env.backends.onnx.wasm.wasmPaths = pretrainedModelOptions.wasmPath;
        }

        this.modelId = modelId;

        const isSupportWebGPU = await checkWebGPU();

        // 初始化模型和分词器
        this.extractor = await pipeline("feature-extraction", this.modelId, {
            dtype: 'fp32',
            device: isSupportWebGPU ? 'webgpu' : undefined,
            ...pretrainedModelOptions
        });

        return this.extractor;
    }
    static async encode(texts: string | string[], prefix?: EncodePrefixUnion) {
        if (!this.extractor) {
            throw new Error('Model or tokenizer not initialized');
        }

        let inputTexts = Array.isArray(texts) ? texts : [texts];

        if (this.modelId === 'nomic-ai/nomic-embed-text-v1' && prefix) {
            inputTexts = inputTexts.map(text => {
                return `${prefix}: ${text}`
            })
        }

        const output = await this.extractor(inputTexts, { pooling: 'mean', normalize: true });

        const data = output.data as Float32Array;
        const dims = output.dims as [number, number];
        // const meanRes = tf.tensor(data, dims) as tf.Tensor2D;

        return {
            data,
            dims
        }
    }
}

