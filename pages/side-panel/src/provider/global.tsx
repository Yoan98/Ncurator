import React, { createContext, useContext, useState, useRef } from 'react';
import type { InitProgressReport } from "@mlc-ai/web-llm";
import * as constant from '@src/utils/constant';
import type { ProgressProps } from 'antd';
import { Progress, message } from 'antd';
import { WebWorkerMLCEngine } from "@mlc-ai/web-llm";

const pageList = ['/main', '/resource', '/llm-set'];

interface GlobalContextValue {
    // resource的数据
    connectionList: DB.ConnectionDocUnion[];
    setConnectionList: React.Dispatch<React.SetStateAction<DB.ConnectionDocUnion[]>>;

    llmEngineLoadStatus: ProgressProps['status'];
    // 全局使用的LLM引擎
    llmEngine: React.MutableRefObject<WebWorkerMLCEngine | null>
    loadLlmEngine: (modelId: string) => Promise<LoadLlmReturn>;
    reloadLlmModal: (modelId: string) => Promise<LoadLlmReturn>;

    // pagePath
    pagePath: string;
    setPagePath: React.Dispatch<React.SetStateAction<string>>;
}

interface LoadLlmReturn {
    status: 'Success' | 'Fail',
    message: string,
    engine: WebWorkerMLCEngine | null
}

const defaultContextValue: GlobalContextValue = {
    connectionList: [],
    setConnectionList: () => { },

    llmEngineLoadStatus: 'normal',
    llmEngine: { current: null },
    loadLlmEngine: async () => {
        return {
            status: 'Fail',
            message: 'Haven\'t start load LLM engine',
            engine: null
        }
    },
    reloadLlmModal: async () => {
        return {
            status: 'Fail',
            message: 'Haven\'t start reload LLM model',
            engine: null
        }
    },

    pagePath: '/main',
    setPagePath: () => { },
};

const GlobalContext = createContext(defaultContextValue);

// LLM加载进度组件
const LlmLoaderProgress = ({ progress, status, onReloadClick, onGoToSetupCLick }: { progress: number, status: ProgressProps['status'], onReloadClick: () => void, onGoToSetupCLick: () => void }) => {
    let ProgressTipEle
    if (status === 'active') {
        ProgressTipEle = <div className="text-text-400">Loading LLM Model ...</div>
    } else if (status === 'exception') {
        ProgressTipEle = <div className='text-text-error cursor-pointer' onClick={onReloadClick}>Load LLM Model Error, click try again</div>
    } else if (status === 'success') {
        ProgressTipEle = <div className="text-text-success">Load LLM Model Success</div>
    }


    return (
        <div className={`llm-load-status bg-white rounded-lg py-1 px-2 animate__animated shadow-md  ${progress == 100 ? 'animate__backOutRight animate__delay-2s' : 'animate__backInRight'}`}>
            {
                !status
                    ?
                    <div className='text-text-error cursor-pointer' onClick={onGoToSetupCLick}>Haven't find your LLM model,click to set up.</div>
                    :
                    <div className='flex flex-col items-end'>
                        <Progress percent={progress} status={status} type="circle" size={30} />

                        {ProgressTipEle}
                    </div>
            }
        </div>
    );
}

export const GlobalProvider = ({ children }) => {

    const llmEngine = useRef<WebWorkerMLCEngine | null>(null);

    const [connectionList, setConnectionList] = useState<DB.ConnectionDocUnion[]>([]);

    const [llmEngineLoadPercent, setLlmEngineLoadPercent] = useState<number>(0);
    const [llmEngineLoadStatus, setLlmEngineLoadStatus] = useState<ProgressProps['status']>('normal');

    const [pagePath, setPagePath] = useState<string>('/main');

    const initProgressCallback = (progress: InitProgressReport) => {
        setLlmEngineLoadPercent((prePercent) => {
            if (progress.progress === 1) {
                setLlmEngineLoadStatus('success');
                return 100;
            }
            return prePercent < 99 ? ++prePercent : 99;

        });
    }
    // 加载LLM引擎
    const loadLlmEngine = async (selectModel: string): Promise<LoadLlmReturn> => {
        if (llmEngineLoadStatus === 'active') {
            return {
                status: 'Fail',
                message: 'LLM is loading, please wait a moment',
                engine: null
            }
        }

        setLlmEngineLoadStatus('active');
        setLlmEngineLoadPercent(0);
        if (llmEngine.current) {
            await llmEngine.current.unload();
            llmEngine.current = null;
        }


        // 检查本地模型
        if (selectModel === 'default') {
            const defaultModal = localStorage.getItem(constant.STORAGE_DEFAULT_MODEL_ID);

            if (!defaultModal) {
                setLlmEngineLoadStatus(undefined);
                return {
                    status: 'Fail',
                    message: 'Haven\'t find default model',
                    engine: null
                }
            }
            selectModel = defaultModal;
        }


        try {
            const engine = new WebWorkerMLCEngine(new Worker(
                new URL("@src/worker-pool/llm.ts", import.meta.url),
                {
                    type: "module",
                }),
                {
                    initProgressCallback,
                })
            llmEngine.current = engine

            await engine.reload(selectModel);

            return {
                status: 'Success',
                message: 'Load LLM model success',
                engine: engine
            };
        } catch (error) {
            console.error("load llm error", error);
            setLlmEngineLoadStatus('exception');
            return {
                status: 'Fail',
                message: 'Load LLM model error',
                engine: null
            }
        }

    }

    // 重载模型
    const reloadLlmModal = async (selectModel: string): Promise<LoadLlmReturn> => {
        if (llmEngineLoadStatus === 'active') {
            return {
                status: 'Fail',
                message: 'LLM is loading, please wait a moment',
                engine: null
            }
        }
        if (!llmEngine.current) {
            const res = await loadLlmEngine(selectModel);
            return res;
        }

        llmEngine.current.setInitProgressCallback(initProgressCallback);

        setLlmEngineLoadPercent(0);
        setLlmEngineLoadStatus('active');

        await llmEngine.current.reload(selectModel);

        return {
            status: 'Success',
            message: 'Reload LLM model success',
            engine: llmEngine.current
        };

    }



    return (
        <GlobalContext.Provider value={{ connectionList, setConnectionList, llmEngine, loadLlmEngine, llmEngineLoadStatus, reloadLlmModal, pagePath, setPagePath }}>
            {children}

            {/* llm load loading */}
            <div className="fixed right-0 bottom-2 px-1">
                <LlmLoaderProgress progress={llmEngineLoadPercent} status={llmEngineLoadStatus} onReloadClick={() => {
                    setLlmEngineLoadPercent(0);
                    setLlmEngineLoadStatus('active');
                    loadLlmEngine('default');
                }}
                    onGoToSetupCLick={() => {
                        setPagePath('/llm-set');
                    }}
                />
            </div>
        </GlobalContext.Provider>
    );
};

// 创建一个自定义的 hook 来便于在其他组件中使用 Context 数据
export const useGlobalContext = () => {
    return useContext(GlobalContext);
};
