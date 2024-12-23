import { Tag, Button, Tooltip, Empty, message, Progress, Upload, Modal } from 'antd';
import { CiSquareQuestion } from "react-icons/ci";
import { useState, useEffect } from 'react';
import type { ProgressProps } from 'antd';
import { Embedding } from '@src/utils/Embedding'
import { SlVector } from "react-icons/sl";
import { useGlobalContext } from '@src/provider/global';

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
        name: 'Common Embedding',
        isDefault: false,
        loadingStatus: 'normal',
        loadingPercent: 0,
        tag: 'Recommend Global Language'
    },
    {
        modelId: 'jinaai/jina-embeddings-v2-base-zh',
        name: 'Chinese Embedding',
        isDefault: false,
        loadingStatus: 'normal',
        loadingPercent: 0,
        tag: 'Recommend Chinese Language'
    },

]

const EmbeddingSetup = () => {

    const { defaultEmbeddingModelId, setDefaultEmbeddingModelId } = useGlobalContext()

    const [embeddingModelList, setEmbeddingModelList] = useState(EMBEDDING_MODEL_LIST)

    const handleSetDefaultClick = async (model) => {
        if (embeddingModelList.some(item => item.loadingStatus === 'active')) {
            message.warning('Model is loading, please wait a moment')
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
            message.error('Failed to load model, please try again later')
        }
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
            <div className="title flex border-b py-5 items-end gap-1 mb-4">
                <div className='flex items-center gap-1 '>
                    <SlVector size={25} />
                    <span className='text-lg font-bold'>Embedding Model Setup</span>
                </div>
                <Tooltip placement="top" title='All data will be processed using the default embedding model. Changing it may cause some previous data to become unmatched.' >
                    <span>
                        <CiSquareQuestion size={20} className='cursor-pointer' />
                    </span>
                </Tooltip>
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
                                            <Tag color={`orange`} className='text-sm'>Default</Tag>
                                            : <Button type="primary" size="small" onClick={() => { handleSetDefaultClick(model) }}>Set Default</Button>
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