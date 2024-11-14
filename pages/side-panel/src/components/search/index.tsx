import { useState, useEffect } from 'react';
import { Input } from 'antd';
import type { MenuProps } from 'antd';
import { Dropdown, Button } from 'antd';
import { IoIosArrowDown } from "react-icons/io";
import { IoDocumentAttachOutline } from "react-icons/io5";

const { TextArea } = Input;

const sourceItems: MenuProps['items'] = [
    {
        key: '1',
        label: 'Document',
    },
    {
        key: '2',
        label: 'LLM Model',
    }
]

const SearchSection = () => {
    const [inputValue, setInputValue] = useState('');

    useEffect(() => {
        // 从indexDB中获取connection数据
    }, []);

    return (<div className='search-section'>
        <div className="input bg-background-100 flex   flex-col   border   border-border-medium rounded-lg p-1">
            <TextArea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Input what you want to search..."
                autoSize={{ minRows: 2 }}
                variant='borderless'
                className='text-base'
            />

            <div className="input-filter flex items-center justify-between  pr-2 pl-1 py-2">
                <Dropdown menu={{ items: sourceItems }} placement="bottomLeft">
                    <div className='flex gap-1 items-center cursor-pointer'>
                        <Button type="text" icon={<IoIosArrowDown />} iconPosition='end' size="small">
                            Resource
                        </Button>

                    </div>
                </Dropdown>


                <Button type="primary" shape='circle' size="small" className='hover:scale-110 transition-transform'>Go</Button>
            </div>
        </div>

        <div className="ai-answer my-4 p-4 border-2 border-border rounded-lg relative">
            <div className="flex gap-x-2">
                <h2 className="text-emphasis font-bold my-auto mb-1 text-base">AI Answer</h2>
            </div>

            <div className="pt-1 h-auto border-t border-border w-full min-h-[100px]">
                <div className='text-sm loading-text'>Searching...</div>
            </div>
        </div>

        <div className="result">
            <div className="font-bold flex justify-between text-emphasis border-b mb-3 pb-1 border-border text-lg"><p>Results</p></div>
            <div className="res-list">

                <div className="text-sm mobile:ml-4 border-b border-border transition-all duration-500 pt-3 relative" >
                    <div className="absolute top-6 overflow-y-auto -translate-y-2/4 flex -left-10 w-10"></div>
                    <div className="collapsible ">
                        <div className="flex relative items-center gap-1 cursor-pointer">
                            <IoDocumentAttachOutline size={20} />
                            <p className="truncate text-wrap break-all my-auto line-clamp-1 text-base max-w-full font-bold text-blue-500">工作相关简历</p>
                        </div>
                        <div className='pl-1 pt-2 pb-3'>
                            <p className="text-text-500 line-clamp-4" > 具有很强的沟通能力；之前曾担任前端团队负责人，并成功带领团队完成了多个项目。 具备产品思维；独立开发过一款产品，从需求收集、原型设计到开发及上线全程负责。 学习能力强并且充满热情，包括学习神经网络、Web3合约开发、计算机图形学以及相关的数学概念。 相关经验,上家公司的产品虽然不完全是ERP系统,但基本靠近,比如拥有BOM材料反算系统。 具备英语听说读写能力(在工作与技术方面) 感谢您考虑我的申请并花时间阅读。 黄缘 +86 13872198522 xiaoyuan9816
                            </p>

                        </div>
                    </div>
                </div>


            </div>
        </div>
    </div>);
}


export default SearchSection;