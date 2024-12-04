import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Collapse, Modal, message, Upload, Empty, Card, Table, Badge, Form, Select, TreeSelect } from 'antd';
import { IoDocumentAttachOutline } from "react-icons/io5";
import type { CollapseProps, UploadFile, UploadProps, TableColumnsType } from 'antd';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import * as constant from '@src/utils/constant';
import dayjs from '@src/utils/dayjsGlobal';
import { IoSettingsOutline, IoReload } from "react-icons/io5";
import { useGlobalContext } from '@src/provider/global';
import * as config from '@src/config';
import { IoAdd, IoClose } from "react-icons/io5";
import { MdDeleteOutline } from "react-icons/md";
import { removeDocumentsInConnection, addFilesInConnection, buildDocsIndexInConnection, addCrawlInConnection } from '@src/utils/build'
import { t } from '@extension/i18n';

const { Search } = Input;
const { Dragger } = Upload;
const { Option } = Select;
const { SHOW_CHILD } = TreeSelect;

interface DataType {
    key: React.Key;
    name: string;
    created_at: string;
    status_text: string,
    status: DocumentStatusUnion,
    text_chunk_id_range: {
        from: number
        to: number
    }
}

const columns: TableColumnsType<DataType> = [
    {
        title: t('name'), dataIndex: 'name', ellipsis: {
            showTitle: true
        },
        render: (text, record) => {
            const chunkLen = record.text_chunk_id_range.to - record.text_chunk_id_range.from + 1;
            const isErrorChunk = chunkLen < 10 && record.status == constant.DocumentStatus.Success;
            return (
                <span className={`${isErrorChunk && 'text-[gray]'} `} title={`${isErrorChunk ? t('problem_document') : record.name}`}>{record.name}</span>
            )
        },
        width: '65%'
    },
    {
        title: t('status'), dataIndex: 'status', width: '35%', render: (text, record) => {

            const color = record.status == constant.DocumentStatus.Fail ? constant.ERROR_COLOR : record.status == constant.DocumentStatus.Success ? constant.SUCCESS_COLOR : 'gray';
            return <Badge color={color} text={record.status_text} />
        }
    },
];


interface DisplayConnection extends DB.ConnectionDocUnion {
    selectedRowKeys: React.Key[]
}
interface ResourceForm {
    name: string
    connector: ConnectorUnion
}
export interface CrawlForm {
    name: string
    link: string
}
export interface FavoriteTreeNode {
    title: string
    key: string
    value: string
    outData: {
        url: string
        label: string
        value: string
    }
    children: FavoriteTreeNode[]
    isLeaf: boolean
}
const acceptFileType = '.pdf,.doc,.docx,.txt,.md';

