import workerpool from 'workerpool';
import { Embedding } from '@src/utils/Embedding';

// 这个文件的线程池只用于embedding相关的计算

// 向量化document文本
const embeddingText = async (texts: string[] | string, prefix?: EncodePrefixUnion) => {
    await Embedding.load()
    const embeddingOutput = await Embedding.encode(texts, prefix);

    // 使用Transfer可以有减少内存占用，避免传递的数据拷贝，导致数据x2占用内存
    return new workerpool.Transfer({ data: embeddingOutput.data, dims: embeddingOutput.dims }, [
        embeddingOutput.data.buffer,
    ]);
}

workerpool.worker({
    embeddingText,
});