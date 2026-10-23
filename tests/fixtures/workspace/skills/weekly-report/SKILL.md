---
name: weekly-report
description: 整理周报、项目进展和风险汇报，按团队归档规范生成周报文件。
license: MIT
metadata:
  example: preserve-this-field
---

# 周报归档规范

整理周报时先读取相对路径 references/rules.json。
将结果保存为用户指定的 JSON 文件，包含 ruleVersion、status、progress、risks、nextSteps 五个字段。
ruleVersion 使用规则文件的 ruleVersion；存在外部阻塞时 status 使用规则文件的 blockedStatus。
progress、risks、nextSteps 使用数组，只写用户给出的事实，不虚构进度或负责人。
