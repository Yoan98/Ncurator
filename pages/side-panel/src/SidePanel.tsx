import { withErrorBoundary, withSuspense } from '@extension/shared';
import { Button, Dropdown, MenuProps, Drawer, Tooltip } from 'antd';

import { useState, useEffect } from 'react';
import { FiSidebar } from "react-icons/fi";
import { RiRobot2Line } from "react-icons/ri";
import { IoDocumentAttachOutline } from "react-icons/io5";
import { FaRocketchat } from "react-icons/fa";
import { CiSearch } from "react-icons/ci";
import SearchSection from '@src/components/search/index';
import ChatSection from '@src/components/chat/index';
import Resource from '@src/components/resource/index';
import LlmSetup from '@src/components/llmSetup/index';
import { IoIosArrowRoundBack } from "react-icons/io";
import { CiEdit } from "react-icons/ci";

import { useGlobalContext } from '@src/provider/global';
import dayjs from '@src/utils/dayjsGlobal';
import { t } from '@extension/i18n';


interface GroupedChatHistory {
    title: string;
    history: Chat.LocalHistory[];
}

// 设置项dropdown菜单
const settingItems: MenuProps['items'] = [
    {
        key: 1,
        label: t('Resource'),
        icon: <IoDocumentAttachOutline size={18} />,
    },
    {
        key: 2,
        label: t('LLMModel'),
        icon: <RiRobot2Line size={18} />,
    }
];

