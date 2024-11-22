import React, { createContext, useContext, useState } from 'react';
import type { InitProgressReport } from "@mlc-ai/web-llm";
import * as constant from '@src/utils/constant';
import type { ProgressProps } from 'antd';
import { Progress, message } from 'antd';
import { CreateWebWorkerMLCEngine, prebuiltAppConfig, WebWorkerMLCEngine } from "@mlc-ai/web-llm";

const pageList = ['/main', '/resource', '/llm-set'];

interface GlobalContextValue {
    // resource的数据
    connectionList: DB.ConnectionDocUnion[];
    setConnectionList: React.Dispatch<React.SetStateAction<DB.ConnectionDocUnion[]>>;

    // 全局使用的LLM模型
    llmEngine: WebWorkerMLCEngine | null;
    loadLlmEngine: (param: LoadLlmEngineParams) => Promise<LoadLlmEngineReturn>;
    // pagePath
    pagePath: string;
    setPagePath: React.Dispatch<React.SetStateAction<string>>;
}

interface LoadLlmEngineReturn {
    status: 'Success' | 'Fail',
    message: string,
    engine: WebWorkerMLCEngine | null
}
interface LoadLlmEngineParams {
    modelId: string,
    isForcedLoad?: boolean,
    extProgressCallback?: (progress: InitProgressReport) => void
}

const defaultContextValue: GlobalContextValue = {
    connectionList: [],
    setConnectionList: () => { },

    llmEngine: null,
    loadLlmEngine: async () => {
        return {
            status: 'Fail',
            message: 'Haven\'t start load LLM model',
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
    const [connectionList, setConnectionList] = useState<DB.ConnectionDocUnion[]>([]);

    const [llmEngine, setLlmEngine] = useState<WebWorkerMLCEngine | null>(null);
    const [llmEngineLoadPercent, setLlmEngineLoadPercent] = useState<number>(0);
    const [llmEngineLoadStatus, setLlmEngineLoadStatus] = useState<ProgressProps['status']>('normal');

    const [pagePath, setPagePath] = useState<string>('/main');

    // 加载LLM模型
    const loadLlmEngine: GlobalContextValue['loadLlmEngine'] = async ({ modelId, isForcedLoad = false, extProgressCallback }): Promise<LoadLlmEngineReturn> => {
        if (llmEngineLoadStatus === 'active' && !isForcedLoad) {
            return {
                status: 'Fail',
                message: 'LLM is loading, please wait a moment',
                engine: null
            }
        }

        // 初始化重置
        setLlmEngineLoadStatus('active');
        setLlmEngineLoadPercent(0);
        if (llmEngine) {
            await llmEngine.unload();
            setLlmEngine(null);
        }

        // 检查本地模型
        if (modelId === 'default') {
            const defaultModal = localStorage.getItem(constant.STORAGE_DEFAULT_MODEL_ID);

            if (!defaultModal) {
                setLlmEngineLoadStatus(undefined);
                return {
                    status: 'Fail',
                    message: 'Haven\'t find default model',
                    engine: null
                }
            }
            modelId = defaultModal;
        }

        try {
            const selfProgressCallback = (progress: InitProgressReport) => {
                setLlmEngineLoadPercent((prePercent) => {
                    if (progress.progress === 1) {
                        setLlmEngineLoadStatus('success');
                        return 100;
                    }
                    if (progress.progress > 0 && progress.progress < 1) {
                        // 代表是下载模型,会有进度
                        return Math.floor(progress.progress * 100);
                    }
                    return prePercent < 99 ? ++prePercent : 99;

                });
            }
            const initProgressCallback = (progress: InitProgressReport) => {
                console.log('initProgressCallback', progress);
                selfProgressCallback(progress);
                extProgressCallback && extProgressCallback?.(progress);
            }

            const engine = new WebWorkerMLCEngine(
                new Worker(
                    new URL("@src/worker-pool/llm.ts", import.meta.url),
                    {
                        type: "module",
                    }
                ),
                {
                    initProgressCallback,
                    appConfig: {
                        ...prebuiltAppConfig,
                        useIndexedDBCache: true
                    }
                }
            )
            setLlmEngine(engine);

            await engine.reload(modelId);

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


    return (
        <GlobalContext.Provider value={{ connectionList, setConnectionList, llmEngine, loadLlmEngine, pagePath, setPagePath }}>
            {children}

            {/* llm load loading */}
            <div className="fixed right-0 bottom-2 px-1">
                <LlmLoaderProgress progress={llmEngineLoadPercent} status={llmEngineLoadStatus} onReloadClick={() => {
                    setLlmEngineLoadPercent(0);
                    setLlmEngineLoadStatus('active');
                    loadLlmEngine({
                        modelId: 'default',
                        isForcedLoad: true,
                    });
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
