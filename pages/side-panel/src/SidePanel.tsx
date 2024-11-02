import '@src/SidePanel.css';
import { useStorage, withErrorBoundary, withSuspense, Connector } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import type { ComponentPropsWithoutRef } from 'react';
import { useRef, useEffect, useState } from 'react';
import workerpool from 'workerpool';
import type { Pool } from 'workerpool';
//@ts-ignore
import WorkerURL from './worker/uiBackground?url&worker'

const SidePanel = () => {

    const storageWorkerRef = useRef<Worker>();
    const uiBgPoolRef = useRef<Pool>();

    const [question, setQuestion] = useState<string>('');

    const handleFileChange = async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) {
            throw new Error('No file selected');
        }
        console.log('file change');

        // if (files.length > 5) {
        //     throw new Error('Too many files selected');
        // }

        const fileConnector = new Connector.FileConnector();
        for (const file of files) {
            const splits = await fileConnector.getSplits(file);

            console.log('start storageDocument');
            console.time('storageDocument');
            await uiBgPoolRef.current?.exec('storageDocument', [splits])
            console.timeEnd('storageDocument');
            console.log('end storageDocument');
        }

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


    useEffect(() => {
        uiBgPoolRef.current = workerpool.pool(WorkerURL);
    }, []);

    return (
        <div className='App bg-gray-400  flex-col content-center justify-center space-y-4'>

            <div className='flex items-center justify-center'>
                {/* 上传文件 */}
                <input type="file" accept=".pdf, .docx" multiple onChange={handleFileChange} />
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
