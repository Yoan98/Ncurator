import { withErrorBoundary, withSuspense } from '@extension/shared';
import type { DrawerProps } from 'antd';
import { Button, ConfigProvider, ConfigProviderProps, Dropdown, MenuProps, Drawer } from 'antd';
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

type Locale = ConfigProviderProps['locale'];
dayjs.locale('en');

const settingItems: MenuProps['items'] = [
    {
        key: '1',
        label: 'Document',
        icon: <IoDocumentAttachOutline />,
    },
    {
        key: '2',
        label: 'LLM Model',
        icon: <RiRobot2Line />,
    }
];

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

const SidePanel = () => {

    const [historyOpen, setHistoryOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>('search');
    const [historyTitle, setHistoryTitle] = useState<string>('');
    const [locale, setLocal] = useState<Locale>(enUS);

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

    useLayoutEffect(() => {
        initLang();
    }, []);

    useEffect(() => {
        const tab = localStorage.getItem("activeTab") as Tab;
        setActiveTab(tab || 'search');
    }, [])

    useEffect(() => {
        setHistoryTitleByTab(activeTab);
    }, [activeTab])

    return (
        <ConfigProvider
            locale={locale}
            theme={{
                token: {
                    colorPrimary: '#404040',
                },
            }}
        >
            <div className='App bg-background min-h-screen px-2 py-3'>
                <div className="header flex items-center justify-between">
                    <div className="header-left flex items-center gap-2" onClick={() => { setHistoryOpen(true) }}>
                        <FiSidebar cursor='pointer' size={20} />
                    </div>
                    <div className="header-right">
                        <Dropdown menu={{ items: settingItems }} placement="bottomRight">
                            <Button size="small">S</Button>
                        </Dropdown>
                    </div>
                </div>

                <div className="toggle-wrap h-[30px]">
                    <div className="toggle  fixed top-6 left-1/2 transform -translate-x-1/2">
                        <ToggleSwitch initialTab='search' onToggleSwitch={(tab) =>
                            setActiveTab(tab)
                        } />
                    </div>
                </div>

                <div className="content-wrap mt-5">
                    <SearchSection></SearchSection>
                </div>

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

            </div>
        </ConfigProvider>

    );
};


export default withErrorBoundary(withSuspense(SidePanel, <div> Loading ... </div>), <div> Error Occur </div>);
