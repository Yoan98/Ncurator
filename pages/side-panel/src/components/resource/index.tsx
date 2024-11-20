import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Collapse, Modal, message, Upload, Empty, Tooltip, Popconfirm } from 'antd';
import { IoDocumentAttachOutline } from "react-icons/io5";
import type { CollapseProps, UploadFile, UploadProps } from 'antd';
import { formatFileSize } from '@src/utils/tool';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import * as constant from '@src/utils/constant';
import dayjs from 'dayjs';
//@ts-ignore
import storageWorkerURL from '@src/worker-pool/buildIndex?url&worker';
import type { Pool } from 'workerpool';
import workerpool from 'workerpool';
import { FileConnector } from '@src/utils/Connector';
import { IoSettingsOutline, IoReload } from "react-icons/io5";
import { useGlobalContext } from '@src/provider/global';

const { Search } = Input;
const { Dragger } = Upload;


const DocumentItem = ({ data, onDeleteClick }: {
    data: {
        name: string,
        size: string,
        created_at: string,
        status: DocumentStatusUnion,
        delLoading?: boolean
    },
    onDeleteClick: () => void
}) => {
    const statusText = data.status == constant.DocumentStatus.Fail ? 'Fail' : data.status == constant.DocumentStatus.Success ? 'Success' : 'Building...';
    const statusClass = data.status == constant.DocumentStatus.Fail ? 'text-text-error' : data.status == constant.DocumentStatus.Success ? 'text-text-success' : '';
    return (
        <div className='flex gap-2 text-center items-center'>
            <Tooltip placement="top" title={data.name} >
                <div className='truncate cursor-pointer font-bold w-[60%]'>{data.name}</div>
            </Tooltip>
            <Tooltip placement="top" title={`Create Time: ${data.created_at}`}>
                <div className='text-text-500 cursor-pointer w-1/4'>{data.size}</div>
            </Tooltip>
            <Popconfirm
                title="Delete the document"
                description="Are you sure to delete this document?"
                onConfirm={onDeleteClick}
                okText="Yes"
                cancelText="No"
                placement='bottom'
            >
                <Tooltip placement="top" title='Click to delete' >
                    <Button loading={data.delLoading} type="text" className={`${statusClass}`} >
                        {statusText}
                    </Button>
                </Tooltip>
            </Popconfirm>
        </div>
    )
}


