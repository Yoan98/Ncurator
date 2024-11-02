import '@src/SidePanel.css';
import { useStorage, withErrorBoundary, withSuspense, Connector } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import type { ComponentPropsWithoutRef } from 'react';
import { useRef, useEffect, useState } from 'react';
import workerpool from 'workerpool';
import type { Pool } from 'workerpool';
import WorkerURL from './worker/embeddingWorker?url&worker'

const SidePanel = () => {

    const storageWorkerRef = useRef<Worker>();
    const workerpoolRef = useRef<Pool>();

    const [question, setQuestion] = useState<string>('');

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        console.log('file change');

        const fileConnector = new Connector.FileConnector();
        const splits = await fileConnector.getSplits(file);

        storageWorkerRef.current?.postMessage({
            action: 'storage_chunk',
            data: splits
        });
    };

    const hdQuestionSubmit = async () => {
        storageWorkerRef.current?.postMessage({
            action: 'question',
            data: question
        });
    }

    const hdTest = async () => {
        storageWorkerRef.current?.postMessage({
            action: 'test',
            data: 'test'
        });
    }

    const hdTestWorkerPool = async () => {
        console.log('start workerpool');
        workerpoolRef.current?.exec('heavyComputation', [{ count: 1000000 }]).then(res => {
            console.log('Result from workerpool:', res);
            console.log(JSON.stringify(workerpoolRef.current?.stats()));
        })
        workerpoolRef.current?.exec('heavyComputation', [{ count: 1000000 }]).then(res => {
            console.log('Result from workerpool:', res);
            console.log(JSON.stringify(workerpoolRef.current?.stats()));
        })
    }

    useEffect(() => {
        storageWorkerRef.current = new Worker(new URL('./worker/storageWorker.ts', import.meta.url));
        storageWorkerRef.current.onmessage = (event) => {
            console.log('Received message from worker:', event.data);
        };


        workerpoolRef.current = workerpool.pool(WorkerURL, { maxWorkers: 4 });


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

            <div>
                <button onClick={hdTestWorkerPool}>test workerpool</button>
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
