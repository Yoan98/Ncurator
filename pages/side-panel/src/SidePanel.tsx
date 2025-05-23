import { withErrorBoundary, withSuspense } from '@extension/shared';
import { Button, Dropdown, MenuProps, Drawer, Tooltip, Modal, notification, Select, Empty, message } from 'antd';

import { useState, useEffect, useRef } from 'react';
import { FiSidebar } from "react-icons/fi";
import { RiRobot2Line } from "react-icons/ri";
import { IoDocumentAttachOutline } from "react-icons/io5";
import { FaRocketchat } from "react-icons/fa";
import { CiSearch } from "react-icons/ci";
import SearchSection from '@src/components/search/index';
import ChatSection from '@src/components/chat/index';
import Resource from '@src/components/resource/index';
import LlmSetup from '@src/components/llmSetup/index';
import EmbeddingSetup from '@src/components/embeddingSetup';
import { IoIosArrowRoundBack } from "react-icons/io";
import { IoIosHelpCircleOutline } from "react-icons/io";
import { MdAlternateEmail } from "react-icons/md";
import { useGlobalContext } from '@src/provider/global';
import dayjs from '@src/utils/dayjsGlobal';
import { t } from '@extension/i18n';
import { EN_HELP_DOC_URL, ZH_HELP_DOC_URL } from '@src/config';
import { SlVector } from "react-icons/sl";
import { TbFileImport } from "react-icons/tb";
import { Connector } from '@src/utils/constant'
import { IndexDBStore } from '@src/utils/IndexDBStore';
import { DEFAULT_INDEXDB_NAME } from '@src/utils/constant';
import { buildDocsIndexInConnection, addCrawlInConnection, getConnectionList, getPureConnection } from '@src/utils/build'
import { FiEdit3 } from "react-icons/fi";
import { getActiveTabInfo } from '@src/utils/tool'

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
  },
  {
    key: 5,
    label: t('advance_set'),
    icon: <SlVector size={18} />,
  },
  {
    key: 3,
    label: t('help'),
    icon: <IoIosHelpCircleOutline size={18} />,
  },
  {
    key: 4,
    label: t('author') + ' Yoan',
    icon: <MdAlternateEmail size={18} />,
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
          {t('searchTab')}
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
          {t('chatTab')}
        </div>
      </button>
    </div>
  );
};