const Resource = () => {
    const { connectionList, setConnectionList } = useGlobalContext()

    const storagePoolRef = useRef<Pool>();

    const addedFileListRef = useRef<UploadFile[]>([]);
    const removedFileListRef = useRef<UploadFile[]>([]);

    const [displayConnectionList, setDisplayConnectionList] = useState<DB.ConnectionDocUnion[]>([]);
    const [connectionListLoading, setConnectionListLoading] = useState(false);
    const [collapseActiveKey, setCollapseActiveKey] = useState<number[]>([]);

    const [resourceName, setResourceName] = useState('');
    const [curConnection, setCurConnection] = useState<DB.ConnectionDocUnion | null>(null);

    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [uploadScene, setUploadScene] = useState<'edit' | 'add'>('add');
    const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]); // 每个resource操作上传时的,最终上传文件列表
    const [uploadLoading, setUploadLoading] = useState(false);

    const [searchValue, setSearchValue] = useState('');

    const genExtra = (connectionId, count) => (

        <div className='flex items-center gap-2'>
            <div className='text-sm'>Count: {count}</div>
            <IoSettingsOutline
                title='Setting file'
                size={20}
                onClick={(event) => {
                    handleEditResource(event, connectionId);
                }}
            />
        </div>
    );
    const CollapseItems: CollapseProps['items'] = displayConnectionList.map((item) => {
        return {
            key: item.id,
            extra: genExtra(item.id, item.documentList.length),
            label: item.name,
            children: item.documentList.map((doc) => {
                const size = formatFileSize(doc.resource!);
                const created_at = dayjs(doc.created_at).format('YYYY-MM-DD');
                return <DocumentItem key={doc.id} data={{ name: doc.name, size, created_at, status: doc.status }} onDeleteClick={() => { handleDocDelClick(item.id!, doc.id!) }} />
            }),
            classNames: {
                header: 'text-base !items-center'
            }
        }
    })

    const uploadProps: UploadProps = {
        multiple: true,
        accept: '.pdf,.doc,.docx,.txt,.md',
        beforeUpload: (file) => {
            return false
        },
        onChange(info) {
            // 上传文件列表变化时,记录新增和删除的文件
            if (info.file.status === 'removed') {
                // 根据删除的文件id是否可转成nubmer,判断是否是存在数据库的文件
                if (!isNaN(Number(info.file.uid))) {
                    removedFileListRef.current.push(info.file);
                } else {
                    // 不存在,则这次手动操作的是新增的文件,需要删除掉,避免最终添加到数据库
                    addedFileListRef.current = addedFileListRef.current.filter((item) => item.uid != info.file.uid);
                }
            } else {
                // 每次手动添加的,都理解为是需要添加到数据库的文件
                // 由于beforeUpload返回false,所以无法用status为done来判断是否上传成功,且会没有originFileObj,但fileList中有
                // 所以为了保持类型一致,从fileList取一遍
                // 所以除了删除的文件,其他的都是手动添加的文件
                const addFile = info.fileList.find((file) => file.uid == info.file.uid)!;
                addedFileListRef.current.push(addFile);
            }

            setUploadFileList([...info.fileList]);
        },
    };

    const clearOldResourceOperate = () => {
        setResourceName('');
        setUploadFileList([]);
        addedFileListRef.current = [];
        removedFileListRef.current = [];

    }
    const fetchConnectionList = async () => {
        setConnectionListLoading(true);

        const store = new IndexDBStore();
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
                disPlayConnectionList: [...connectionList],
                collapseActiveKey: connectionList.map(item => item.id)
            }
        }
        const disPlayConnectionList = connectionList.map((connection) => {
            const newConnection = { ...connection };
            newConnection.documentList = connection.documentList.filter((doc) => doc.name.includes(value));
            return newConnection;
        }).filter((connection) => connection.documentList.length);
        const collapseActiveKey = disPlayConnectionList.length ? disPlayConnectionList.map(item => item.id!) : [];
        return { disPlayConnectionList, collapseActiveKey };
    }
    const checkHasBuildingDoc = () => {
        return connectionList.some((connection) => connection.documentList.some((doc) => doc.status == constant.DocumentStatus.Building))
    }

    // 删除某一个connection下的文档数据
    const removeDocumentsInConnection = async (store: IndexDBStore, removeDocList: DB.DOCUMENT[], connection: DB.CONNECTION) => {
        if (!removeDocList.length) { return { connectionAfterDel: connection } }

        // 删除document的索引id
        let delLshIndexIds: number[] = []
        let delFullTextIndexIds: number[] = []
        removeDocList.forEach((doc) => {
            delLshIndexIds = delLshIndexIds.concat(doc.lsh_index_ids);
            delFullTextIndexIds = delFullTextIndexIds.concat(doc.full_text_index_ids);
        })

        // 删除connection中的document
        const newConnection: DB.CONNECTION = {
            ...connection,
            id: connection.id!,
            documents: connection.documents.filter((oldDoc) => !removeDocList.some((doc) => oldDoc.id == doc.id)),
            lsh_index_ids: connection.lsh_index_ids.filter((id) => !delLshIndexIds.includes(id)),
            full_text_index_ids: connection.full_text_index_ids.filter((id) => !delFullTextIndexIds.includes(id))
        }
        await store.put({
            storeName: constant.CONNECTION_STORE_NAME,
            data: newConnection,
        });
        // 删除document
        await store.deleteBatch({
            storeName: constant.DOCUMENT_STORE_NAME,
            keys: removeDocList.map((doc) => doc.id!)
        });
        // 删除索引
        if (delLshIndexIds.length) {
            // 删除document的索引
            await store.deleteBatch({
                storeName: constant.LSH_INDEX_STORE_NAME,
                keys: delLshIndexIds
            });
        }
        if (delFullTextIndexIds.length) {
            // 删除document的索引
            await store.deleteBatch({
                storeName: constant.FULL_TEXT_INDEX_STORE_NAME,
                keys: delFullTextIndexIds
            });
        }
        // 删除text chunk

        for (let doc of removeDocList) {
            const range = IDBKeyRange.bound(doc.text_chunk_id_range.from, doc.text_chunk_id_range.to);
            await store.delete({
                storeName: constant.TEXT_CHUNK_STORE_NAME,
                key: range
            });
        }

        return {
            connectionAfterDel: newConnection
        }
    }
    // 构建某一个connection下的新文档的索引
    const buildDocsIndexInConnection = async (store: IndexDBStore, docs: DB.DOCUMENT[], connection: DB.CONNECTION) => {
        const fileConnector = new FileConnector();

        let updatedConnection = connection;
        for (let doc of docs) {
            const { bigChunks, miniChunks } = await fileConnector.getChunks(doc.resource!);

            if (!bigChunks.length && !miniChunks.length) {
                message.warning(`${doc.name} no content`);
                // 将该document状态置为fail
                await store.put({
                    storeName: constant.DOCUMENT_STORE_NAME,
                    data: {
                        ...doc,
                        status: constant.DocumentStatus.Fail
                    }
                });
                continue;
            }

            // 向量化,并存储索引
            const buildDocIndexRes = await storagePoolRef.current?.exec('buildDocIndex', [{ bigChunks, miniChunks, document: doc, connection: updatedConnection }]) as Storage.DocItemRes

            // 提示结果
            if (buildDocIndexRes.status == 'Success') {
                message.success(`${doc.name} Storage Success`);
                updatedConnection = buildDocIndexRes.connectionAfterIndexBuild!;
            } else if (buildDocIndexRes.status == 'Fail') {
                console.error('buildDocIndex error', buildDocIndexRes.error)
                message.error(`${doc.name} Storage Fail`);
            } else {
                message.error(`${doc.name} Unknown Status`);
            }
        }

        storagePoolRef.current?.terminate();

        fetchConnectionList();

    }
    // 新增某一个connection下文档数据到数据库
    const addDocumentsInConnection = async (store: IndexDBStore, addFileList: File[], connection: DB.CONNECTION) => {
        // 遍历文件,存储文档
        const docList = addFileList.map((file) => {
            // 存储最基础的document
            let document: DB.DOCUMENT = {
                name: file.name,
                text_chunk_id_range: {
                    from: 0,
                    to: 0
                },
                lsh_index_ids: [],
                full_text_index_ids: [],
                resource: file,
                created_at: new Date(),
                status: constant.DocumentStatus.Building,
                connection: {
                    id: connection.id!,
                    name: connection.name
                }
            }
            return document;
        })
        const addDocRes = await store.addBatch({
            storeName: constant.DOCUMENT_STORE_NAME,
            data: docList
        });
        let newConnection = {
            ...connection,
            documents: connection.documents.concat(addDocRes.map((doc) => ({ id: doc.id!, name: doc.name }))
            )
        }
        // 将document数据添加到connection表
        await store.put({
            storeName: constant.CONNECTION_STORE_NAME,
            data: newConnection,
        });

        return { docs: addDocRes, connectionAfterAdd: newConnection };
    }

    const handleCollapseChange = (key: string[]) => {
        setCollapseActiveKey(key.map((item) => Number(item)));
    }
    const handleUploadConfirm = async () => {
        if (!resourceName) {
            message.warning('Please input resource name');
            return;
        }
        setUploadLoading(true);

        try {
            // 获取file connection数据
            const store = new IndexDBStore();
            await store.connect(constant.DEFAULT_INDEXDB_NAME);

            if (uploadScene == 'add') {
                // 新增connection
                const connectionData: DB.CONNECTION = {
                    name: resourceName,
                    connector: constant.Connector.File,
                    lsh_index_ids: [],
                    full_text_index_ids: [],
                    documents: []
                }
                const connectionId = await store.add({
                    storeName: constant.CONNECTION_STORE_NAME,
                    data: connectionData
                })
                connectionData.id = connectionId;

                const fileList = uploadFileList.map((file) => file.originFileObj!);

                const { docs, connectionAfterAdd } = await addDocumentsInConnection(store, fileList, connectionData);
                // 单独worker构建文档索引
                buildDocsIndexInConnection(store, docs, connectionAfterAdd);

            } else {
                // 编辑connection
                const pureConnection: DB.CONNECTION & { documentList?: DB.DOCUMENT[] } = { ...curConnection!, name: resourceName };
                delete pureConnection.documentList;

                let newConnection = pureConnection;

                // 更新connection名称
                await store.put({
                    storeName: constant.CONNECTION_STORE_NAME,
                    data: newConnection
                });

                // 删除文档
                const removeFileList = removedFileListRef.current;
                if (removeFileList.length) {
                    const connectionDocList = curConnection!.documentList;
                    const removeDocList = connectionDocList.filter((doc) => removeFileList.some((file) => file.uid == doc.id!.toString()));

                    const removeRes = await removeDocumentsInConnection(store, removeDocList, pureConnection!);
                    newConnection = removeRes.connectionAfterDel;
                }

                // 新增文档
                const addedFileList = addedFileListRef.current;
                if (addedFileList.length) {
                    const fileList = addedFileList.map((file) => file.originFileObj!);

                    const { docs, connectionAfterAdd } = await addDocumentsInConnection(store, fileList, newConnection);
                    newConnection = connectionAfterAdd;

                    // 单独worker构建文档索引
                    buildDocsIndexInConnection(store, docs, connectionAfterAdd);
                }

            }

            // 更新页面resource列表
            await fetchConnectionList();

            message.success('Operation Success');

        } catch (error) {
            console.error('handleUploadConfirm error', error)
            message.error('Unknown Error');
        }

        setUploadLoading(false);
        setUploadModalOpen(false);
    }
    // 根据搜索值过滤connection的document列表
    const handleSearch = (value: string) => {
        const { disPlayConnectionList, collapseActiveKey } = getSearchedData(value, connectionList);
        setDisplayConnectionList(disPlayConnectionList);
        setCollapseActiveKey(collapseActiveKey as number[]);
    }
    const handleAddResource = () => {
        clearOldResourceOperate();

        setUploadModalOpen(true);
        setUploadScene('add');
    }
    const handleDocDelClick = async (connectionId: number, docId: number) => {
        // 设置connection的document状态为删除中
        const newConnectionList = connectionList.map((connection) => {
            if (connection.id == connectionId) {
                connection.documentList = connection.documentList.map((doc) => {
                    if (doc.id == docId) {
                        return { ...doc, delLoading: true }
                    }
                    return doc;
                })
            }
            return connection;
        }
        )
        setConnectionList(newConnectionList);


        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);

        const document = await store.get({
            storeName: constant.DOCUMENT_STORE_NAME,
            key: docId
        }) as DB.DOCUMENT;
        // 判断文档的创建时间,当状态为building时,只有超过半小时才能删除
        if (document.status == constant.DocumentStatus.Building) {
            const now = dayjs();
            const created_at = dayjs(document.created_at);
            const diff = now.diff(created_at, 'minute');
            if (diff < 30) {
                message.warning(`The document is building in ${diff} minutes, only after 30 minutes can be deleted`);
                return;
            }
        }

        const connection = await store.get({
            storeName: constant.CONNECTION_STORE_NAME,
            key: connectionId
        }) as DB.CONNECTION;


        await removeDocumentsInConnection(store, [document], connection);

        await fetchConnectionList();

        message.success('Delete success');
    }
    const handleEditResource = (event, connectionId) => {
        event.stopPropagation();

        // 判断当前的connections是否存在build中的document,存在则不允许编辑
        const connection = connectionList.find((item) => item.id == connectionId)!;
        const hasBuildDoc = connection.documentList.some((doc) => doc.status == constant.DocumentStatus.Building);
        if (hasBuildDoc) {
            message.warning('Please wait for the document to build, or hover over the document status to delete');
            return;
        }

        clearOldResourceOperate();

        setCurConnection(connection);
        setUploadModalOpen(true);
        setUploadScene('edit');
        setResourceName(connection.name);

        const uploadFileList = connection.documentList.map((doc) => {
            return {
                uid: doc.id!.toString(),
                name: doc.name,
                originFileObj: doc.resource as UploadFile['originFileObj'],
            }
        }
        )
        setUploadFileList(uploadFileList);
    }

    useEffect(() => {
        fetchConnectionList();

        storagePoolRef.current = workerpool.pool(storageWorkerURL, {
            maxWorkers: 1,
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
                    <span className='text-lg font-bold'>Resource</span>

                </div>

                <div className="flex items-center gap-3">
                    <IoReload size={18} className={`cursor-pointer ${connectionListLoading ? 'animate-spin' : ''} `} onClick={fetchConnectionList} />
                    <Button type="primary" onClick={handleAddResource}>Add Resource</Button>
                </div>
            </div>

            <div className="search pt-5  my-1">
                <Search className='text-base' placeholder="Search file name..." onSearch={handleSearch} onChange={(e) => {
                    setSearchValue(e.target.value);
                }} enterButton size="large" />
                {
                    <div className={`text-right text-xs text-text-500 ${checkHasBuildingDoc() ? 'visible' : 'invisible'}`}>Document is building, please don't close App before finish</div>
                }
            </div>


            <div className="resource-list flex-1 flex flex-col overflow-y-auto">

                {
                    !displayConnectionList.length ? <div className='flex flex-1 flex-col justify-center'> <Empty description='No resource yet' /></div> : <Collapse
                        activeKey={collapseActiveKey}
                        onChange={handleCollapseChange}
                        expandIconPosition='start'
                        items={CollapseItems}
                    />
                }
            </div>

            <Modal confirmLoading={uploadLoading} cancelButtonProps={{ loading: uploadLoading }} maskClosable={false} centered title={uploadScene == 'add' ? 'Add Resource' : 'Edit Resource'} open={uploadModalOpen} onOk={handleUploadConfirm} onCancel={() => { setUploadModalOpen(false) }}>
                <div>
                    Resource Name
                </div>


                <Input placeholder='A descriptive name for the resource.' className='my-2' value={resourceName} onChange={(e) => {
                    setResourceName(e.target.value);
                }} />

                <Dragger  {...uploadProps} fileList={uploadFileList} >
                    <p className="ant-upload-text">Click or drag file to this area</p>
                    <p className="ant-upload-hint">
                        All the data will be storage in your local database
                    </p>
                </Dragger>
            </Modal>
        </div>
    );
}

export default Resource;