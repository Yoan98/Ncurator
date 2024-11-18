import { withErrorBoundary, withSuspense } from '@extension/shared';
import type { ProgressProps } from 'antd';
import { Button, ConfigProvider, ConfigProviderProps, Dropdown, MenuProps, Drawer, Progress } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/lib/locale/en_US';
import 'dayjs/locale/zh-cn';
import React, { useState, useLayoutEffect, useEffect } from 'react';
import dayjs from 'dayjs';
import { FiSidebar } from "react-icons/fi";
import { RiRobot2Line } from "react-icons/ri";
import { IoDocumentAttachOutline } from "react-icons/io5";
import { FaRocketchat } from "react-icons/fa";
import { CiSearch } from "react-icons/ci";
import SearchSection from '@src/components/search/index';
import Resource from '@src/components/resource/index';
import type { InitProgressReport, WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { CreateWebWorkerMLCEngine, modelVersion, modelLibURLPrefix, prebuiltAppConfig } from "@mlc-ai/web-llm";
import { IoIosArrowRoundBack } from "react-icons/io";
import * as constant from '@src/utils/constant';
import { GlobalProvider } from '@src/provider/global';

type Locale = ConfigProviderProps['locale'];
dayjs.locale('en');

// 设置项dropdown菜单
const settingItems: MenuProps['items'] = [
    {
        key: 1,
        label: 'Resource',
        icon: <IoDocumentAttachOutline />,
    },
    {
        key: 2,
        label: 'LLM Model',
        icon: <RiRobot2Line />,
    }
];

// tab切换组件
type Tab = 'search' | 'chat';
const ToggleSwitch = ({
    initialTab,
    onToggleSwitch
}: {
    initialTab: Tab
    onToggleSwitch?: (tab: Tab) => void
}) => {

    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const [activeTab, setActiveTab] = useState(initialTab);

    useEffect(() => {
        localStorage.setItem("activeTab", activeTab);
        setIsInitialLoad(false);
    }, [activeTab]);

    const handleTabChange = (tab: Tab) => {
        localStorage.setItem("activeTab", tab);
        setActiveTab(tab);

        if (tab === "search") {
            onToggleSwitch && onToggleSwitch('search');
        } else {
            onToggleSwitch && onToggleSwitch('chat');
        }
    };

    return (
        <div className="bg-gray-100 flex rounded-full p-1 relative">
            <div
                className={`absolute top-1 bottom-1 ${activeTab === "chat" ? "w-[45%]" : "w-[50%]"
                    } bg-white rounded-full shadow ${isInitialLoad ? "" : "transition-transform duration-300 ease-in-out"
                    } ${activeTab === "chat" ? "translate-x-[115%]" : "translate-x-[1%]"}`}
            />
            <button
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors duration-300 ease-in-out flex items-center relative z-10 ${activeTab === "search"
                    ? "text-gray-800"
                    : "text-gray-500 hover:text-gray-700"
                    }`}
                onClick={() => handleTabChange("search")}
            >
                <CiSearch size={16} className="mr-2" />
                <div className="flex  items-center">
                    Search
                </div>
            </button>
            <button
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors duration-300 ease-in-out flex items-center relative z-10 ${activeTab === "chat"
                    ? "text-gray-800"
                    : "text-gray-500 hover:text-gray-700"
                    }`}
                onClick={() => handleTabChange("chat")}
            >
                <FaRocketchat size={16} className="mr-2" />
                <div className="items-end flex">
                    Chat
                </div>
            </button>
        </div>
    );
};

// LLM加载进度组件
const LlmLoaderProgress = ({ progress, status, onReloadClick }: { progress: number, status: ProgressProps['status'], onReloadClick: () => void }) => {
    let ProgressTipEle
    if (status === 'active') {
        ProgressTipEle = <div className="text-text-400">Loading LLM Model ...</div>
    } else if (status === 'exception') {
        ProgressTipEle = <div className='text-text-error cursor-pointer' onClick={onReloadClick}>Load LLM Model Error, click try again</div>
    } else {
        ProgressTipEle = <div className="text-text-success">Load LLM Model Success</div>
    }


    return (
        <div className={`llm-load-status bg-white rounded-lg py-1 px-2 animate__animated shadow-md  ${progress == 100 ? 'animate__backOutRight animate__delay-2s' : 'animate__backInRight'}`}>
            {
                !status
                    ?
                    <div className='text-text-error cursor-pointer'>Haven't find your LLM model,please go to set up.</div>
                    :
                    <div className='flex flex-col items-end'>
                        <Progress percent={progress} status={status} type="circle" size={30} />

                        {ProgressTipEle}
                    </div>

            }
        </div>
    );
}

const pageList = ['/main', '/resource', '/llm-set'];

