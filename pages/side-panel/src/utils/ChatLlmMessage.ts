import type {
    ChatCompletionMessageParam,
} from "@mlc-ai/web-llm";
import { CHAT_SYSTEM_PROMPT } from '@src/config';
import { WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { ChatCompletionChunk } from "@mlc-ai/web-llm";
import { LLM_GENERATE_MAX_TOKENS, LLM_MODEL_LIST } from '@src/config'

interface ConstructorParams {
    responseStyle: 'text' | 'markdown'
    chatHistory?: ChatCompletionMessageParam[]
}

// 消息管理
export class ChatLlmMessage {
    private chatHistory: ChatCompletionMessageParam[]

    constructor({ responseStyle = 'text', chatHistory }: ConstructorParams) {
        this.chatHistory = [
            {
                role: "system", content: this.getSystemPrompt(responseStyle)
            },
        ]

        if (chatHistory) {
            this.chatHistory = chatHistory
        }
    }

    private getSystemPrompt(responseStyle: 'text' | 'markdown' = 'text') {
        if (responseStyle === 'markdown') {
            return CHAT_SYSTEM_PROMPT + "\n\nPlease format your response in Markdown."
        } else if (responseStyle === 'text') {
            return CHAT_SYSTEM_PROMPT
        } else {
            throw new Error('Unknown type')
        }
    }
    private getUserPrompt(type: 'chat' | 'knowledge', question: string, searchTextRes?: Search.TextItemRes[]) {
        if (type === 'knowledge') {
            const context = searchTextRes!.map((item, index) => `Document${index + 1}: ${item.text}`).join('\n');

            const inp =
                "Use the following context when answering the question at the end. Don't use any other knowledge. The documents below have been retrieved and sorted by relevance. Please use them in the order they are presented, with the most relevant ones first.\n" +
                context +
                "\n\nQuestion: " +
                question +
                "\n\nHelpful Answer(in the same language as the question): ";

            return inp
        } else if (type === 'chat') {
            return question
        } else {
            throw new Error('Unknown type')
        }
    }

    private calculateTokens(messages: ChatCompletionMessageParam[]): number {
        // 计算消息中的令牌数量
        // 这里假设每个字符代表一个令牌，你可以根据实际情况调整
        return messages.reduce((acc, message) => acc + message.content!.length, 0);
    }
    private truncateChatHistory(modelId: string) {
        let totalTokens = this.calculateTokens(this.chatHistory);
        const modelInfo = LLM_MODEL_LIST.find((item) => item.modelId === modelId)
        if (!modelInfo) {
            throw new Error('Truncating, Model not found')
        }

        while (totalTokens > modelInfo.contextWindowSize && this.chatHistory.length > 1) {
            this.chatHistory.shift(); // 移除最早的消息
            totalTokens = this.calculateTokens(this.chatHistory);
            console.log('totalTokens', totalTokens)
        }
    }

    async sendMsg({ prompt, type, searchTextRes, streamCb, llmEngine }: {
        prompt: string,
        type: 'chat' | 'knowledge',
        searchTextRes?: Search.TextItemRes[],
        streamCb?: (msg: string, chunk: ChatCompletionChunk) => void,
        llmEngine: WebWorkerMLCEngine
    }) {
        const userPrompt = this.getUserPrompt(type, prompt, searchTextRes);
        this.chatHistory.push({ role: "user", content: userPrompt })

        // 截断 chatHistory 以确保不会超过上下文窗口大小
        this.truncateChatHistory(llmEngine.modelId![0]);

        let curMessage = "";
        const reply = await llmEngine.chat.completions.create({
            stream: true,
            messages: this.chatHistory,
            max_tokens: LLM_GENERATE_MAX_TOKENS,
            // stream_options: {
            //     include_usage: true
            // }
        });
        for await (const chunk of reply) {
            const curDelta = chunk.choices[0]?.delta?.content;
            if (curDelta) {
                curMessage += curDelta;
            }

            if (streamCb) {
                streamCb(curMessage, chunk)
            }

            // if (chunk.usage) {
            //     usage = chunk.usage
            // }
        }
        this.chatHistory.push({ role: "assistant", content: curMessage })

        return curMessage
    }

    getChatHistory() {
        return this.chatHistory
    }
}