const SidePanel = () => {
  const { pagePath, setPagePath, initLlmEngine, setDefaultEmbeddingModelId, connectionList, setConnectionList } = useGlobalContext()

  const curTabInfo = useRef<CurTabPageInfo>({ title: '', url: '', tabId: undefined, rawHtml: '' });
  const indexDBRef = useRef<IndexDBStore | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTitle, setHistoryTitle] = useState<string>('');

  const [activeTab, setActiveTab] = useState<Tab>('chat');

  const [groupedChatHistory, setGroupedChatHistory] = useState<GroupedChatHistory[]>([]);
  const [curChatHistoryId, setCurChatHistoryId] = useState<number>(1);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const [curSelectedConnectionId, setCurSelectedConnectionId] = useState<number | undefined>(undefined);
  const webCrawlConnectionSelectList = connectionList.filter((item) => item.connector === Connector.Crawl).map(item => {
    return {
      value: item.id,
      label: item.name
    }
  })

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
    } else if (key == 3) {
      //打开tab页
      const lang = navigator.language || 'en';
      const helpDocUrl = lang.startsWith('zh') ? ZH_HELP_DOC_URL : EN_HELP_DOC_URL;
      window.open(helpDocUrl)
    } else if (key == 4) {
      notification.open({
        message: t('contact_author'),
        description:
          'Email: xiaoyuan9816@gmail.com',
      });
    } else if (key == 5) {
      setPagePath('/embedding-set');
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
    const maxHistoryId = localChatHistory.reduce((acc, item) => {
      return Math.max(acc, item.historyId);
    }, 0);
    const newChatHistoryId = maxHistoryId + 1;

    setCurChatHistoryId(newChatHistoryId);
    setHistoryOpen(false);
  }

  //* 导入当前网页为知识库
  const handleImportWebpageClick = () => {
    getActiveTabInfo().then((tabInfo: CurTabPageInfo) => {
      curTabInfo.current = tabInfo;
      setIsImportModalOpen(true);
    }
    ).catch((err) => {
      console.error(err)
      message.error('Get Active Tab Info Error -> ' + err);
    })
  }
  const handleImportModalConfirm = async () => {
    if (!curSelectedConnectionId) {
      message.error('Please select a resource to import');
      return;
    }
    if (!curTabInfo.current.tabId) {
      message.error('Not Found Active Tab ID');
      return
    }
    if (!curTabInfo.current.rawHtml) {
      message.error('Not Found Html');
      return
    }

    message.success(t('crawling'))
    setIsImportModalOpen(false)

    // 构建与存入数据库
    try {
      const store = indexDBRef.current!;
      const curConnection = connectionList.find(item => item.id === curSelectedConnectionId)
      const { docs, connectionAfterAddDoc } = await addCrawlInConnection(store, [{
        name: curTabInfo.current.title,
        link: curTabInfo.current.url
      }], getPureConnection(curConnection!));

      const newDocs: (DB.DOCUMENT & { rawHtml?: string })[] = docs
      newDocs[0].rawHtml = curTabInfo.current.rawHtml

      await buildDocsIndexInConnection(store, newDocs, connectionAfterAddDoc)

      // 更新connection list
      const newConnectionList = await getConnectionList(store)
      setConnectionList(newConnectionList);
    } catch (error) {
      console.error('handleImportModalConfirm error', error)
      message.error('Import Error' + error);
    }

  }
  const handleImportResourceChange = (value: number) => {
    setCurSelectedConnectionId(value);
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
          return t('today');
        case 'yesterday':
          return t('yesterday');
        case 'sevenDays':
          return t('last_7_days');
        case 'earlier':
          return t('earlier');
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
    async function loadLlmModel() {
      const res = await initLlmEngine('default');
      if (res.status === 'Fail') {
        message.error(res.message);
      }
    }
    loadLlmModel();

    // 初始话chat history
    const chatLocalHistoryStr = localStorage.getItem('chatLocalHistory');
    const chatLocalHistory: Chat.LocalHistory[] = chatLocalHistoryStr ? JSON.parse(chatLocalHistoryStr) : [];

    const curChatHistoryId = chatLocalHistory[0]?.historyId || 1;
    const groupedChatHistory = groupChatHistory(chatLocalHistory);

    setCurChatHistoryId(curChatHistoryId);
    setGroupedChatHistory(groupedChatHistory);

    // 初始化默认embedding model
    const defaultEmbeddingModelId = localStorage.getItem('defaultEmbeddingModelId') || undefined;
    setDefaultEmbeddingModelId(defaultEmbeddingModelId);


    // 初始化indexDB
    async function initIndexDB() {
      const store = new IndexDBStore();
      await store.connect(DEFAULT_INDEXDB_NAME);
      indexDBRef.current = store;
    }
    initIndexDB()

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

                <div className='flex items-center gap-2'>
                  <FiSidebar cursor='pointer' size={20} onClick={() => { setHistoryOpen(true) }} />
                  <Tooltip placement="bottom" title={t('new_chat')} >
                    <span>
                      <FiEdit3 cursor='pointer' onClick={handleNewChatClick} size={18}></FiEdit3>
                    </span>
                  </Tooltip>
                </div>
                :
                <></>
              :
              <IoIosArrowRoundBack cursor='pointer' size={25} onClick={() => { setPagePath('/main') }} />
          }
        </div>
        <div className="header-right flex items-center gap-2">
          <Tooltip placement="bottom" title={t('crawl_cur_page_to_knowledge')} >
            <span>

              <TbFileImport size={20} className='cursor-pointer' onClick={handleImportWebpageClick} />
            </span>
          </Tooltip>
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

      {/* embedding setup content */}
      <div className={`embedding-setup-content flex-1 flex flex-col ${pagePath === '/embedding-set' ? 'block' : 'hidden'}`}>
        <EmbeddingSetup></EmbeddingSetup>
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
                          {history.uiMessages[0].content || t('new_chat')}
                        </div>
                      ))
                    }
                  </div>
                </div>

            ))
          }
        </div>
      </Drawer>

      <Modal
        centered
        title={t('crawl_to_resource')} open={isImportModalOpen} onOk={handleImportModalConfirm} onCancel={() => { setIsImportModalOpen(false) }}
        footer={(_, { OkBtn, CancelBtn }) => (
          !webCrawlConnectionSelectList.length ?
            <></> :
            <><CancelBtn /><OkBtn /></>

        )}
      >
        {
          !webCrawlConnectionSelectList.length ?
            <Empty description={t('not_found_crawl_knowledge')}>
              <Button type='primary' onClick={() => {
                setPagePath('/resource')
                setIsImportModalOpen(false)
              }}>{t('go_to_create')}</Button>
            </Empty>
            :
            <div>
              <div className='mb-2'>{t('cur_web_page')}: <span className='underline'>{curTabInfo.current.title}</span></div>
              <Select
                placeholder={t('select_import_knowledge')}
                style={{ minWidth: 120 }}
                onChange={handleImportResourceChange}
                options={webCrawlConnectionSelectList}
              />
            </div>
        }


      </Modal>
    </div>
  );
};


export default withErrorBoundary(withSuspense(SidePanel, <div> Loading ... </div>), <div> Error Occur </div>);
