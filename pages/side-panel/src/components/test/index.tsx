import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { FileConnector, CrawlerConnector } from '@src/utils/Connector';
import type { ComponentPropsWithoutRef } from 'react';
import { useRef, useEffect, useState } from 'react';
import workerpool from 'workerpool';
import type { Pool } from 'workerpool';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import * as constant from '@src/utils/constant';
import { CreateWebWorkerMLCEngine, modelVersion, modelLibURLPrefix, prebuiltAppConfig } from "@mlc-ai/web-llm";
import type { InitProgressReport } from "@mlc-ai/web-llm";

//@ts-ignore
// import storageWorkerURL from '@src/worker-pool/buildIndex?url&worker'
// //@ts-ignore
// import searchWorkerURL from './worker-pool/searchDoc?url&worker'

const SidePanel = () => {

    const storagePoolRef = useRef<Pool>();
    const searchPoolRef = useRef<Pool>();

    const [question, setQuestion] = useState<string>('');
    const [text1, setText1] = useState<string>('');
    const [text2, setText2] = useState<string>('');
    const [workerNumber, setWorkerNumber] = useState<number>(1);
    const [selectModel, setSelectModal] = useState<string>('Llama-3.2-1B-Instruct-q4f32_1-MLC');

    const [websiteUrl, setWebsiteUrl] = useState<string>('');

    const handleFileChange = async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) {
            throw new Error('No file selected');
        }
        console.log('file change');


        const { bigChunks, miniChunks } = await FileConnector.getChunks(files[0]);
        console.log('bigChunks', bigChunks);


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
    const hdTestEncode = async () => {
        await storagePoolRef.current?.exec('testEmbedding', [text1]);
    }
    const loadLlm = async () => {
        const initProgressCallback = (progress: InitProgressReport) => {
            console.log("init progress", progress);
        }

        const engine = await CreateWebWorkerMLCEngine(
            new Worker(
                new URL("@src/worker-pool/llm.ts", import.meta.url),
                {
                    type: "module",
                }
            ),
            selectModel,
            {
                initProgressCallback,
                appConfig: {
                    ...prebuiltAppConfig,
                    // useIndexedDBCache: true
                }
            },
        );

        const messages = [
            { role: "system", content: "You are a helpful AI assistant." },
            { role: "user", content: "Hello!" },
        ]

        const reply = await engine.chat.completions.create({
            //@ts-ignore
            messages,
        });

        console.log('reply', reply);
    }
    const hdLoadLlm = async () => {
        loadLlm()
    }
    const hdUploadModal = async (event) => {
        if (!selectModel) {
            throw new Error('not chose model')
        }


        await uploadByCacheFiles(event.target.files);

    }

    async function uploadByCacheFiles(files: File[]): Promise<void> {
        function getFileType(file: File) {
            if (file.name.includes("wasm")) {
                return "webllm/wasm";
            } else if (
                file.name.includes(".bin") ||
                file.name.includes("ndarray-cache.json") ||
                file.name.includes("tokenizer.json")
            ) {
                return "webllm/model";
            } else if (file.name.includes("mlc-chat-config.json")) {
                return "webllm/config";
            } else {
                console.log("No model file suffix found");
                return "file-cache";
            }
        }
        async function cacheFile(file: File, response: Response) {
            try {
                const cache = await caches.open(getFileType(file)); // Ensure getFileType is a synchronous function or awaited if async
                console.log("Put response into cache:", response);

                let urlPrefix = file.name.includes('wasm') ? `${modelLibURLPrefix}${modelVersion}/` : `https://huggingface.co/mlc-ai/${selectModel}/resolve/main/`

                const url = `${urlPrefix}${file.name}`;
                await cache.put(url, response);
            } catch (error) {
                console.error("Failed to cache the file:", error);
            }
        }

        for (const file of files) {
            let fileContent = await file.arrayBuffer()

            const response = new Response(fileContent, {
                status: 200,
                statusText: "OK",
                headers: {
                    "Content-Type": "application/octet-stream",
                    "Content-Length": fileContent.byteLength.toString(),
                },
            });
            await cacheFile(file, response);
        }
    }

    async function uploadByIndexDB(files: File[]): Promise<void> {
        // function getFileType(file: File) {
        //     if (file.name.includes("wasm")) {
        //         return "webllm/wasm";
        //     } else if (
        //         file.name.includes(".bin") ||
        //         file.name.includes("ndarray-cache.json") ||
        //         file.name.includes("tokenizer.json")
        //     ) {
        //         return "webllm/model";
        //     } else if (file.name.includes("mlc-chat-config.json")) {
        //         return "webllm/config";
        //     } else {
        //         return "file-cache";
        //     }
        // }
        // async function cacheModel(file: File) {
        //     const indexDB = new IndexDBStore()
        //     await indexDB.connect(getFileType(file), (db) => {
        //         if (!db.objectStoreNames.contains("urls")) {
        //             db.createObjectStore("urls", { keyPath: "url" });
        //         }
        //     })

        //     let fileContent
        //     if (
        //         file.name.includes("mlc-chat-config.json") ||
        //         file.name.includes("ndarray-cache.json")
        //     ) {
        //         fileContent = await file.text()
        //         fileContent = JSON.parse(fileContent)
        //     } else {
        //         fileContent = await file.arrayBuffer()
        //     }

        //     let urlPrefix = file.name.includes('wasm') ? `${modelLibURLPrefix}${modelVersion}/` : `https://huggingface.co/mlc-ai/${selectModel}/resolve/main/`

        //     await indexDB.put({
        //         storeName: "urls",
        //         data: {
        //             url: `${urlPrefix}${file.name}`,
        //             data: fileContent,
        //         },
        //     })

        // }

        // const files = event.target.files;
        // if (!files || files.length === 0) {
        //     throw new Error('No file selected');
        // }
        // for (const file of files) {
        //     cacheModel(file);
        // }

    }

    async function hdScrapy() {
        const data = await CrawlerConnector.getChunks(websiteUrl)
        console.log('data', data);
    }


    useEffect(() => {
        // storagePoolRef.current = workerpool.pool(storageWorkerURL, {
        //     maxWorkers: 1,
        // });

        // searchPoolRef.current = workerpool.pool(searchWorkerURL, {
        //     maxWorkers: 1,
        // });

        // loadLlm()

    }, []);

    return (
        <div className='App bg-gray-400  flex-col content-center justify-center space-y-4 h-screen'>

            <div className='flex items-center justify-center'>
                {/* 上传文件 */}
                <input type="file" accept="*" multiple onChange={handleFileChange} />
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
                <button onClick={hdTestEncode}>test encode</button>
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

            <div className='flex items-center justify-center'>
                {/* 上传文件 */}
                <div>
                    上传模型文件
                </div>
                <input type="file" multiple onChange={hdUploadModal} />
            </div>

            <div>
                <button onClick={hdLoadLlm}>load llm</button>
            </div>
            <div>
                <input type="text" id="input" onInput={(e) => {
                    setWebsiteUrl(e.currentTarget.value);
                }} />
                <button onClick={hdScrapy}>scrapy</button>
            </div>


        </div>
    );
};


export default withErrorBoundary(withSuspense(SidePanel, <div> Loading ... </div>), <div> Error Occur </div>);