const Resource = () => {
    const { connectionList, setConnectionList } = useGlobalContext()

    const indexDBRef = useRef<IndexDBStore | null>(null);


    // connection relate
    const [displayConnectionList, setDisplayConnectionList] = useState<DisplayConnection[]>([]);
    const [connectionListLoading, setConnectionListLoading] = useState(false);
    const [curConnection, setCurConnection] = useState<DB.ConnectionDocUnion | null>(null);

    const [collapseActiveKey, setCollapseActiveKey] = useState<number[]>([]);

    // upload relate
    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]); // 每个resource操作上传时的,最终上传文件列表
    const [uploadLoading, setUploadLoading] = useState(false);

    //crawler relate
    const [crawlModalOpen, setCrawlModalOpen] = useState(false);
    const [crawlLoading, setCrawlLoading] = useState(false);
    const [crawlForm] = Form.useForm<{ crawlList: CrawlForm[] }>();

    //search relate
    const [searchValue, setSearchValue] = useState('');

    //delete relate
    const [delConfirmModalOpen, setDelConfirmModalOpen] = useState(false);
    const [delDocLoading, setDelDocLoading] = useState(false);

    //resource relate
    const [resourceForm] = Form.useForm<ResourceForm>();
    const [resourceScene, setResourceScene] = useState<'edit' | 'add'>('add');
    const [operateResourceLoading, setOperateResourceLoading] = useState(false);
    const [operateResourceModalOpen, setOperateResourceModalOpen] = useState(false);

    //favorite tree select
    const [selectFavoriteData, setSelectFavoriteData] = useState<(FavoriteTreeNode['outData'])[]>([]);
    const [favoriteTreeData, setFavoriteTreeData] = useState<FavoriteTreeNode[]>([]);
    const [selectFavoriteVisible, setSelectFavoriteVisible] = useState(false);

    // 判断当前的connections是否存在build中的document,存在则不允许编辑
    // 因为indexdb更新数据整体更新,没办法只更新某一个字段
    const checkHasBuildingDocInConnection = (connectionId: number) => {
        const buildDoc = connectionList.find((item) => item.id == connectionId)!.documentList.find((doc) => doc.status == constant.DocumentStatus.Building)

        if (!buildDoc) {
            return false;
        }

        // 检查构建时间是否超过一定时间,超过则认为中途出问题了,可以让用户继续操作这个connection
        const buildTime = dayjs(buildDoc.created_at)
        const nowTime = dayjs()
        const diffMinutes = nowTime.diff(buildTime, 'minute')
        return diffMinutes < config.MAX_BUILDING_MINUTES
    }

    const genExtra = (displayConnection: DisplayConnection) => {

        const hasBuildingDoc = checkHasBuildingDocInConnection(displayConnection.id!);

        return <div className='flex items-center'>
            <div className="flex items-center gap-3">
                <IoAdd size={20} title={hasBuildingDoc ? t('building_document_wait') : t('add_document')}
                    className={`${hasBuildingDoc && 'opacity-20'}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        if (hasBuildingDoc) {
                            return;
                        }
                        handleAddDocument(event, displayConnection.id!);
                    }}></IoAdd>
                <span>
                    <MdDeleteOutline className={`${(!displayConnection.selectedRowKeys.length || hasBuildingDoc) && 'opacity-20'}`} size={20} title={
                        hasBuildingDoc ? t('building_document_wait') :
                            displayConnection.selectedRowKeys.length ? t('del_batch_data') : t('select_data_first')}
                        onClick={(event) => {
                            event.stopPropagation();
                            if (!displayConnection.selectedRowKeys.length || hasBuildingDoc) {
                                return;
                            }

                            const connection = connectionList.find((item) => item.id == displayConnection.id)!;
                            setCurConnection(connection);
                            setDelConfirmModalOpen(true);
                        }}
                    ></MdDeleteOutline>
                </span>

                <IoSettingsOutline
                    className={`${hasBuildingDoc && 'opacity-20'}`}
                    title={hasBuildingDoc ? t('building_document_wait') : t('edit_resource')}
                    size={20}
                    onClick={(event) => {
                        event.stopPropagation();
                        if (hasBuildingDoc) {
                            return;
                        }
                        handleEditResource(event, displayConnection.id!);
                    }}
                />

            </div>
        </div>
    }
    const CollapseItems: CollapseProps['items'] = displayConnectionList.map((item) => {
        const documentTableList = item.documentList.map((doc) => {
            const statusText = doc.status == constant.DocumentStatus.Fail ? t('fail') : doc.status == constant.DocumentStatus.Success ? t('success') : t('building');
            return {
                key: doc.id!,
                name: doc.name,
                created_at: dayjs(doc.created_at).format('YYYY-MM-DD'),
                status: doc.status,
                status_text: statusText,
                text_chunk_id_range: doc.text_chunk_id_range
            }
        })
        return {
            key: item.id,
            extra: genExtra(item),
            label: item.name,
            children:
                <Table<DataType> pagination={
                    {
                        pageSize: 5,
                    }
                } rowSelection={{
                    selectedRowKeys: item.selectedRowKeys,
                    onChange: (selectedRowKeys) => {
                        item.selectedRowKeys = selectedRowKeys;
                        setDisplayConnectionList([...displayConnectionList]);
                    }
                }} columns={columns} dataSource={documentTableList} />
            ,
            classNames: {
                header: 'text-base !items-center',
                body: '!p-1'
            }
        }
    })

    const uploadProps: UploadProps = {
        multiple: true,
        accept: acceptFileType,
        beforeUpload: (file) => {
            return false
        },
        onChange(info) {
            // 上传文件列表变化时,记录新增和删除的文件
            setUploadFileList([...info.fileList]);
        },
    };

    const tProps = {
        treeData: favoriteTreeData,
        value: selectFavoriteData,
        onChange: (value) => {
            setSelectFavoriteData(value.map((item) => item.label));
        },
        treeNodeFilterProp: 'title',
        treeCheckable: true,
        showCheckedStrategy: SHOW_CHILD,
        labelInValue: true,
        treeNodeLabelProp: 'outData',
        placeholder: t('please_select_bookmarks'),
        style: {
            width: '100%',
        },
        maxTagCount: 5,
        // treeTitleRender: (nodeData: FavoriteTreeNode) => {
        //     const favIconUrl = `https://www.google.com/s2/favicons?domain=${nodeData.url}&size=32`
        //     return (
        //         <div className='flex items-start gap-1'>
        //             {
        //                 nodeData.url && <img src={favIconUrl} className='mt-1' alt="" />
        //             }
        //             <span>{nodeData.title}</span>
        //         </div>
        //     )
        // }
    };

    const clearOldResourceOperate = () => {
        resourceForm.resetFields();
    }
    const fetchConnectionList = async () => {
        setConnectionListLoading(true);

        const store = indexDBRef.current!;
        await store.connect(constant.DEFAULT_INDEXDB_NAME);
        const connections = await store.getAll({
            storeName: constant.CONNECTION_STORE_NAME,
        }) as DB.CONNECTION[];
        // 根据connection获取document列表
        const connectionList: DB.ConnectionDocUnion[] = await Promise.all(connections.map(async (connection) => {
            const documents = await store.getBatch({
                storeName: constant.DOCUMENT_STORE_NAME,
                keys: connection.documents.map((doc) => doc.id!)
            }) as DB.DOCUMENT[];
            return { ...connection, documentList: documents }
        })
        )

        setConnectionList(connectionList);
        setTimeout(() => {
            setConnectionListLoading(false);
        }, 1000)
    }
    const getSearchedData = (value: string, connectionList: DB.ConnectionDocUnion[]) => {
        if (!value) {
            return {
                disPlayConnectionList: connectionList.map((item) => ({ ...item, selectedRowKeys: [], })),
                collapseActiveKey: connectionList.map(item => item.id)
            }
        }
        const disPlayConnectionList = connectionList.map((connection) => {
            const newConnection = { ...connection, selectedRowKeys: [], };
            newConnection.documentList = connection.documentList.filter((doc) => doc.name.includes(value));
            return newConnection;
        }).filter((connection) => connection.documentList.length);
        const collapseActiveKey = disPlayConnectionList.length ? disPlayConnectionList.map(item => item.id!) : [];
        return { disPlayConnectionList, collapseActiveKey };
    }
    const checkHasBuildingDoc = () => {
        return connectionList.some((connection) => connection.documentList.some((doc) => doc.status == constant.DocumentStatus.Building))
    }
    const getPureConnection = (connection: DB.ConnectionDocUnion): DB.CONNECTION => {
        return {
            id: connection.id!,
            name: connection.name,
            connector: connection.connector,
            lsh_index_ids: connection.lsh_index_ids,
            full_text_index_ids: connection.full_text_index_ids,
            documents: connection.documents
        }
    }



    const handleCollapseChange = (key: string[]) => {
        setCollapseActiveKey(key.map((item) => Number(item)));
    }


    // 根据搜索值过滤connection的document列表
    const handleSearch = (value: string) => {
        const { disPlayConnectionList, collapseActiveKey } = getSearchedData(value, connectionList);
        setDisplayConnectionList(disPlayConnectionList);
        setCollapseActiveKey(collapseActiveKey as number[]);
    }

    // document add/del
    const handleDocDelConfirm = async (event) => {
        const hasBuildDoc = checkHasBuildingDocInConnection(curConnection!.id!);
        if (hasBuildDoc) {
            message.warning(t('wait_document_build_warning'));
            return;
        }

        setDelDocLoading(true);
        try {
            const store = indexDBRef.current!;
            const delDocIds = displayConnectionList.find((item) => item.id == curConnection!.id)!.selectedRowKeys as number[];
            const removeDocList = curConnection!.documentList.filter((doc) => delDocIds.includes(doc.id!));

            await removeDocumentsInConnection(store, removeDocList, getPureConnection(curConnection!));

            await fetchConnectionList();

            message.success(t('delete_success'));
        } catch (error) {
            console.error('handleDocDelConfirm error', error)
            message.error('Delete Error' + error);
        }

        setDelConfirmModalOpen(false);
        setDelDocLoading(false);
    }
    const handleAddDocument = async (event, connectionId: number) => {
        // 判断当前的connections是否存在build中的document,存在则不允许编辑
        // 因为indexdb更新数据整体更新,没办法只更新某一个字段
        const hasBuildDoc = checkHasBuildingDocInConnection(connectionId);
        if (hasBuildDoc) {
            message.warning(t('wait_document_build_warning'));
            return;
        }

        const connection = connectionList.find((item) => item.id == connectionId)!;

        const connector = connection.connector;
        if (connector == constant.Connector.Crawl) {
            setCrawlModalOpen(true);
            setSelectFavoriteVisible(false);
            crawlForm.resetFields();
            crawlForm.setFieldsValue({ crawlList: [{ name: '', link: '' }] });
        } else if (connector == constant.Connector.File) {
            setUploadModalOpen(true);
            setUploadFileList([]);
        } else {
            message.error('connector error');
            throw new Error('connector error')
        }

        setCurConnection(connection)
    }
    const handleUploadConfirm = async () => {
        if (!uploadFileList.length) {
            message.warning(t('please_select_file'));
            return;
        }
        setUploadLoading(true);

        try {
            const store = indexDBRef.current!;

            const fileList = uploadFileList.map((file) => file.originFileObj!);
            const { docs, connectionAfterAddDoc } = await addFilesInConnection(store, fileList, getPureConnection(curConnection!));

            buildDocsIndexInConnection(store, docs, connectionAfterAddDoc).then(() => {
                fetchConnectionList();
            }).catch((error) => {
                fetchConnectionList();
                throw error;
            });

            // 更新页面resource列表
            await fetchConnectionList();
        } catch (error) {
            console.error('handleUploadConfirm error', error)
            message.error('Build Error' + error);
        }


        setUploadLoading(false);
        setUploadModalOpen(false);
    }
    const handleCrawlConfirm = async () => {
        const validRes = await crawlForm.validateFields()
        if (!validRes) {
            return;
        }


        setCrawlLoading(true);

        try {
            const store = indexDBRef.current!;
            const { docs, connectionAfterAddDoc } = await addCrawlInConnection(store, validRes.crawlList, getPureConnection(curConnection!));

            buildDocsIndexInConnection(store, docs, connectionAfterAddDoc).then(() => {
                fetchConnectionList();
            }).catch((error) => {
                fetchConnectionList();
                throw error;
            });

            // 更新页面resource列表
            await fetchConnectionList();
        } catch (error) {
            console.error('handleCrawlConfirm error', error)
            message.error('Crawl Error' + error);
        }

        setCrawlLoading(false);
        setCrawlModalOpen(false);
    }

    // resource add/edit
    const handleAddResource = () => {
        clearOldResourceOperate();

        setOperateResourceModalOpen(true);
        setResourceScene('add');
    }
    const handleEditResource = (event, connectionId) => {
        // 判断当前的connections是否存在build中的document,存在则不允许编辑
        // 因为indexdb更新数据整体更新,没办法只更新某一个字段
        const hasBuildDoc = checkHasBuildingDocInConnection(connectionId);
        if (hasBuildDoc) {
            message.warning(t('wait_document_build_warning'));
            return;
        }

        const connection = connectionList.find((item) => item.id == connectionId)!;

        clearOldResourceOperate();

        setCurConnection(connection);
        setOperateResourceModalOpen(true);
        setResourceScene('edit');
        resourceForm.setFieldsValue({ name: connection.name, connector: connection.connector });
    }
    const handleOperateResourceConfirm = async () => {
        const validRes = await resourceForm.validateFields()
        if (!validRes) {
            return;
        }

        setOperateResourceLoading(true);

        try {
            const store = indexDBRef.current!;
            if (resourceScene == 'add') {
                // 数据库新增
                // 新增connection
                const connectionData: DB.CONNECTION = {
                    name: validRes.name,
                    connector: validRes.connector,
                    lsh_index_ids: [],
                    full_text_index_ids: [],
                    documents: []
                }


                await store.add({
                    storeName: constant.CONNECTION_STORE_NAME,
                    data: connectionData
                })
            } else if (resourceScene == 'edit') {
                // 数据库编辑
                const newConnection: DB.ConnectionDocUnion = {
                    ...curConnection!,
                    name: validRes.name,
                }

                await store.put({
                    storeName: constant.CONNECTION_STORE_NAME,
                    data: getPureConnection(newConnection)
                })
            }

            await fetchConnectionList();
            message.success(resourceScene === 'add' ? t('add_resource_success') : t('edit_resource_success'));
        } catch (error) {
            console.error('handleOperateResourceConfirm error', error)
            message.error('Operation Error' + error);
        }

        setOperateResourceLoading(false);
        setOperateResourceModalOpen(false);
    }

    // favorite tree select
    const handleImportFavoriteClick = async () => {
        function convertBookmarksToTreeData(bookmarks: chrome.bookmarks.BookmarkTreeNode[], parentKey = '') {
            return bookmarks.map((bookmark) => {
                // 为每个节点生成一个唯一的 key 和 value
                const key = parentKey ? `${parentKey}-${bookmark.id}` : `${bookmark.id}`;
                const node: FavoriteTreeNode = {
                    title: bookmark.title,
                    key: key,
                    value: key,
                    outData: {
                        url: '',
                        label: bookmark.title,
                        value: key
                    },
                    children: [] as any[],
                    isLeaf: false,
                };

                // 如果当前书签有子节点，则递归处理
                if (bookmark.children && bookmark.children.length > 0) {
                    node.children = convertBookmarksToTreeData(bookmark.children, key);
                } else if (bookmark.url) {
                    // 如果是书签项，且有 URL，设置为叶子节点
                    node.isLeaf = true;
                    node.outData.url = bookmark.url;
                }

                return node;
            });
        }

        setSelectFavoriteVisible(true);

        const bookmarks = (await chrome.bookmarks.getTree())[0].children!

        const treeData = convertBookmarksToTreeData(bookmarks)

        setFavoriteTreeData(treeData);
    }
    const handleImportConfirm = async () => {
        const maxCrawlNum = 30;
        if (selectFavoriteData.length > 30) {
            message.warning(`${t('better_not_exceed')} ${maxCrawlNum}`);
            return;
        }
        if (selectFavoriteData.length == 0) {
            message.warning(t('please_select_bookmarks'));
            return;
        }
        const crawlList = selectFavoriteData.map((item) => {
            return {
                name: item!.label,
                link: item!.url
            }
        })

        crawlForm.setFieldsValue({ crawlList });

    }

    useEffect(() => {
        async function initIndexDB() {
            const store = new IndexDBStore();
            await store.connect(constant.DEFAULT_INDEXDB_NAME);
            indexDBRef.current = store;
        }

        initIndexDB().then(() => {
            fetchConnectionList()
        });


    }, [])

    useEffect(() => {
        if (!connectionList.length) {
            return;
        }

        const { disPlayConnectionList, collapseActiveKey } = getSearchedData(searchValue, connectionList);
        setDisplayConnectionList(disPlayConnectionList);
        setCollapseActiveKey(collapseActiveKey as number[]);
    }, [connectionList, searchValue])

    return (
        <div className='resource pt-2 flex flex-col flex-1'>
            <div className="title flex items-center justify-between border-b">
                <div className='flex items-center  gap-1 py-5'>
                    <IoDocumentAttachOutline size={25} />
                    <span className='text-lg font-bold'>{t('resource')}</span>

                </div>

                <div className="flex items-center gap-3">
                    <IoReload size={18} className={`cursor-pointer ${connectionListLoading ? 'animate-spin' : ''} `} onClick={fetchConnectionList} />
                    <Button type="primary" onClick={handleAddResource}>{t('add_resource')}</Button>
                </div>
            </div>

            <div className="search pt-5  my-1">
                <Search className='text-base' placeholder={t('search_resource_name')} onSearch={handleSearch} onChange={(e) => {
                    setSearchValue(e.target.value);
                }} enterButton size="large" />
                {
                    <div className={`text-right text-xs text-text-500 ${checkHasBuildingDoc() ? 'visible' : 'invisible'}`}>{t('document_building_tip')}</div>
                }
            </div>


            <div className="resource-list flex-1 flex flex-col overflow-y-auto">

                {
                    !displayConnectionList.length ? <div className='flex flex-1 flex-col justify-center'> <Empty /></div> : <Collapse
                        activeKey={collapseActiveKey}
                        onChange={handleCollapseChange}
                        expandIconPosition='start'
                        items={CollapseItems}
                    />
                }
            </div>

            {/* File add */}
            <Modal confirmLoading={uploadLoading} cancelButtonProps={{ loading: uploadLoading }} maskClosable={false} centered title={t('import_file')} open={uploadModalOpen} onOk={handleUploadConfirm} onCancel={() => { setUploadModalOpen(false) }}>

                <Dragger  {...uploadProps} fileList={uploadFileList} >
                    <p className="ant-upload-text">{t('click_drag_file_tip')}</p>
                    <p className="ant-upload-hint">
                        {t('operation_data_safe_tip')}
                    </p>
                    <p className="ant-upload-hint">
                        {acceptFileType}
                    </p>
                </Dragger>
            </Modal>

            {/* resource add/edit */}
            <Modal confirmLoading={operateResourceLoading} cancelButtonProps={{ loading: operateResourceLoading }} maskClosable={false} centered title={resourceScene == 'add' ? t('add_resource') : t('edit_resource')} open={operateResourceModalOpen} onOk={handleOperateResourceConfirm} onCancel={() => { setOperateResourceModalOpen(false) }}>
                <Form
                    form={resourceForm}
                    name="resource"
                    layout="vertical"
                >
                    <Form.Item label={t('resource_name')} name="name" rules={[{ required: true }]}>
                        <Input placeholder={t('resource_name_placeholder')} />
                    </Form.Item>
                    <Form.Item
                        layout="vertical"
                        label={t('resource_type')}
                        name="connector"
                        rules={[{ required: true }]}
                    >
                        <Select disabled={resourceScene === 'edit'} placeholder={t('please_select_resource_type')}>
                            <Option value={1}>{t('file')}</Option>
                            <Option value={2}>{t('web_crawl')}</Option>
                        </Select>
                    </Form.Item>
                </Form>
            </Modal>

            {/* crawl add/edit */}
            <Modal confirmLoading={crawlLoading} cancelButtonProps={{ loading: crawlLoading }} maskClosable={false} centered title='Add Web Crawl' open={crawlModalOpen} onOk={handleCrawlConfirm} onCancel={() => { setCrawlModalOpen(false) }}>
                {
                    selectFavoriteVisible ?
                        <div className='mb-2 flex flex-col gap-2'>

                            <TreeSelect {...tProps} />

                            <div className='flex items-center gap-1 justify-end'>
                                <Button type='primary' size='small' onClick={handleImportConfirm}>{t('import')}</Button>
                                <Button size='small' onClick={() => { setSelectFavoriteVisible(false) }}>{t('cancel')}</Button>
                            </div>
                        </div> :
                        <div className='text-right text-sm text-blue-500 cursor-pointer mb-2' onClick={handleImportFavoriteClick}>{t('import_your_browser_bookmark')}?</div>
                }
                <Form
                    form={crawlForm}
                    name="crawl form"
                    initialValues={{ crawlList: [{}] }}
                    labelCol={{ span: 4 }}
                >
                    <Form.List name="crawlList">
                        {(fields, { add, remove }) => (
                            <div style={{ display: 'flex', rowGap: 16, flexDirection: 'column' }} className='max-h-[50vh] overflow-y-auto pb-2'>
                                {
                                    fields.map((field) => (

                                        <Card
                                            size="small"
                                            title={`Crawl ${field.name + 1}`}
                                            key={field.key}
                                            extra={
                                                <IoClose className='cursor-pointer' onClick={() => {
                                                    remove(field.name);
                                                }} />
                                            }
                                        >
                                            <Form.Item label={t('name')} name={[field.name, 'name']} rules={[{ required: true }]}>
                                                <Input placeholder={t('web_name_placeholder')} />
                                            </Form.Item>
                                            <Form.Item
                                                label={t('web_url')}
                                                name={[field.name, 'link']}
                                                rules={[{ required: true }, { type: 'url' }]}
                                            >
                                                <Input placeholder={t('web_url_placeholder')} />
                                            </Form.Item>

                                        </Card>

                                    ))
                                }

                                < Button type="dashed" onClick={() => add()} block>+ {t('add_crawl')}</Button>
                            </div>
                        )}
                    </Form.List>
                </Form>
            </Modal>

            {/* del Modal */}
            <Modal
                title="Delete Confirm"
                centered
                open={delConfirmModalOpen}
                confirmLoading={delDocLoading} cancelButtonProps={{ loading: delDocLoading }}
                onOk={handleDocDelConfirm}
                onCancel={() => { setDelConfirmModalOpen(false) }}

            >
                <p>{t('delete_confirm')}?</p>

            </Modal>
        </div >
    );
}

export default Resource;