
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

/**
 * 将文件大小转换为适当的单位（B、KB、MB、GB）
 * @param file - File 对象
 * @returns 文件大小的字符串表示（带单位）
 */
export function formatFileSize(file: File): string {
    const size = file.size; // 获取文件大小（单位：字节）
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;

    if (size < GB) {
        return `${(size / MB).toFixed(2)} MB`; // 小于 1 GB 显示为 MB，保留两位小数
    } else {
        return `${(size / GB).toFixed(2)} GB`; // 1 GB 及以上显示为 GB，保留两位小数
    }
}
