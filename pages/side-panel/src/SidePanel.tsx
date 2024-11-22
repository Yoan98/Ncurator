import { withErrorBoundary, withSuspense } from '@extension/shared';
import { Button, Dropdown, MenuProps, Drawer } from 'antd';

import { useState, useEffect } from 'react';
import { FiSidebar } from "react-icons/fi";
import { RiRobot2Line } from "react-icons/ri";
import { IoDocumentAttachOutline } from "react-icons/io5";
import { FaRocketchat } from "react-icons/fa";
import { CiSearch } from "react-icons/ci";
import SearchSection from '@src/components/search/index';
import Resource from '@src/components/resource/index';
import LlmSetup from '@src/components/llmSetup/index';
import { IoIosArrowRoundBack } from "react-icons/io";

import { useGlobalContext } from '@src/provider/global';



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

const SidePanel = () => {
    const { pagePath, setPagePath, loadLlmEngine } = useGlobalContext()

    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyTitle, setHistoryTitle] = useState<string>('');

    const [activeTab, setActiveTab] = useState<Tab>('search');


    const setHistoryTitleByTab = (tab: Tab) => {
        if (tab === 'search') {
            setHistoryTitle('Search History');
        } else {
            setHistoryTitle('Chat History');
        }
    }

    const handleMenuItemClick = ({ key }) => {
        if (key == 1) {
            setPagePath('/resource');
        } else if (key == 2) {
            setPagePath('/llm-set');
        }
    }



    useEffect(() => {
        const tab = localStorage.getItem("activeTab") as Tab;
        setActiveTab(tab || 'search');

        // load llm model
        loadLlmEngine({
            modelId: 'default'
        });
    }, [])

    useEffect(() => {
        setHistoryTitleByTab(activeTab);
    }, [activeTab])


    return (
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
                <SearchSection></SearchSection>
            </div>

            {/* resource content */}
            <div className={`resource-content flex-1 flex flex-col ${pagePath === '/resource' ? 'block' : 'hidden'}`}>
                <Resource></Resource>
            </div>

            {/* llm setup content */}
            <div className={`llm-setup-content flex-1 flex flex-col ${pagePath === '/llm-set' ? 'block' : 'hidden'}`}>
                <LlmSetup></LlmSetup>
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


        </div>
    );
};


export default withErrorBoundary(withSuspense(SidePanel, <div> Loading ... </div>), <div> Error Occur </div>);
