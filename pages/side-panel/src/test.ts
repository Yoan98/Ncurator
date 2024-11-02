// import { createWorker } from 'tesseract.js';
// 图片识别demo
// chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
//     const action = request.data.action;
//     const img = request.data.data;

//     if (action === 'screenshot') {
//         console.log('Received screenshot action from background:', img);
//         const worker = await createWorker(['eng', 'chi_sim'], 1, {
//             corePath: chrome.runtime.getURL("/side-panel/tesseract-core.wasm.js"),
//             workerPath:chrome.runtime.getURL("/side-panel/tesseract-worker.min.js")",
//             workerBlobURL: false,
//             logger: (m: any) => console.log(m),
//         });
//         console.log('Worker created');
//         const ret = await worker.recognize(img);
//         console.log(ret.data.text);
//         await worker.terminate();

//     }
// });