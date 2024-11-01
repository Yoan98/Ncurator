import '@src/SidePanel.css';
import { useStorage, withErrorBoundary, withSuspense, Connector } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import type { ComponentPropsWithoutRef } from 'react';
import { useRef, useEffect, useState } from 'react';
import { createWorker } from 'tesseract.js';

const SidePanel = () => {

    const embeddingWorkerRef = useRef<Worker>();
    const [question, setQuestion] = useState<string>('');

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const fileConnector = new Connector.FileConnector();
        const splits = await fileConnector.getSplits(file);

        embeddingWorkerRef.current?.postMessage({
            action: 'storage_chunk',
            data: splits
        });
    };

    const hdQuestionSubmit = async () => {
        embeddingWorkerRef.current?.postMessage({
            action: 'question',
            data: question
        });
    }

    const hdTest = async () => {
        embeddingWorkerRef.current?.postMessage({
            action: 'test',
            data: 'test'
        });
    }

    useEffect(() => {
        embeddingWorkerRef.current = new Worker(new URL('./worker/embeddingWorker.ts', import.meta.url));
        embeddingWorkerRef.current.onmessage = (event) => {
            console.log('Received message from worker:', event.data);
        };

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

        return () => {
            embeddingWorkerRef.current?.terminate();
        };
    }, []);

    return (
        <div className='App bg-gray-400  flex-col content-center justify-center space-y-4'>

            <div className='flex items-center justify-center'>
                {/* 上传文件 */}
                <input type="file" accept=".pdf, .docx" onChange={handleFileChange} />
            </div>

            <div className='flex items-center justify-center'>
                {/* input输入框 */}
                <input type="text" id="input" onInput={(e) => {
                    setQuestion(e.currentTarget.value);
                }} />
                {/* 按钮 */}
                <button id="submit" onClick={hdQuestionSubmit}>Submit</button>
            </div>

            <div>
                <button onClick={hdTest}>test</button>
            </div>

        </div>
    );
};

const ToggleButton = (props: ComponentPropsWithoutRef<'button'> & { workerRef: React.MutableRefObject<Worker | undefined> }) => {
    function sendMessageToWorker() {
        props.workerRef.current?.postMessage('Hello from SidePanel');
    }

    const theme = useStorage(exampleThemeStorage);
    return (
        <button
            className={
                props.className +
                ' ' +
                'font-bold mt-4 py-1 px-4 rounded shadow hover:scale-105 ' +
                (theme === 'light' ? 'bg-white text-black' : 'bg-black text-white')
            }
            onClick={sendMessageToWorker}>
            {props.children}
        </button>
    );
};

export default withErrorBoundary(withSuspense(SidePanel, <div> Loading ... </div>), <div> Error Occur </div>);
