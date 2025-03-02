
import React, { useState, useEffect } from 'react';
import { RiRobot2Line } from "react-icons/ri";
import { CiSquareQuestion, CiCircleInfo } from "react-icons/ci";
import { Tag, Button, Tooltip, Empty, message, Progress, Upload, Modal, Form, Input, Select } from 'antd';
import type { ProgressProps, UploadFile, UploadProps } from 'antd';
import * as constant from '@src/utils/constant';
import { useGlobalContext } from '@src/provider/global';
import { downloadLlmModelFiles, getUserProviderKeyInfo, saveUserProviderKeyInfo, uploadByCacheFiles } from '@src/utils/tool';
import { modelLibURLPrefix, modelVersion } from "@mlc-ai/web-llm";
import { t } from '@extension/i18n';

interface ModelItem {
  id: string
  name: string,
  modelId: string,
  isDefault: boolean,
  isCustom?: boolean,
  isLoaded: boolean,
  loadingStatus: ProgressProps['status'],
  loadingPercent: number
  contextWindowSize: number,
  sort: ModelSortUnion

  // api类型的属性
  apiKey?: string,
  baseUrl?: string,
  // webllm类型的属性
  modelSizeType?: 1 | 2
  wasmFileName?: string,
}

interface ApiKeyForm {
  baseUrl: string
  apiKey: string
  modelId: string
}

const DEFAULT_META_DATA = {
  isDefault: false,
  isLoaded: false,
  loadingStatus: 'normal' as ProgressProps['status'],
  loadingPercent: 0
}
const DEFAULT_MODEL_LIST: ModelItem[] = constant.LLM_MODEL_LIST.map((model) => {
  return {
    ...model,
    modelSizeType: model.modelSizeType as 1 | 2 | undefined,
    ...DEFAULT_META_DATA,
  }
}
)

const { Dragger } = Upload;