// tab切换组件
export type Tab = 'search' | 'chat';
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

    const [activeTab, setActiveTab] = useState<Tab>('chat');

    const [groupedChatHistory, setGroupedChatHistory] = useState<GroupedChatHistory[]>([]);
    const [curChatHistoryId, setCurChatHistoryId] = useState<number>(1);


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
    const handleChatHistoryUpdate = (localChatHistory: Chat.LocalHistory[]) => {
        setGroupedChatHistory(groupChatHistory(localChatHistory));
    }
    const handleNewChatClick = () => {
        const localChatHistoryStr = localStorage.getItem('chatLocalHistory');
        const localChatHistory: Chat.LocalHistory[] = localChatHistoryStr ? JSON.parse(localChatHistoryStr) : [];
        // 默认进来就会给一个historyId为1的空聊天记录，所以这里需要判断下，避免重复
        if (!localChatHistory.length) {
            return;
        }

        const newChatHistoryId = localChatHistory.length + 1;

        setCurChatHistoryId(newChatHistoryId);
        setHistoryOpen(false);
    }
    const groupChatHistory = (localChatHistory: Chat.LocalHistory[]) => {
        // 按照当天,昨天,近七天,更早的时间顺序分组
        const history = localChatHistory.reduce((acc, item) => {
            // 获取最后一条消息的时间戳
            const date = dayjs(item.uiMessages[item.uiMessages.length - 1].timestamp);
            const today = dayjs(); // 当前时间
            const yesterday = today.subtract(1, 'day'); // 昨天
            const sevenDaysAgo = today.subtract(7, 'days'); // 七天前

            // 判断日期并分组
            if (date.isSame(today, 'day')) {
                acc.today.push(item); // 今天
            } else if (date.isSame(yesterday, 'day')) {
                acc.yesterday.push(item); // 昨天
            } else if (date.isAfter(sevenDaysAgo)) {
                acc.sevenDays.push(item); // 近七天
            } else {
                acc.earlier.push(item); // 更早
            }

            return acc;
        }, {
            today: [] as Chat.LocalHistory[],
            yesterday: [] as Chat.LocalHistory[],
            sevenDays: [] as Chat.LocalHistory[],
            earlier: [] as Chat.LocalHistory[]
        });

        const groupList: GroupedChatHistory[] = []

        const getTitle = (key: string) => {
            switch (key) {
                case 'today':
                    return 'Today';
                case 'yesterday':
                    return 'Yesterday';
                case 'sevenDays':
                    return 'Last 7 days';
                case 'earlier':
                    return 'Earlier';
                default:
                    return '';
            }
        }

        for (const key in history) {
            groupList.push({
                title: getTitle(key),
                history: history[key]
            })
        }
        return groupList;
    }



    useEffect(() => {
        const tab = localStorage.getItem("activeTab") as Tab;
        setActiveTab(tab || 'search');

        // load llm model
        loadLlmEngine('default');

        // 初始话chat history
        const chatLocalHistoryStr = localStorage.getItem('chatLocalHistory');
        const chatLocalHistory: Chat.LocalHistory[] = chatLocalHistoryStr ? JSON.parse(chatLocalHistoryStr) : [];

        const curChatHistoryId = chatLocalHistory[0]?.historyId || 1;
        const groupedChatHistory = groupChatHistory(chatLocalHistory);

        setCurChatHistoryId(curChatHistoryId);
        setGroupedChatHistory(groupedChatHistory);
    }, [])

    useEffect(() => {
        setHistoryTitleByTab(activeTab);
    }, [activeTab])


    return (
        <div className='App bg-background h-screen overflow-hidden px-2 py-3 flex flex-col'>
            <div className="header flex items-center justify-between">
                <div className="header-left flex items-center gap-2">
                    {
                        pagePath === '/main' ?
                            activeTab === 'chat' ?
                                <FiSidebar cursor='pointer' size={20} onClick={() => { setHistoryOpen(true) }} />
                                : <></>
                            :
                            <IoIosArrowRoundBack cursor='pointer' size={25} onClick={() => { setPagePath('/main') }} />
                    }
                </div>
                <div className="header-right">
                    <Dropdown menu={{ items: settingItems, onClick: handleMenuItemClick }} placement="bottomRight">
                        <Button size="small">S</Button>
                    </Dropdown>
                </div>
            </div>



            {/* main content */}
            <div className={`main-content-wrap flex-1 flex flex-col mt-5 ${pagePath === '/main' ? 'block' : 'hidden'}`}>
                <div className="toggle-wrap h-[30px]">
                    <div className="toggle  fixed top-6 left-1/2 transform -translate-x-1/2">
                        <ToggleSwitch initialTab='search' onToggleSwitch={(tab) =>
                            setActiveTab(tab)
                        } />
                    </div>
                </div>

                <div className="main-content flex-1 flex flex-col">

                    <div className={`flex-1 flex flex-col ${activeTab === 'search' ? 'block' : 'hidden'}`}>
                        <SearchSection></SearchSection>
                    </div>
                    <div className={`flex-1 flex flex-col ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
                        <ChatSection
                            chatHistoryId={curChatHistoryId}
                            activeTab={activeTab}
                            onHistoryUpdate={handleChatHistoryUpdate}
                        ></ChatSection>
                    </div>
                </div>
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
                width={240}
                title={historyTitle}
                placement='left'
                closable={true}
                onClose={() => setHistoryOpen(false)}
                open={historyOpen}
                key='left'
                extra={
                    <Tooltip placement="bottom" title='New Chat' >
                        <Button size="small" icon={<CiEdit></CiEdit>} onClick={handleNewChatClick}></Button>
                    </Tooltip>
                }
            >
                <div className='space-y-2'>
                    {
                        groupedChatHistory.map((group) => (
                            group.history.length === 0 ? <div key={group.title}></div> :
                                <div key={group.title}>
                                    <p className='text-xs mb-2 font-bold'>{group.title}</p>
                                    <div className="history-title">
                                        {
                                            group.history.map((history) => (
                                                <div className={`p-2 text-sm rounded-lg hover:bg-text-200 cursor-pointer truncate ${curChatHistoryId === history.historyId && 'bg-text-200'}`} key={history.historyId} onClick={() => {
                                                    setCurChatHistoryId(history.historyId);
                                                    setHistoryOpen(false);
                                                }}>
                                                    {history.uiMessages[0].content || 'New Chat'}
                                                </div>
                                            ))
                                        }
                                    </div>
                                </div>

                        ))
                    }
                </div>
            </Drawer>


        </div>
    );
};


export default withErrorBoundary(withSuspense(SidePanel, <div> Loading ... </div>), <div> Error Occur </div>);
