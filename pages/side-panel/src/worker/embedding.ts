import workerpool from 'workerpool';
import { embedding } from '@extension/shared';


const embeddingText = async (texts: string[]) => {
    await embedding.init()
    const embeddingOutput = await embedding.encode(texts);
    return { embeddedSentences: embeddingOutput.dataSync(), texts: texts };
}

workerpool.worker({
    embeddingText
});