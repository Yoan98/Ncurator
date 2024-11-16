import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Collapse, Modal, message, Upload, Empty } from 'antd';
import { IoDocumentAttachOutline } from "react-icons/io5";
import type { CollapseProps, UploadFile, UploadProps } from 'antd';
import { FiUpload } from "react-icons/fi";
import { formatFileSize } from '@src/utils/tool';
import { IndexDBStore } from '@src/utils/IndexDBStore';
import * as constant from '@src/utils/constant';
import dayjs from 'dayjs';
//@ts-ignore
import storageWorkerURL from '@src/worker-pool/storageDoc?url&worker'
import type { Pool } from 'workerpool';
import workerpool from 'workerpool';
import { FileConnector } from '@src/utils/Connector';

const { Search } = Input;
const { Dragger } = Upload;


const DocumentItem = ({ data }: {
    data: {
        name: string,
        size: string,
        created_at: string,
        status: 1 | 2 | 3
    }
}) => {
    const statusText = data.status == 2 ? 'fail' : data.status == 3 ? 'success' : 'uploading';
    const statusClass = data.status == 2 ? 'text-text-error' : data.status == 3 ? 'text-text-success' : 'text-text-500';
    return (
        <div className='grid grid-cols-4 gap-1 text-center text-text-500'>
            <span>{data.name}</span>
            <span>{data.size}</span>
            <span>{data.created_at}</span>
            <span className={`${statusClass}`}>{statusText}</span>
        </div>
    )
}



const Resource = () => {

    const storagePoolRef = useRef<Pool>();

    const [connectionList, setConnectionList] = useState<{ connection: DB.CONNECTION, documentList: DB.DOCUMENT[] }[]>([]);
    const [resourceName, setResourceName] = useState('');
    const [curConnection, setCurConnection] = useState<DB.CONNECTION | null>(null);

    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [uploadScene, setUploadScene] = useState<'edit' | 'add'>('add');
    const [fileList, setFileList] = useState<UploadFile[]>([]);

    const genExtra = () => (
        <FiUpload
            title='Upload file'
            size={20}
            onClick={(event) => {
                // If you don't want click extra trigger collapse, you can prevent this:
                event.stopPropagation();
            }}
        />
    );
    const CollapseItems: CollapseProps['items'] = connectionList.map((item) => {
        return {
            key: item.connection.id,
            extra: genExtra(),
            content: item.documentList.map((doc) => {
                const size = formatFileSize(doc.resource!);
                const created_at = dayjs(doc.created_at).format('YYYY-MM-DD');
                return <DocumentItem data={{ name: doc.name, size, created_at, status: doc.status }} />
            }),
            classNames: {
                header: 'text-base !items-center'
            }
        }
    })

    const uploadProps: UploadProps = {
        multiple: true,
        accept: '.pdf,.doc,.docx,.txt,.md',
        onChange(info) {
            setFileList([...info.fileList]);
        },
    };

    const handleCollapseChange = (key: string | string[]) => {
        console.log(key);
    }
    const fetchConnectionList = async () => {
        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);
        const connections = await store.getAll({
            storeName: constant.CONNECTION_STORE_NAME,
        }) as DB.CONNECTION[];
        // 根据connection获取document列表
        const connectionList = await Promise.all(connections.map(async (connection) => {
            const documents = await store.getBatch({
                storeName: constant.DOCUMENT_STORE_NAME,
                keys: connection.documents.map((doc) => doc.id!)
            }) as DB.DOCUMENT[];
            return { connection, documentList: documents }
        })
        )

        setConnectionList(connectionList);
    }
    const handleUploadConfirm = async () => {
        if (!fileList.length) {
            message.warning('Please upload file');
            return;
        }
        if (!resourceName) {
            message.warning('Please input resource name');
            return;
        }

        // 获取file connection数据
        const store = new IndexDBStore();
        await store.connect(constant.DEFAULT_INDEXDB_NAME);
        let connection: DB.CONNECTION;
        if (uploadScene == 'add') {
            connection = await store.createConnection(resourceName, constant.Connector.File);
        } else {
            connection = connectionList.find((item) => item.connection.id == curConnection!.id)!.connection;
        }
        console.log('connection', connection);
        const fileConnector = new FileConnector();

        // 遍历文件,存储文档
        let curFile
        try {
            for (const file of fileList) {
                curFile = file;
                const { bigChunks, miniChunks } = await fileConnector.getChunks(curFile);

                if (!bigChunks.length && !miniChunks.length) {
                    message.warning(`${file.name} no content`);
                    continue;
                }

                // 存储最基础的document
                let document: DB.DOCUMENT = {
                    name: file.name,
                    text_chunk_id_range: {
                        from: 0,
                        to: 0
                    },
                    lsh_index_id: 0,
                    full_text_index_id: 0,
                    resource: file.originFileObj,
                    created_at: new Date(),
                    status: 1,
                    connection: {
                        id: connection.id!,
                        name: connection.name
                    }
                }
                let documentId = await store.add({
                    storeName: constant.DOCUMENT_STORE_NAME,
                    data: document,
                });
                document.id = documentId;
                console.log('document', document);

                // 更新页面resource列表
                fetchConnectionList();

                // 向量化,并存储索引
                const storageDocRes = await storagePoolRef.current?.exec('storageDocument', [{ bigChunks, miniChunks, document, connection }]) as Storage.DocItemRes

                // 提示结果
                if (storageDocRes.status == 3) {
                    message.success(`${file.name} storage success`);
                } else if (storageDocRes.status == 2) {
                    message.error(`${file.name} storage fail`);
                } else {
                    message.error(`${file.name} unknown status`);
                }

                // 更新页面resource列表
                fetchConnectionList();

            }
        } catch (error) {
            console.error('Unknown error', error, curFile);
            message.error('Unknown error');
        }

    }
    const handleSearch = (value: string) => {
        console.log(value);
    }
    const handleAddResource = () => {
        setUploadModalOpen(true);
        setUploadScene('add');
    }



    useEffect(() => {
        fetchConnectionList();

        storagePoolRef.current = workerpool.pool(storageWorkerURL, {
            maxWorkers: 1,
        });
    }, [])

    return (
        <div className='resource pt-2'>
            <div className="title flex items-center justify-between border-b">
                <div className='flex items-center  gap-1 py-5'>
                    <IoDocumentAttachOutline size={25} />
                    <span className='text-lg font-bold'>Resource</span>
                </div>

                <Button type="primary" onClick={handleAddResource}>Add Resource</Button>
            </div>

            <div className="search py-5 ">
                <Search className='text-base' placeholder="Search file name..." onSearch={handleSearch} enterButton size="large" />
            </div>


            <div className="list">
                {
                    !connectionList.length ? <Empty description='No resource yet' /> : <Collapse
                        defaultActiveKey={['1']}
                        onChange={handleCollapseChange}
                        expandIconPosition='start'
                        items={CollapseItems}
                    />
                }


            </div>

            <Modal centered title={uploadScene == 'add' ? 'Add Resource' : 'Edit Resource'} open={uploadModalOpen} onOk={handleUploadConfirm} onCancel={() => { setUploadModalOpen(false) }}>
                <div>
                    Resource Name
                </div>


                <Input placeholder='A descriptive name for the resource.' className='my-2' value={resourceName} onChange={(e) => {
                    setResourceName(e.target.value);
                }} />

                <Dragger  {...uploadProps} fileList={fileList} >
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