const LlmSetup = () => {
  const { llmEngineLoadStatus, reloadLlmModal } = useGlobalContext()

  const curCustomModelRef = React.useRef<ModelItem | null>(null);

  const [allLlmModels, setAllLlmModels] = useState<ModelItem[]>(DEFAULT_MODEL_LIST)
  const [curSelectProviderModelList, setCurSelectProviderModelList] = useState<{ label: string, value: string }[]>([])

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]); // 每个resource操作上传时的,最终上传文件列表
  const [uploadLoading, setUploadLoading] = useState(false);
  const [curUploadModal, setCurUploadModal] = useState<ModelItem | null>(null);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyForm] = Form.useForm<ApiKeyForm>();

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
      message.warning(t('download_model_again_wanning'));
      return;
    }

    // 更新状态为加载中
    setAllLlmModels((preModels) => {
      return preModels.map((item) => {
        if (item.id === model.id) {
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
            if (item.id === model.id) {
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

      await downloadLlmModelFiles(model.modelId, modelLibURLPrefix, modelVersion, model.wasmFileName!, initProgressCallback);

      message.success(t('download_model_success'));
    } catch (error) {
      console.error("load llm error", error);
      message.error('Load model failed ' + error.message);

      // 更新loading状态
      setAllLlmModels((preModels) => {
        return preModels.map((item) => {
          if (item.id === model.id) {
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
      message.warning(t('llm_loading_warning'));
      return;
    }
    if (model.isCustom) {
      const userProviderKeyInfo = getUserProviderKeyInfo(model.id)
      if (!userProviderKeyInfo || !userProviderKeyInfo.apiKey || !userProviderKeyInfo.selectModelId) {
        return message.warning(t('please_set_api_key'));
      }
    }

    if (model.sort === constant.ModelSort.Webllm) {
      message.loading(t('setting_default_model'));
    }

    const loadRes = await reloadLlmModal(model.id);
    if (loadRes.status === 'Fail') {
      message.error(loadRes.message);
      return;
    }

    if (loadRes.status === 'Success') {
      message.success(loadRes.message);
    }

    // 更新本地模型标记
    localStorage.setItem(constant.STORAGE_DEFAULT_MODEL_ID, model.id);
    setAllLlmModels((preModels) => {
      return preModels.map((item) => {
        if (item.id === model.id) {
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
  const handleUploadClick = async (model: ModelItem) => {
    setUploadModalOpen(true);

    // 重置状态
    setCurUploadModal(model);
    setUploadFileList([]);

  }
  const handleUploadConfirm = async () => {
    if (!curUploadModal) return;
    if (!uploadFileList.length) {
      message.warning(t('please_select_file'));
      return;
    }

    try {
      setUploadLoading(true);

      const files = uploadFileList.map((file) => file.originFileObj!);
      await uploadByCacheFiles(curUploadModal.modelId, files, modelLibURLPrefix, modelVersion)

      message.success(t('upload_model_success'));
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
  const handleHelpDocClick = () => {
    const lang = navigator.language || 'en';
    const enDocUrl = 'https://help.ncurator.com/en/guide/choose-llm-model.html'
    const zhDocUrl = 'https://help.ncurator.com/zh/guide/choose-llm-model.html'
    const helpDocUrl = lang.startsWith('zh') ? zhDocUrl : enDocUrl
    window.open(helpDocUrl)
  }

  const getModelSizeText = (modelSizeType: 1 | 2) => {
    if (modelSizeType === 1) {
      return t('large');
    } else {
      return t('medium');
    }
  }
  const getModelSortText = (sort: ModelSortUnion) => {
    if (sort === constant.ModelSort.Api) {
      return t('cloud');
    } else if (sort === constant.ModelSort.Webllm) {
      return t('local');
    } else {
      return 'unknown'
    }
  }

  // apikey
  const handleSetApiKeyConfirm = async () => {
    const validRes = await apiKeyForm.validateFields()
    if (!validRes) {
      return;
    }

    const curModel = curCustomModelRef.current;

    const { apiKey, modelId, baseUrl } = apiKeyForm.getFieldsValue() as ApiKeyForm;


    const userProviderKeyInfo: UserProviderKeyInfo = {
      apiKey,
      selectModelId: modelId,
      providerId: curModel!.id,
      baseUrl,
    }


    // 必须要先保存到本地,再去重新加载模型
    // 因为reloadLlmModal会去读取本地的
    saveUserProviderKeyInfo(userProviderKeyInfo)

    if (curModel?.isDefault) {
      const loadRes = await reloadLlmModal(curModel!.id);
      if (loadRes.status === 'Fail') {
        message.error(loadRes.message);
        return;
      }
    }
    message.success(t('set_api_key_success'));
    setApiKeyModalOpen(false);
  }
  const handleSetApiKeyClick = (model: ModelItem) => {
    // 去loacalstorage中取出apikey
    const userProviderKeyInfo = getUserProviderKeyInfo(model.id)

    // 设置form的值
    apiKeyForm.setFieldsValue({
      apiKey: userProviderKeyInfo?.apiKey || '',
      baseUrl: model.baseUrl || userProviderKeyInfo?.baseUrl || '',
      modelId: userProviderKeyInfo?.selectModelId || '',
    })

    curCustomModelRef.current = model;

    const curProviderModelList = constant.LLM_MODEL_LIST.find((item) => item.id === model.id)?.modelList || []

    setCurSelectProviderModelList([...curProviderModelList.map((item) => ({ label: item.name, value: item.id }))])

    setApiKeyModalOpen(true);
  }

  const loadedModels = allLlmModels.filter((model) => model.isLoaded).map((model) => (
    <div className="model-item bg-white rounded-md shadow py-3 px-2 space-y-2" key={model.modelId}>
      <div className="model-item-top flex items-center justify-between">
        <div className="model-item-left flex items-center gap-2">
          <div className="model-name text-base">{model.name}</div>
        </div>


        <div className='flex items-center gap-2'>
          {
            model.isCustom && <Button size="small" onClick={() => {
              handleSetApiKeyClick(model)
            }}>{t('set_api_key')}</Button>
          }
          {
            model.isDefault ?
              <Tag color={`orange`} className='text-sm'>{t('default')}</Tag>
              :
              <Button type="primary" size="small" onClick={() => { handleSetDefaultClick(model) }}>{t('set_default')}</Button>
          }
        </div>
      </div>
      <div className="tag  flex items-center ">
        <Tag color={model.sort === constant.ModelSort.Api ? 'blue' : 'green'} className='text-xs'>{getModelSortText(model.sort)}</Tag>
        {
          model.sort === constant.ModelSort.Webllm && <Tag color='gold' className='text-xs'>{getModelSizeText(model.modelSizeType!)}</Tag>
        }
        {
          model.isCustom && <Tag color='magenta' className='text-xs'>{t('custom')}</Tag>
        }
      </div>
    </div >
  ))
  const unloadedModels = allLlmModels.filter((model) => !model.isLoaded).map((model) => (
    <div className="model-item bg-white rounded-md shadow py-3 px-2 space-y-2" key={model.modelId}>
      <div className="model-top flex items-center justify-between">
        <div className="model-item-left flex items-center gap-2">
          <div className="model-name text-base">
            {model.name}
          </div>
        </div>
        {
          model.loadingStatus !== 'active' && <div className="flex items-center gap-2">
            {/* <Button size="small" onClick={() => handleUploadClick(model)}>{t('upload')}</Button> */}
            <Button type="primary" size="small" onClick={() => handleDownLoadLlm(model)}>{t('download')}</Button>
          </div>
        }
      </div>
      <div className="tag  flex items-center ">
        <Tag color={model.sort === constant.ModelSort.Api ? 'blue' : 'green'} className='text-xs'>{getModelSortText(model.sort)}</Tag>
        {
          model.sort === constant.ModelSort.Webllm && <Tag color='gold' className='text-xs'>{getModelSizeText(model.modelSizeType!)}</Tag>
        }
      </div>

      {
        model.loadingStatus !== 'normal' && <Progress percent={model.loadingPercent} status={model.loadingStatus} />
      }

    </div>
  ))

  const fetchAllModels = async () => {
    const localLoadedModelIds = localStorage.getItem(constant.STORAGE_LOADED_MODEL_IDS);
    let defaultModelId = localStorage.getItem(constant.STORAGE_DEFAULT_MODEL_ID);

    let newLlmModels = allLlmModels.map((model) => {
      const isLoaded = localLoadedModelIds?.split(',').includes(model.modelId) || false;
      return {
        ...model,
        isLoaded: model.sort === constant.ModelSort.Api ? true : isLoaded,// api默认理解为已加载的
        isDefault: model.id === defaultModelId
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
          <span className='text-lg font-bold'>{t('llm_setup')}</span>
        </div>
        <Tooltip placement="top" title={t('llm_desc')} >
          <span>
            <CiSquareQuestion size={20} className='cursor-pointer' />
          </span>
        </Tooltip>
        <a onClick={handleHelpDocClick} className='text-blue-500 underline cursor-pointer'>
          {t('help_doc')}
        </a>
      </div>

      <div className='flex-1 overflow-y-auto model-list'>
        <div className='text-base font-bold mb-2 flex items-center gap-1'>
          <span>
            {t('loaded_model')}
          </span>
          <Tooltip placement="top" title={t('local_cloud_desc')} >
            <span>
              <CiCircleInfo size={20} className='cursor-pointer' />
            </span>
          </Tooltip>
        </div>
        <div className="loaded-models mb-3 space-y-2">
          {
            !loadedModels.length ? <Empty description={t('no_loaded_model')} /> : loadedModels
          }
        </div>

        <div className='text-base font-bold mt-4 flex items-center gap-1'>
          <span>
            {t('unloaded_model')}
          </span>

          <Tooltip placement="top" title={t('local_cloud_desc')} >
            <span>
              <CiCircleInfo size={20} className='cursor-pointer' />
            </span>
          </Tooltip>
        </div>
        {/* <div className="text-xs text-text-500 mb-2">{t('download_model_tip')}</div> */}
        <div className="unloaded-models mb-3 space-y-2">
          {
            !unloadedModels.length ? <Empty description={t('no_unloaded_model')} /> : unloadedModels
          }
        </div>
      </div>

      <Modal confirmLoading={uploadLoading} cancelButtonProps={{ loading: uploadLoading }} maskClosable={false} centered title={t('upload_model_file')} open={uploadModalOpen} onOk={handleUploadConfirm} onCancel={() => { setUploadModalOpen(false) }}>
        <Dragger  {...uploadProps} fileList={uploadFileList} >
          <p className="ant-upload-text">{t('click_drag_file_tip')}</p>
          <p className="ant-upload-hint">
            {t('operation_data_safe_tip')}
          </p>
        </Dragger>
      </Modal>

      {/* 配置Provider的apikey的modal */}
      <Modal
        cancelText={t('cancel')}
        okText={t('confirm')}
        maskClosable={false} centered title={t('set_api_key')} open={apiKeyModalOpen} onOk={handleSetApiKeyConfirm} onCancel={() => { setApiKeyModalOpen(false) }}
      >
        <Form
          form={apiKeyForm}
          name="apiKeySet"
          layout="vertical"
        >
          {
            !curSelectProviderModelList.length &&
            <Form.Item label='URL' name="baseUrl" rules={[{ required: true }]} >
              <Input placeholder={t('enter_base_url')} />
            </Form.Item>
          }
          <Form.Item label='Key' name="apiKey" rules={[{ required: true }]}>
            <Input placeholder={t('enter_api_key')} />
          </Form.Item>
          <Form.Item label='Model' name="modelId" rules={[{ required: true }]}>
            {/* 选择模型为空时,则用户自己输入 */}
            {
              curSelectProviderModelList.length ?
                <Select
                  options={curSelectProviderModelList}
                />
                :
                <Input placeholder={t('enter_model_id')} />
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default LlmSetup;