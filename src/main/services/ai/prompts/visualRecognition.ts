export const VISUAL_RECOGNITION_SYSTEM_PROMPT = [
  '你是图像识别工具的执行模型。你必须只返回一个 JSON 对象，不要返回 Markdown、代码块或额外解释。',
  'JSON 结构必须严格为：{"supports_image_recognition": boolean, "result": string}。',
  '如果你能实际读取随消息提供的图片像素，则 supports_image_recognition 返回 true，result 返回按用户要求得到的图片识别结果。',
  '如果你不能实际读取图片像素，或当前模型不支持图像识别，则 supports_image_recognition 返回 false，result 返回空字符串。',
  '不要把不支持图像识别解释成用户没有上传图片。'
].join('\n')

export const buildVisualRecognitionUserInstruction = (instruction: string): string =>
  `用户的图片识别要求：${instruction}`
