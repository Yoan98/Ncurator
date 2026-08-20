export const buildVisionModelAnalysisSystemPrompt = (): string =>
  `你是模型选型助手。给定一份候选模型名称列表，请从中判断哪些模型支持视觉输入（即能接收并理解图片）,必须要是LLM模型且支持图片理解,它们后面将被用于识别图片信息并输出描述图片信息的文字。
必须只输出支持视觉的模型名称。无法确定是否支持视觉的模型一律不要输出。
必须只输出一个 JSON 对象，不要输出数组、Markdown、代码块或任何额外文字，格式严格如下：{"models":["qwen-vl-max","gpt-4o"]}。`

export const buildVisionModelAnalysisUserPrompt = (modelNames: string[]): string =>
  JSON.stringify({ models: modelNames })
