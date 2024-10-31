import '@src/SidePanel.css';
import { useStorage, withErrorBoundary, withSuspense, Connector } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import type { ComponentPropsWithoutRef } from 'react';
import { useRef, useEffect } from 'react';
import { createWorker } from 'tesseract.js';

const SidePanel = () => {
    const theme = useStorage(exampleThemeStorage);
    const isLight = theme === 'light';
    const logo = isLight ? 'side-panel/logo_vertical.svg' : 'side-panel/logo_vertical_dark.svg';
    const goGithubSite = () =>
        chrome.tabs.create({ url: 'https://github.com/Jonghakseo/chrome-extension-boilerplate-react-vite' });

    const embeddingWorkerRef = useRef<Worker>();


    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const fileConnector = new Connector.FileConnector();
        const text = await fileConnector.getRawText(file);


        embeddingWorkerRef.current?.postMessage({
            action: 'text',
            data: text
        });
    };


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
        <div className={`App ${isLight ? 'bg-slate-50' : 'bg-gray-800'}`}>
            <header className={`App-header ${isLight ? 'text-gray-900' : 'text-gray-100'}`}>
                <button onClick={goGithubSite}>
                    <img src={chrome.runtime.getURL(logo)} className="App-logo" alt="logo" />
                </button>
                <p>
                    Edit <code>pages/side-panel/src/SidePanel.tsx</code>
                </p>
                <ToggleButton workerRef={embeddingWorkerRef}>Toggle theme</ToggleButton>

                {/* 上传文件 */}
                <input type="file" accept=".pdf, .docx" onChange={handleFileChange} />

            </header>
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
