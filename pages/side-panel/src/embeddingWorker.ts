import { Embedding } from '@extension/shared';

addEventListener('message', async (event: MessageEvent) => {

    console.log('Received message in worker:', event.data);
    const embedding = new Embedding();

    await embedding.init();

    const res = await embedding.computeSimilarity('How is the weather today?', '今天天气怎么样?');
    console.log('res', res);
});