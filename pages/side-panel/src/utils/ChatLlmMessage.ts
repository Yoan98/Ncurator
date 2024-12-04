import { CHAT_SYSTEM_PROMPT } from '@src/config';
import { WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { ChatCompletionChunk } from "@mlc-ai/web-llm";
import { KNOWLEDGE_USER_PROMPT } from '@src/config'
import { getModelContextWindowSize, calculateTokens } from '@src/utils/tool';

interface ConstructorParams {
    responseStyle: 'text' | 'markdown'
    chatHistory?: Chat.LlmMessage[]
}

// 消息管理
export class ChatLlmMessage {
    private chatHistory: Chat.LlmMessage[]

    constructor({ responseStyle = 'text', chatHistory }: ConstructorParams) {
        this.chatHistory = [
            {
                role: "system", content: this.getSystemPrompt(responseStyle)
            },
        ]

        if (chatHistory && chatHistory.length) {
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
            const context = searchTextRes!.map((item, index) => `${index + 1}.${item.text}`).join('\n');

            const inp =
                KNOWLEDGE_USER_PROMPT +
                "\n" +
                context +
                "\n\nQuestion: " +
                question +
                "\n\nHelpful Answer: ";

            return inp
        } else if (type === 'chat') {
            return question
        } else {
            throw new Error('Unknown type')
        }
    }

    private truncateChatHistory(contextWindowSize: number) {
        let totalTokens = calculateTokens(this.chatHistory.map((msg) => msg.content));

        // 长度大于2是因为至少要保留一个系统消息和一个用户消息
        while (totalTokens > contextWindowSize && this.chatHistory.length > 2) {
            const firstUserOrAssistantMsgIndex = this.chatHistory.findIndex((msg) => msg.role === 'user' || msg.role === 'assistant');
            this.chatHistory.splice(firstUserOrAssistantMsgIndex, 1);
            totalTokens = calculateTokens(this.chatHistory.map((msg) => msg.content));
            console.log('truncateChatHistory', totalTokens, contextWindowSize)
        }
    }

    async sendMsg({ prompt, type, searchTextRes, streamCb, llmEngine }: {
        prompt: string,
        type: 'chat' | 'knowledge',
        searchTextRes?: Search.TextItemRes[],
        streamCb?: (msg: string, chunk: ChatCompletionChunk) => void,
        llmEngine: WebWorkerMLCEngine
    }) {
        const contextWindowSize = getModelContextWindowSize(llmEngine)

        const userMsg = {
            role: "user" as 'user',
            content: this.getUserPrompt(type, prompt, searchTextRes)
        }
        const systemMsg = this.chatHistory[0]
        const defaultMsgLen = calculateTokens([systemMsg.content, userMsg.content]);
        if (defaultMsgLen > contextWindowSize) {
            throw new Error(`User prompt or relate text over model context window size(${contextWindowSize}, current: ${defaultMsgLen})`)
        }

        this.chatHistory.push(userMsg)

        // 截断 chatHistory 以确保不会超过上下文窗口大小
        this.truncateChatHistory(contextWindowSize);

        let curMessage = "";
        const reply = await llmEngine.chat.completions.create({
            stream: true,
            messages: this.chatHistory,
            // max_tokens: LLM_GENERATE_MAX_TOKENS,
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

        console.log('chatHistory', this.chatHistory)

        return curMessage
    }

    getChatHistory() {
        return this.chatHistory
    }
}