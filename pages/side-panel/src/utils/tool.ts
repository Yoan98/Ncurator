// 获取几个索引表的表名
export const getIndexStoreName = (connector: ConnectorUnion, connectionId: number, storeName: string) => {
    return `${connector}_${connectionId}_${storeName}`
}

// 检测WebGPU是否可用
export async function checkWebGPU() {
    if (!navigator.gpu) {
        console.log("WebGPU is not supported.");
        return false;
    }
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
            console.log("WebGPU is available and the adapter was successfully created.");
            return true;
        } else {
            console.log("WebGPU is supported but no suitable adapter was found.");
            return false;
        }
    } catch (error) {
        console.error("An error occurred while requesting the WebGPU adapter:", error);
        return false;
    }
}
