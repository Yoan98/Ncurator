import '@src/SidePanel.css';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import { FileConnector } from '@src/utils/Connector';
import type { ComponentPropsWithoutRef } from 'react';
import { useRef, useEffect, useState } from 'react';
import workerpool from 'workerpool';
import type { Pool } from 'workerpool';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import * as constant from '@src/utils/constant';
//@ts-ignore
import storageWorkerURL from './worker-pool/storageDoc?url&worker'
//@ts-ignore
import searchWorkerURL from './worker-pool/searchDoc?url&worker'

const SidePanel = () => {

    const storagePoolRef = useRef<Pool>();
    const searchPoolRef = useRef<Pool>();

    const [question, setQuestion] = useState<string>('');
    const [text1, setText1] = useState<string>('');
    const [text2, setText2] = useState<string>('');
    const [workerNumber, setWorkerNumber] = useState<number>(1);

    const handleFileChange = async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) {
            throw new Error('No file selected');
        }
        console.log('file change');


        // if (files.length > 5) {
        //     throw new Error('Too many files selected');
        // }

        const fileConnector = new FileConnector();

        // 获取file connection数据
        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);
        const connections = await store.getAll({
            storeName: constant.CONNECTION_STORE_NAME,
        }) as DB.CONNECTION[];
        const fileConnection = connections.find(item => item.connector === constant.Connector.File);

        let curFile
        try {
            for (const file of files) {
                curFile = file;
                const { bigChunks, miniChunks } = await fileConnector.getChunks(file);

                console.log('start storageDocument');
                console.time('storageDocument');
                await storagePoolRef.current?.exec('storageDocument', [{ bigChunks, miniChunks, file, documentName: file.name, connection: fileConnection }]);
                console.timeEnd('storageDocument');
                console.log('end storageDocument');
            }
        } catch (error) {
            console.log('error', error, curFile);
        }
        // storagePoolRef.current?.terminate();

    };

    const hdQuestionSubmit = async () => {
        console.log('start search');
        console.time('search');
        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);
        const connections = await store.getAll({
            storeName: constant.CONNECTION_STORE_NAME,
        }) as DB.CONNECTION[];

        const res = await searchPoolRef.current?.exec('search', [question, connections])
        console.timeEnd('search');
        console.log('end search');
    }

    const hdTestSimilarity = async () => {
        const res = await storagePoolRef.current?.exec('testSimilarity', [text1, text2])
        console.log('similarity result', res);
    }

    const hdTestFullText = async () => {
        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);

        const transaction = store.startTransaction([constant.DOCUMENT_STORE_NAME, constant.CONNECTION_STORE_NAME], 'readwrite');


        try {
            await store.add({
                storeName: constant.DOCUMENT_STORE_NAME,
                data: {
                    test: 11
                },
                transaction
            })

            console.log('add success');

            await store.addBatch({
                storeName: constant.CONNECTION_STORE_NAME,
                data: [{ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 1, b: 2 }],
                transaction
            })

            console.log('add success');
        } catch (error) {
            console.log('error', error);
        }


    }

    const hdInitialEmbeddingWorkerPool = async () => {
        storagePoolRef.current?.exec('initialEmbeddingWorkerPool', [workerNumber]);
    }



    useEffect(() => {
        storagePoolRef.current = workerpool.pool(storageWorkerURL, {
            maxWorkers: 1,
        });

        searchPoolRef.current = workerpool.pool(searchWorkerURL, {
            maxWorkers: 1,
        });



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

            <div className='flex flex-col gap-2'>
                <input type="text" id="input" onInput={(e) => {
                    setText1(e.currentTarget.value);
                }} />
                <input type="text" id="input" onInput={(e) => {
                    setText2(e.currentTarget.value);
                }} />

                <button id="submit" onClick={hdTestSimilarity}>Submit</button>
            </div>

            <div>
                <button onClick={hdTestFullText}>test full text</button>
            </div>

            <div className="flex items-center justify-center">
                <input type="text" id="input" placeholder='worker number' onInput={(e) => {
                    setWorkerNumber(Number(e.currentTarget.value));
                }} />

                <button id="submit" onClick={hdInitialEmbeddingWorkerPool}>Submit</button>
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
