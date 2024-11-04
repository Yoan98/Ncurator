import workerpool from 'workerpool';
import { embedding } from '@extension/shared';


const embeddingText = async (texts: string[]) => {
    await embedding.load()
    const embeddingOutput = await embedding.encode(texts);
    const data = embeddingOutput.dataSync();

    return new workerpool.Transfer({ embeddedSentences: data, texts: texts, shape: embeddingOutput.shape }, [
        data.buffer,
    ]);
}

const testMemory = async () => {
    console.log('test memory');
    const arr = new Array(15360).fill(1);
    return arr;
}

workerpool.worker({
    embeddingText,
    testMemory
});