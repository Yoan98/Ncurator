import React, { createContext, useContext, useState, useRef } from 'react';
import type { InitProgressReport } from "@mlc-ai/web-llm";
import * as constant from '@src/utils/constant';
import type { ProgressProps } from 'antd';
import { Progress, message } from 'antd';
import { WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { t } from '@extension/i18n';
import { LlmEngineController } from '@src/utils/LlmEngineController'



const pageList = ['/main', '/resource', '/llm-set'];

interface GlobalContextValue {
    // resource的数据
    connectionList: DB.ConnectionDocUnion[];
    setConnectionList: React.Dispatch<React.SetStateAction<DB.ConnectionDocUnion[]>>;

    llmEngineLoadStatus: ProgressProps['status'];
    // 全局使用的LLM引擎
    llmEngine: React.MutableRefObject<LlmEngineController | null>
    initLlmEngine: (modelId: string) => Promise<InitLlmReturn>;
    reloadLlmModal: (modelId: string) => Promise<InitLlmReturn>;

    // pagePath
    pagePath: string;
    setPagePath: React.Dispatch<React.SetStateAction<string>>;
}

interface InitLlmReturn {
    status: 'Success' | 'Fail',
    message: string,
    engine: LlmEngineController | null
}

const defaultContextValue: GlobalContextValue = {
    connectionList: [],
    setConnectionList: () => { },

    llmEngineLoadStatus: 'normal',
    llmEngine: { current: null },
    initLlmEngine: async () => {
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
        ProgressTipEle = <div className="text-text-400">{t('loading_llm_model')} ...</div>
    } else if (status === 'exception') {
        ProgressTipEle = <div className='text-text-error cursor-pointer' onClick={onReloadClick}>{t('load_llm_model_error')}, {t('click_try_again')}</div>
    } else if (status === 'success') {
        ProgressTipEle = <div className="text-text-success">{t('load_llm_model_success')}</div>
    }


    return (
        <div className={`llm-load-status fixed right-0 bottom-2 bg-white rounded-lg py-1 px-2 animate__animated shadow-md  ${progress == 100 ? 'animate__backOutRight animate__delay-2s' : 'animate__backInRight'}`}>
            {
                !status
                    ?
                    <div className='text-text-error cursor-pointer' onClick={onGoToSetupCLick}>{t('not_found_llm_model')},{t('click_to_setup')}.</div>
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

    const llmEngine = useRef<LlmEngineController | null>(null);

    const [connectionList, setConnectionList] = useState<DB.ConnectionDocUnion[]>([]);

    const [llmEngineLoadPercent, setLlmEngineLoadPercent] = useState<number>(0);
    const [llmEngineLoadStatus, setLlmEngineLoadStatus] = useState<ProgressProps['status']>('normal');

    const [pagePath, setPagePath] = useState<string>('/main');

    const initProgressCallback = (progress: { progress: number }) => {
        setLlmEngineLoadPercent((prePercent) => {
            if (progress.progress === 1) {
                setLlmEngineLoadStatus('success');
                return 100;
            }
            // 对于已下载的webllm模型，在加载时没有给具体进度，所以这里只能模拟
            return prePercent < 99 ? ++prePercent : 99;

        });
    }
    // 初始化LLM引擎
    const initLlmEngine = async (selectModel: string): Promise<InitLlmReturn> => {
        if (llmEngineLoadStatus === 'active') {
            return {
                status: 'Fail',
                message: t('llm_loading_warning'),
                engine: null
            }
        }

        setLlmEngineLoadStatus('active');
        setLlmEngineLoadPercent(0);

        // 检查本地模型
        if (selectModel === 'default') {
            const defaultModal = localStorage.getItem(constant.STORAGE_DEFAULT_MODEL_ID);

            if (!defaultModal) {
                setLlmEngineLoadStatus(undefined);
                return {
                    status: 'Fail',
                    message: t('not_found_llm_model'),
                    engine: null
                }
            }
            selectModel = defaultModal;
        }

        const newLlmEngine = new LlmEngineController({ modelId: selectModel });
        // 判断模型种类
        // api的模型
        if (newLlmEngine.modelInfo.sort === constant.ModelSort.Api) {
            llmEngine.current = newLlmEngine

            setLlmEngineLoadStatus('success');
            setLlmEngineLoadPercent(100);
            return {
                status: 'Success',
                message: t('load_llm_model_success'),
                engine: llmEngine.current
            }
        }


        // webllm的模型
        try {
            if (llmEngine.current) {
                await llmEngine.current.unload();
                llmEngine.current = null;
            }

            await newLlmEngine.reload({ modelId: selectModel, initProgressCallback });

            llmEngine.current = newLlmEngine;

            return {
                status: 'Success',
                message: t('load_llm_model_success'),
                engine: llmEngine.current
            };
        } catch (error) {
            console.error("load llm error", error);
            setLlmEngineLoadStatus('exception');
            return {
                status: 'Fail',
                message: t('load_llm_model_error'),
                engine: null
            }
        }
    }


    // 重载模型
    // 目前只有webllm模型有重载
    const reloadLlmModal = async (selectModel: string): Promise<InitLlmReturn> => {
        if (llmEngineLoadStatus === 'active') {
            return {
                status: 'Fail',
                message: t('llm_loading_warning'),
                engine: null
            }
        }
        // 如果上一个是api模型，则需重新加载webllm才行
        if (!llmEngine.current) {
            const res = await initLlmEngine(selectModel);
            return res;
        }


        setLlmEngineLoadPercent(0);
        setLlmEngineLoadStatus('active');

        await llmEngine.current.reload({
            modelId: selectModel,
            initProgressCallback
        });

        return {
            status: 'Success',
            message: t('load_llm_model_success'),
            engine: llmEngine.current
        };

    }


    return (
        <GlobalContext.Provider value={{ connectionList, setConnectionList, llmEngine, initLlmEngine, llmEngineLoadStatus, reloadLlmModal, pagePath, setPagePath }}>
            {children}

            {/* llm load loading */}
            <LlmLoaderProgress progress={llmEngineLoadPercent} status={llmEngineLoadStatus} onReloadClick={() => {
                setLlmEngineLoadPercent(0);
                setLlmEngineLoadStatus('active');
                initLlmEngine('default');
            }}
                onGoToSetupCLick={() => {
                    setPagePath('/llm-set');
                }}
            />
        </GlobalContext.Provider>
    );
};

// 创建一个自定义的 hook 来便于在其他组件中使用 Context 数据
export const useGlobalContext = () => {
    return useContext(GlobalContext);
};
