import React, { createContext, useContext, useState } from 'react';
import type { InitProgressReport, WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import * as constant from '@src/utils/constant';
import type { ProgressProps } from 'antd';
import { Progress } from 'antd';
import { CreateWebWorkerMLCEngine, prebuiltAppConfig } from "@mlc-ai/web-llm";

const pageList = ['/main', '/resource', '/llm-set'];

interface GlobalContextValue {
    // resource的数据
    connectionList: DB.ConnectionDocUnion[];
    setConnectionList: React.Dispatch<React.SetStateAction<DB.ConnectionDocUnion[]>>;

    // 全局使用的LLM模型
    llmEngine: WebWorkerMLCEngine | null;
    loadLlmEngine: (modelId: string) => void;

    // pagePath
    pagePath: string;
    setPagePath: React.Dispatch<React.SetStateAction<string>>;
}

const defaultContextValue: GlobalContextValue = {
    connectionList: [],
    setConnectionList: () => { },

    llmEngine: null,
    loadLlmEngine: async () => { },

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
    const [connectionList, setConnectionList] = useState<DB.ConnectionDocUnion[]>([]);

    const [llmEngine, setLlmEngine] = useState<WebWorkerMLCEngine | null>(null);
    const [llmEngineLoadPercent, setLlmEngineLoadPercent] = useState<number>(0);
    const [llmEngineLoadStatus, setLlmEngineLoadStatus] = useState<ProgressProps['status']>('normal');

    const [pagePath, setPagePath] = useState<string>('/main');

    // 加载LLM模型
    const loadLlmEngine = async (selectModel) => {
        if (selectModel === 'default') {
            // 检查本地模型
            const defaultModal = localStorage.getItem(constant.STORAGE_DEFAULT_MODEL_ID);

            if (!defaultModal) {
                setLlmEngineLoadStatus(undefined);
                return
            }
            selectModel = defaultModal;
        }

        setLlmEngineLoadStatus('active');

        try {
            const initProgressCallback = (progress: InitProgressReport) => {
                setLlmEngineLoadPercent((prePercent) => {
                    if (progress.progress === 1) {
                        setLlmEngineLoadStatus('success');
                        return 100;
                    }
                    return prePercent < 99 ? ++prePercent : 99;

                });
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
                        useIndexedDBCache: true
                    }
                },
            );

            setLlmEngine(engine);
        } catch (error) {
            console.error("load llm error", error);
            setLlmEngineLoadStatus('exception');
        }

    }


    return (
        <GlobalContext.Provider value={{ connectionList, setConnectionList, llmEngine, loadLlmEngine, pagePath, setPagePath }}>
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
