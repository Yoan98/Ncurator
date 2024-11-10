import workerpool from 'workerpool';
import { embedding } from '@src/utils/Embedding';

// 这个文件的线程池只用于embedding相关的计算

// 向量化文本
const embeddingText = async (texts: string[] | string) => {
    await embedding.load()
    const embeddingOutput = await embedding.encode(texts);

    const data = embeddingOutput.dataSync();
    // 使用Transfer可以有减少内存占用，避免传递的数据拷贝，导致数据x2占用内存
    return new workerpool.Transfer({ embeddedSentences: data, shape: embeddingOutput.shape }, [
        data.buffer,
    ]);
}

workerpool.worker({
    embeddingText,
});