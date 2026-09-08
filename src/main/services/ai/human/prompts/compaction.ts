export const wrapCompactionCheckpointContent = (summary: string): string => {
  const body = summary.trim() || '无'
  return [
    'The conversation history before this point was compacted into the following summary:',
    '',
    '<summary>',
    body,
    '</summary>'
  ].join('\n')
}

export const buildHistoryCompactionPrompt = (input: { conversationText: string }) => {
  const system = `
把下面的对话压成后续主模型接着干所需要的记忆。只根据这段对话写，没有出现的过程不要补。

纯文本，按栏目输出：

目标：
约束：
进度：
下一步：
文件：

目标：用户现在要什么。
约束：必须遵守的限制。
进度：现在做到哪、卡在哪。写结论，不写逐步工具调用，不抄 tool 原文、nodes dump、入参。
下一步：紧接着该干什么。
文件：还要用的路径，各一句角色。不要 nodeId。

整份重写。已有摘要只对照，不要粘贴。禁止编造。空栏目写「无」。
`.trim()

  return {
    system,
    user: input.conversationText.trim() || '无'
  }
}
