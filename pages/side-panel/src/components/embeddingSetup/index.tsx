import { Tag, Button, Tooltip, Empty, message, Progress, Upload, Modal } from 'antd';
import { CiSquareQuestion } from "react-icons/ci";
import { useState, useEffect } from 'react';
import type { ProgressProps } from 'antd';
import { Embedding } from '@src/utils/Embedding'
import { SlVector } from "react-icons/sl";

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
        name: 'Global Embedding',
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

    const [embeddingModelList, setEmbeddingModelList] = useState(EMBEDDING_MODEL_LIST)

    const handleSetDefaultClick = async (model) => {
        // 加载embeding模型,主要用于首次下载
        const progress_callback = (progress) => {
            console.log('progress', progress)
        }

        const embeddingModel = await Embedding.load(model.modelId, {
            progress_callback
        })
        console.log('embeddingModel', embeddingModel)
        // 释放模型,否则会占用内存
        await embeddingModel.dispose()

        // 存储默认语言模型
        localStorage.setItem('defaultEmbeddingModel', model.modelId)

        // 更新默认模型
        setEmbeddingModelList(embeddingModelList.map(item => {
            return {
                ...item,
                isDefault: item.modelId === model.modelId
            }
        }))
    }

    useEffect(() => {
        // 设置默认语言模型
        const defaultEmbeddingModel = localStorage.getItem('defaultEmbeddingModel')
        if (defaultEmbeddingModel) {
            setEmbeddingModelList(embeddingModelList.map(item => {
                return {
                    ...item,
                    isDefault: item.modelId === defaultEmbeddingModel
                }
            }))
        }
    }, [])

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