const SidePanel = () => {
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyTitle, setHistoryTitle] = useState<string>('');

    const [activeTab, setActiveTab] = useState<Tab>('search');

    const [locale, setLocal] = useState<Locale>(enUS);

    const [selectModel, setSelectModal] = useState<string>('');
    const [llmEngine, setLlmEngine] = useState<WebWorkerMLCEngine | null>(null);
    const [llmEngineLoadPercent, setLlmEngineLoadPercent] = useState<number>(0);
    const [llmEngineLoadStatus, setLlmEngineLoadStatus] = useState<ProgressProps['status']>('active');

    const [pagePath, setPagePath] = useState<string>('/main');


    const initLang = () => {
        const curLang = navigator.language || 'en';
        if (curLang.startsWith('zh')) {
            setLocal(zhCN);
            dayjs.locale('zh-cn');
        }
    }
    const setHistoryTitleByTab = (tab: Tab) => {
        if (tab === 'search') {
            setHistoryTitle('Search History');
        } else {
            setHistoryTitle('Chat History');
        }
    }
    const loadLlm = async (selectModel) => {
        if (selectModel === 'default') {
            // 检查本地模型
            const defaultModal = localStorage.getItem('defaultModal');
            if (!defaultModal) {
                setLlmEngineLoadStatus(undefined);
                return
            }

            selectModel = defaultModal;
        }


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
                    new URL("./worker-pool/llm.ts", import.meta.url),
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
            setSelectModal(selectModel!);
        } catch (error) {

            console.error("load llm error", error);
            setLlmEngineLoadStatus('exception');
        }

    }

    const handleMenuItemClick = ({ key }) => {
        if (key == 1) {
            setPagePath('/resource');
        } else if (key == 2) {
            setPagePath('/llm-set');
        }
    }

    useLayoutEffect(() => {
        initLang();
    }, []);

    useEffect(() => {
        const tab = localStorage.getItem("activeTab") as Tab;
        setActiveTab(tab || 'search');

        // load llm model
        loadLlm('default');
    }, [])

    useEffect(() => {
        setHistoryTitleByTab(activeTab);
    }, [activeTab])


    return (
        <GlobalProvider>
            <ConfigProvider
                locale={locale}
                theme={{
                    token: {
                        colorPrimary: constant.THEME_COLOR,
                    },
                    components: {
                        Progress: {
                            defaultColor: constant.THEME_COLOR
                        }
                    }
                }}
            >
                <div className='App bg-background min-h-screen px-2 py-3 flex flex-col'>

                    <div className="header flex items-center justify-between">
                        <div className="header-left flex items-center gap-2">
                            {
                                pagePath === '/main' ? <FiSidebar cursor='pointer' size={20} onClick={() => { setHistoryOpen(true) }} /> : <IoIosArrowRoundBack cursor='pointer' size={25} onClick={() => { setPagePath('/main') }} />
                            }
                        </div>
                        <div className="header-right">
                            <Dropdown menu={{ items: settingItems, onClick: handleMenuItemClick }} placement="bottomRight">
                                <Button size="small">S</Button>
                            </Dropdown>
                        </div>
                    </div>


                    {/* main content */}
                    <div className={`main-content-wrap mt-5 ${pagePath === '/main' ? 'block' : 'hidden'}`}>
                        <div className="toggle-wrap h-[30px]">
                            <div className="toggle  fixed top-6 left-1/2 transform -translate-x-1/2">
                                <ToggleSwitch initialTab='search' onToggleSwitch={(tab) =>
                                    setActiveTab(tab)
                                } />
                            </div>
                        </div>
                        <SearchSection llmEngine={llmEngine}></SearchSection>
                    </div>

                    {/* resource content */}
                    <div className={`resource-content flex-1 flex flex-col ${pagePath === '/resource' ? 'block' : 'hidden'}`}>
                        <Resource></Resource>
                    </div>


                    {/* history side */}
                    <Drawer
                        width={200}
                        title={historyTitle}
                        placement='left'
                        closable={true}
                        onClose={() => setHistoryOpen(false)}
                        open={historyOpen}
                        key='left'
                    >
                        <div className='space-y-2'>
                            <div className="time">
                                <p className='text-xs text-text-400 mb-1'>Today</p>
                                <div className="history-title space-y-1">

                                    <Button type='text' className='text-sm text-text-500' size="small">
                                        图形学是什么
                                    </Button>
                                </div>
                            </div>

                        </div>
                    </Drawer>

                    {/* llm load loading */}
                    <div className="fixed right-0 bottom-0 px-1">
                        <LlmLoaderProgress progress={llmEngineLoadPercent} status={llmEngineLoadStatus} onReloadClick={() => {
                            setLlmEngineLoadPercent(0);
                            setLlmEngineLoadStatus('active');
                            loadLlm('default');
                        }} />
                    </div>
                </div>
            </ConfigProvider>
        </GlobalProvider>
    );
};


export default withErrorBoundary(withSuspense(SidePanel, <div> Loading ... </div>), <div> Error Occur </div>);
