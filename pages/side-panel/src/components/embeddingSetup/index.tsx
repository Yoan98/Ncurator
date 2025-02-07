import { Tag, Button, Tooltip, Empty, message, Progress, Upload, Modal } from 'antd';
import { CiSquareQuestion } from "react-icons/ci";
import { useState, useEffect } from 'react';
import type { ProgressProps } from 'antd';
import { Embedding } from '@src/utils/Embedding'
import { SlVector } from "react-icons/sl";
import { useGlobalContext } from '@src/provider/global';
import { t } from '@extension/i18n';

interface EmbeddingModel {
    modelId: string;
    name: string;
    isDefault: boolean;
    loadingStatus: ProgressProps['status'];
    loadingPercent: number;
    tag: string;
}

const EMBEDDING_MODEL_LIST: EmbeddingModel[] = [
    {
        modelId: 'nomic-ai/nomic-embed-text-v1',
        name: t('english_embedding'),
        isDefault: false,
        loadingStatus: 'normal',
        loadingPercent: 0,
        tag: t('applicable_english_languages')

    },
    {
        modelId: 'jinaai/jina-embeddings-v2-base-zh',
        name: t('chinese_embedding'),
        isDefault: false,
        loadingStatus: 'normal',
        loadingPercent: 0,
        tag: t('applicable_chinese_language')
    },

]

const EmbeddingSetup = () => {

    const { defaultEmbeddingModelId, setDefaultEmbeddingModelId } = useGlobalContext()

    const [embeddingModelList, setEmbeddingModelList] = useState(EMBEDDING_MODEL_LIST)

    const handleSetDefaultClick = async (model) => {
        if (embeddingModelList.some(item => item.loadingStatus === 'active')) {
            message.warning(t('model_is_loading'))
            return;
        }

        // 更新状态为加载中
        setEmbeddingModelList((preModels) => {
            return preModels.map((item) => {
                if (item.modelId === model.modelId) {
                    return {
                        ...item,
                        loadingStatus: 'active',
                        loadingPercent: 0
                    }
                }
                return item;
            })
        })


        // 加载embeding模型,主要用于首次下载
        try {

            const progress_callback = (progress) => {
                if (progress.file !== 'onnx/model.onnx' || !progress.progress) return
                // 更新load percent
                setEmbeddingModelList((preModels) => {
                    return preModels.map((item) => {
                        if (item.modelId === model.modelId) {
                            // 加载完成
                            if (progress.progress === 100) {
                                return {
                                    ...item,
                                    loadingPercent: 100,
                                    loadingStatus: 'success',
                                    isDefault: true
                                }
                            }

                            // 动态percent
                            return {
                                ...item,
                                loadingPercent: Math.floor(progress.progress),
                            }
                        }
                        return item;
                    })

                });
            }

            const embeddingModel = await Embedding.load(model.modelId, {
                progress_callback,
                wasmPath: chrome.runtime.getURL("/side-panel/")
            })
            // 释放模型,否则会占用内存
            await embeddingModel.dispose()

            // 更新默认模型
            localStorage.setItem('defaultEmbeddingModelId', model.modelId)
            setDefaultEmbeddingModelId(model.modelId)
        } catch (error) {
            console.error('error', error)
            // 更新状态为加载失败
            setEmbeddingModelList((preModels) => {
                return preModels.map((item) => {
                    if (item.modelId === model.modelId) {
                        return {
                            ...item,
                            loadingStatus: 'exception',
                            loadingPercent: 0
                        }
                    }
                    return item;
                })
            })
            message.error(t('failed_to_load_model')
            )
        }
    }

    const handleHelpDocClick = () => {
        const lang = navigator.language || 'en';
        const enDocUrl = 'https://help.ncurator.com/en/guide/choose-embed-model.html'
        const zhDocUrl = 'https://help.ncurator.com/zh/guide/choose-embed-model.html'
        const helpDocUrl = lang.startsWith('zh') ? zhDocUrl : enDocUrl
        window.open(helpDocUrl)
    }

    useEffect(() => {
        // 初始化默认模型
        if (defaultEmbeddingModelId) {
            setEmbeddingModelList((preModels) => {
                return preModels.map((item) => {
                    if (item.modelId === defaultEmbeddingModelId) {
                        return {
                            ...item,
                            loadingStatus: 'normal',
                            isDefault: true
                        }
                    }
                    return {
                        ...item,
                        loadingStatus: 'normal',
                        isDefault: false
                    }
                }
                )
            }
            )
        }
    }, [defaultEmbeddingModelId])

    return (
        <div className='embedding-setup pt-2 flex flex-col flex-1'>
            <div className='border-b pt-5 mb-5'>
                <div className="title flex items-end gap-1">
                    <div className='flex items-center gap-1 '>
                        <SlVector size={25} />
                        <span className='text-lg font-bold'>{t('embedding_model_setup')
                        }</span>
                    </div>
                    <Tooltip placement="top" title={t('all_data_processed_with_default_model')
                    } >
                        <span>
                            <CiSquareQuestion size={20} className='cursor-pointer' />
                        </span>
                    </Tooltip>

                    <a onClick={handleHelpDocClick} className='text-blue-500 underline cursor-pointer'>
                        {t('help_doc')}
                    </a>
                </div>

                <div className='text-xs text-text-400 mt-1'>
                    {t('embedding_model_setup_desc')}
                </div>
            </div>



            <div className="model-list space-y-2">

                {
                    embeddingModelList.map(model => {
                        return (
                            <div className="model-item bg-white rounded-md shadow py-3 px-2 space-y-2" key={model.modelId}>
                                <div className="model-item-top flex items-center justify-between">
                                    <div className="model-item-left flex items-center gap-2">
                                        <div className="model-name text-base">{model.name}</div>
                                    </div>

                                    {
                                        model.isDefault ?
                                            <Tag color={`orange`} className='text-sm'>{t('default')}</Tag>
                                            : <Button type="primary" size="small" onClick={() => { handleSetDefaultClick(model) }}>{t('set_default')}</Button>
                                    }
                                </div>
                                <div className="tag  flex items-center ">
                                    {
                                        model && <Tag color='gold' className='text-xs'>{model.tag}</Tag>
                                    }
                                </div>

                                {
                                    model.loadingStatus !== 'normal' && <Progress percent={model.loadingPercent} status={model.loadingStatus} />
                                }
                            </div >
                        )
                    })
                }

            </div>
        </div>
    )
}

export default EmbeddingSetup;