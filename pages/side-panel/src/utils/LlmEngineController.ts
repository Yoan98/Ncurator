import OpenAI from "openai";
import { WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { LLM_MODEL_LIST } from '@src/utils/constant';
import { ModelSort } from '@src/utils/constant';

export class LlmEngineController {

    engine: WebWorkerMLCEngine | OpenAI
    webllmEngine: WebWorkerMLCEngine | null
    openaiEngine: OpenAI | null
    modelInfo: typeof LLM_MODEL_LIST[number]
    constructor({ modelId }: { modelId: string }) {
        this.updateModelInfo(modelId)

        if (this.modelInfo.sort === ModelSort.Api) {
            this.openaiEngine = this.getOpenAIEngine(this.modelInfo)
            this.engine = this.openaiEngine
        } else if (this.modelInfo.sort === ModelSort.Webllm) {
            this.webllmEngine = this.getWebWorkerMLCEngine()
            this.engine = this.webllmEngine
        } else {
            throw new Error('Unknown modelSort to init')
        }
    }

    interruptGenerate(abortController?: AbortController) {
        if (this.modelInfo.sort === ModelSort.Api) {
            abortController?.abort()
        } else if (this.modelInfo.sort === ModelSort.Webllm) {
            const engine = this.engine as WebWorkerMLCEngine
            engine.interruptGenerate()
        } else {
            throw new Error('Unknown modelSort to interruptGenerate')
        }
    }

    // 目前只有webllm有unload
    async unload() {
        if (this.modelInfo.sort === ModelSort.Webllm) {
            console.log('unload webllm')
            await this.webllmEngine?.unload()
            console.log('unload webllm done')
        } else if (this.modelInfo.sort === ModelSort.Api) {
            this.openaiEngine = null
        } else {
            throw new Error('Unknown modelSort to unload')
        }
    }

    async reload({
        modelId,
        initProgressCallback
    }: {
        modelId: string,
        initProgressCallback: (progress: { progress: number }) => void
    }) {
        // 卸载旧的引擎
        await this.unload()

        // 更新新的模型信息
        this.updateModelInfo(modelId)

        if (this.modelInfo.sort === ModelSort.Webllm) {
            this.webllmEngine = this.getWebWorkerMLCEngine()
            this.engine = this.webllmEngine
            this.engine.setInitProgressCallback(initProgressCallback)
            await this.engine.reload(modelId)

        } else if (this.modelInfo.sort === ModelSort.Api) {
            this.openaiEngine = this.getOpenAIEngine(this.modelInfo)
            this.engine = this.openaiEngine
            initProgressCallback({ progress: 1 })

        } else {
            throw new Error('Unknown model to reload')
        }
    }

    private updateModelInfo(modelId: string) {
        this.modelInfo = LLM_MODEL_LIST.find((item) => item.modelId === modelId)!;
    }
    private getWebWorkerMLCEngine() {
        if (this.webllmEngine) {
            return this.webllmEngine
        }
        const webllmEngine = new WebWorkerMLCEngine(new Worker(
            new URL("@src/worker-pool/llm.ts", import.meta.url),
            {
                type: "module",
            }))
        return webllmEngine
    }
    private getOpenAIEngine(modelInfo: typeof LLM_MODEL_LIST[number]) {
        const engine = new OpenAI(
            {
                // 若没有配置环境变量，请用百炼API Key将下行替换为：apiKey: "sk-xxx",
                apiKey: modelInfo.apiKey,
                baseURL: modelInfo.baseUrl,
                dangerouslyAllowBrowser: true
            }
        )
        return engine
    }
}