
import React, { useState, useEffect } from 'react';
import { RiRobot2Line } from "react-icons/ri";
import { CiSquareQuestion } from "react-icons/ci";
import { Tag, Button, Tooltip, Empty, message, Progress, Upload, Modal } from 'antd';
import type { ProgressProps, UploadFile, UploadProps } from 'antd';
import * as constant from '@src/utils/constant';
import { useGlobalContext } from '@src/provider/global';
import { downloadLlmModelFiles, uploadByCacheFiles } from '@src/utils/tool';
import { LLM_MODEL_LIST } from '@src/config';
import { modelLibURLPrefix, modelVersion } from "@mlc-ai/web-llm";

interface ModelItem {
    name: string,
    modelId: string,
    wasmFileName: string,
    isDefault: boolean,
    isLoaded: boolean,
    loadingStatus: ProgressProps['status'],
    loadingPercent: number
    vramRequiredMB: number
    modelSizeType: 'Bigger' | 'Smaller'
}

const DEFAULT_META_DATA = {
    isDefault: false,
    isLoaded: false,
    loadingStatus: 'normal' as ProgressProps['status'],
    loadingPercent: 0
}
const DEFAULT_MODEL_LIST: ModelItem[] = LLM_MODEL_LIST.map((model) => {
    return {
        ...model,
        modelSizeType: model.modelSizeType as 'Bigger' | 'Smaller',
        ...DEFAULT_META_DATA
    }
}
)

const { Dragger } = Upload;

