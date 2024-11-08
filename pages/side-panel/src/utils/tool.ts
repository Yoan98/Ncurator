// 获取几个索引表的表名
export const getIndexStoreName = (connector: ConnectorUnion, connectionId: number, storeName: string) => {
    return `${connector}_${connectionId}_${storeName}`
}