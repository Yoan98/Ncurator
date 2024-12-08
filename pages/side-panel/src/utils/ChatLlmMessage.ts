import { CHAT_SYSTEM_PROMPT } from '@src/config';
import type { WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { ChatCompletionChunk } from "@mlc-ai/web-llm";
import { KNOWLEDGE_USER_PROMPT } from '@src/config'
import { calculateTokens } from '@src/utils/tool';
import type { LlmEngineController } from '@src/utils/LlmEngineController'
import { ModelSort } from '@src/utils/constant';
import type { OpenAI } from 'openai';

interface ConstructorParams {
    responseStyle: 'text' | 'markdown'
    chatHistory?: Chat.LlmMessage[]
}
type StreamCb = (msg: string, finish_reason: string | null) => void

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
            return CHAT_SYSTEM_PROMPT + '\n' + "Please format your response in Markdown."
        } else if (responseStyle === 'text') {
            return CHAT_SYSTEM_PROMPT + '\n' + "Please respond in Markdown logically, but concisely and not Markdown format."
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
            const inp = "Use all the knowledge you have to answer the flowing question: " +
                "\n\nQuestion: " +
                question
            return inp
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

    async sendMsg({ prompt, type, searchTextRes, streamCb, llmEngine, abortSignal }: {
        prompt: string,
        type: 'chat' | 'knowledge',
        searchTextRes?: Search.TextItemRes[],
        streamCb?: (msg: string, finish_reason: string | null) => void,
        llmEngine: LlmEngineController,
        abortSignal?: AbortSignal
    }) {
        const contextWindowSize = llmEngine.modelInfo.contextWindowSize

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

        let assistantMsg = ''
        // 判断llm类型
        if (llmEngine.modelInfo.sort === ModelSort.Webllm) {
            assistantMsg = await this.webllmCompletionsCreate({
                llmEngine,
                streamCb,
                messages: this.chatHistory
            })
        } else if (llmEngine.modelInfo.sort === ModelSort.Api) {
            assistantMsg = await this.openaiCompletionsCreate({
                llmEngine,
                messages: this.chatHistory,
                streamCb,
                abortSignal
            })
        } else {
            throw new Error('Unknown modelSort to sendMsg')
        }

        this.chatHistory.push({ role: "assistant", content: assistantMsg })

        console.log('chatHistory', this.chatHistory)

        return assistantMsg
    }

    private async webllmCompletionsCreate({
        llmEngine,
        streamCb,
        messages,
    }: {
        llmEngine: LlmEngineController,
        streamCb?: StreamCb,
        messages: Chat.LlmMessage[],

    }) {
        const engine = llmEngine.engine as WebWorkerMLCEngine
        const reply = await engine.chat.completions.create({
            stream: true,
            messages,
        });

        let curMessage = await this.openAiStyleStreamChunkToMessage(reply, streamCb)
        return curMessage
    }

    private async openaiCompletionsCreate({
        llmEngine,
        messages,
        streamCb,
        abortSignal
    }: {
        llmEngine: LlmEngineController
        messages: Chat.LlmMessage[]
        streamCb?: StreamCb
        abortSignal?: AbortSignal
    }) {
        const engine = llmEngine.engine as OpenAI
        const reply = await engine.chat.completions.create({
            model: llmEngine.modelInfo.modelId,
            messages: messages,
            stream: true,
        }, {
            signal: abortSignal
        });

        let curMessage = await this.openAiStyleStreamChunkToMessage(reply, streamCb)
        return curMessage
    }

    private async openAiStyleStreamChunkToMessage(reply, streamCb?: StreamCb) {
        let curMessage = "";
        for await (const chunk of reply) {
            const curDelta = chunk.choices[0]?.delta?.content;
            if (curDelta) {
                curMessage += curDelta;
            }

            if (streamCb) {
                streamCb(curMessage, chunk.choices[0]?.finish_reason)
            }
        }
        return curMessage

    }
    getChatHistory() {
        return this.chatHistory
    }
}