const LlmSetup = () => {
    const { llmEngineLoadStatus, reloadLlmModal } = useGlobalContext()

    const [allLlmModels, setAllLlmModels] = useState<ModelItem[]>(DEFAULT_MODEL_LIST)

    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]); // 每个resource操作上传时的,最终上传文件列表
    const [uploadLoading, setUploadLoading] = useState(false);
    const [curUploadModal, setCurUploadModal] = useState<ModelItem | null>(null);


    const uploadProps: UploadProps = {
        multiple: true,
        accept: '.wasm,.bin,.json',
        beforeUpload: (file) => {
            return false
        },
        onChange(info) {
            setUploadFileList([...info.fileList]);
        },
    };

    const handleDownLoadLlm = async (model: ModelItem) => {
        if (allLlmModels.some((item) => item.loadingStatus === 'active')) {
            message.warning('A model is downloading. Please wait a moment');
            return;
        }

        // 更新状态为加载中
        setAllLlmModels((preModels) => {
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

        try {
            const initProgressCallback = (progress: number) => {
                // 更新load percent
                setAllLlmModels((preModels) => {
                    return preModels.map((item) => {
                        if (item.modelId === model.modelId) {
                            // 加载完成
                            if (progress === 1) {
                                return {
                                    ...item,
                                    loadingPercent: 100,
                                    isLoaded: true,
                                    loadingStatus: 'success'
                                }
                            }

                            // 动态percent
                            return {
                                ...item,
                                loadingPercent: Math.floor(progress * 100),
                            }
                        }
                        return item;
                    })

                });
            }

            await downloadLlmModelFiles(model.modelId, modelLibURLPrefix, modelVersion, model.wasmFileName, initProgressCallback);

            message.success('Download model success');
        } catch (error) {
            console.error("load llm error", error);
            message.error('Load model failed ' + error.message);

            // 更新loading状态
            setAllLlmModels((preModels) => {
                return preModels.map((item) => {
                    if (item.modelId === model.modelId) {
                        return {
                            ...item,
                            loadingPercent: 0,
                            loadingStatus: 'normal',
                            loaded: false
                        }
                    }
                    return item;
                })
            })
        }

    }
    const handleSetDefaultClick = async (model: ModelItem) => {
        if (llmEngineLoadStatus === 'active') {
            message.warning('LLM model is loading, please wait a moment');
            return;
        }

        message.loading('Setting default model');

        const loadRes = await reloadLlmModal(model.modelId);
        if (loadRes.status === 'Fail') {
            message.error(loadRes.message);
            return;
        }

        if (loadRes.status === 'Success') {
            message.success(loadRes.message);
        }

        setDefaultModel(model);
    }
    const handleUploadClick = async (model: ModelItem) => {
        setUploadModalOpen(true);

        // 重置状态
        setCurUploadModal(model);
        setUploadFileList([]);

    }
    const handleUploadConfirm = async () => {
        if (!curUploadModal) return;
        if (!uploadFileList.length) {
            message.warning('Please upload model file');
            return;
        }

        try {
            setUploadLoading(true);

            const files = uploadFileList.map((file) => file.originFileObj!);
            await uploadByCacheFiles(curUploadModal.modelId, files, modelLibURLPrefix, modelVersion)

            message.success('Upload model success');
            setUploadModalOpen(false);

            setAllLlmModels((preModels) => {
                return preModels.map((item) => {
                    if (item.modelId === curUploadModal.modelId) {
                        // 加载完成
                        return {
                            ...item,
                            isLoaded: true,
                        }
                    }
                    return item;
                })

            });

        } catch (error) {
            console.error("upload model error", error);
            message.error('Upload model failed ' + error.message);
        }

        setUploadLoading(false);
    }

    const setDefaultModel = (model: ModelItem) => {
        localStorage.setItem(constant.STORAGE_DEFAULT_MODEL_ID, model.modelId);
        setAllLlmModels((preModels) => {
            return preModels.map((item) => {
                if (item.modelId === model.modelId) {
                    return {
                        ...item,
                        isDefault: true
                    }
                }
                return {
                    ...item,
                    isDefault: false
                }
            })
        })
    }

    const loadedModels = allLlmModels.filter((model) => model.isLoaded).map((model) => (
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
                <Tag color='gold' className='text-xs'>{model.modelSizeType}</Tag>
                <Tag color='gold' className='text-xs'>VRAM: {(model.vramRequiredMB / 1024).toFixed(2)}G</Tag>
            </div>
        </div >
    ))
    const unloadedModels = allLlmModels.filter((model) => !model.isLoaded).map((model) => (
        <div className="model-item bg-white rounded-md shadow py-3 px-2 space-y-2" key={model.modelId}>
            <div className="model-top flex items-center justify-between">
                <div className="model-item-left flex items-center gap-2">
                    <div className="model-name text-base">{model.name}</div>
                </div>
                {
                    model.loadingStatus !== 'active' && <div className="flex items-center gap-2">
                        <Button size="small" onClick={() => handleUploadClick(model)}>Upload</Button>
                        <Button type="primary" size="small" onClick={() => handleDownLoadLlm(model)}>Download</Button>
                    </div>
                }
            </div>
            <div className="tag  flex items-center ">
                <Tag color='gold' className='text-xs'>{model.modelSizeType}</Tag>
                <Tag color='gold' className='text-xs'>VRAM: {(model.vramRequiredMB / 1024).toFixed(2)}G</Tag>
            </div>

            {
                model.loadingStatus !== 'normal' && <Progress percent={model.loadingPercent} status={model.loadingStatus} />
            }

        </div>
    ))

    const fetchAllModels = async () => {
        const localLoadedModelIds = localStorage.getItem(constant.STORAGE_LOADED_MODEL_IDS);
        let defaultModelId = localStorage.getItem(constant.STORAGE_DEFAULT_MODEL_ID);

        let newLlmModels = allLlmModels.map((allModel) => {
            const isLoaded = localLoadedModelIds?.split(',').includes(allModel.modelId) || false;
            return {
                ...allModel,
                isLoaded,
                isDefault: allModel.modelId === defaultModelId
            };
        })

        setAllLlmModels(newLlmModels);
    }

    useEffect(() => {
        fetchAllModels();
    }, [])

    useEffect(() => {
        if (!allLlmModels.length) return
        // 检查是否有下载好的模型,更新到localstorage
        const loadedModelIds = allLlmModels.filter((model) => model.isLoaded).map((model) => model.modelId);
        localStorage.setItem(constant.STORAGE_LOADED_MODEL_IDS, loadedModelIds.join(','));

    }, [allLlmModels])

    return (
        <div className='llm-setup pt-2 flex flex-col flex-1'>
            <div className="title flex border-b py-5 items-end gap-1 mb-4">
                <div className='flex items-center gap-1 '>
                    <RiRobot2Line size={25} />
                    <span className='text-lg font-bold'>LLM Setup</span>
                </div>
                <Tooltip placement="top" title='语言模型是一个能够理解你的文本和生成文本的一项技术，不同模型的理解与生成质量会有不同' >
                    <span>
                        <CiSquareQuestion size={20} className='cursor-pointer' />
                    </span>
                </Tooltip>
            </div>

            <div className='text-base font-bold mb-2 '>Loaded Model</div>
            <div className="loaded-models mb-3 space-y-2">
                {
                    !loadedModels.length ? <Empty description="No loaded model" /> : loadedModels
                }
            </div>

            <div className='text-base font-bold mt-4'>Unloaded Model</div>
            <div className="text-xs text-text-500 mb-2">模型默认将从huggingface下载，如网速受限，可查看此链接步骤，下载模型到本地再上传</div>
            <div className="unloaded-models mb-3 space-y-2">
                {
                    !unloadedModels.length ? <Empty description="No unloaded model" /> : unloadedModels
                }
            </div>

            <Modal confirmLoading={uploadLoading} cancelButtonProps={{ loading: uploadLoading }} maskClosable={false} centered title='Upload model file' open={uploadModalOpen} onOk={handleUploadConfirm} onCancel={() => { setUploadModalOpen(false) }}>
                <Dragger  {...uploadProps} fileList={uploadFileList} >
                    <p className="ant-upload-text">Click or drag model file to this area</p>
                    <p className="ant-upload-hint">
                        All the data will be storage in your local database
                    </p>
                </Dragger>
            </Modal>
        </div>
    );
}

export default LlmSetup;