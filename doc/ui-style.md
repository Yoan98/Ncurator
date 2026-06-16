# UI 整体风格

## 0. 文档边界

- 本文档只定义视觉系统与通用交互 affordance。
- 用户可见功能、操作逻辑、状态反馈和验收标准统一放在 `doc/prd/**`。
- 新增或修改业务功能时，不要把流程规则、业务状态和功能验收写回本文。

## 1. 设计语言

- 全前端统一使用 **Notion-like 文档工作台主题**，以 `prototypes/notion-redesign/index.html` 为视觉基准。
- 整体气质是大面积白纸、浅灰侧栏、极淡细线数据库和文档块，而不是宣传页、强装饰 dashboard 或水墨面板。
- 主工作区必须以纯白为主，页面层级优先通过留白、极淡分割线、浅灰 hover、文本权重和列表密度表达。
- 禁止恢复旧 Claude/陶土色体系，也不再使用旧 ink-mono 墨白主题作为主视觉。

## 2. 配色

### Token

- `page`：`#FFFFFF`
- `canvas`：`#FFFFFF`
- `sidebar`：`#F7F7F5`
- `surface`：`#F4F4F2`
- `surface-hover`：`#EFEFED`
- `line`：`#EEEEEC`
- `line-strong`：`#E0DFDC`
- `text`：`#37352F`
- `text-soft`：`#787774`
- `text-faint`：`#9B9A97`
- `accent`：`#2F3437`
- `red`：`#B3261E`
- `red-bg`：`#F8EBE9`
- `green`：`#2F6F4E`
- `green-bg`：`#EDF6EF`
- `blue`：`#2F5F8F`
- `blue-bg`：`#EDF3F8`
- `yellow-bg`：`#FBF3DB`

### 使用规则

- App 外层、主阅读区、Settings 和下载页默认使用 `page/canvas` 的纯白底，侧栏使用 `sidebar`。
- 普通 hover、选中、用户消息气泡、弱提示和 tag 才使用 `surface/surface-hover`，不得把它们作为大面积页面背景。
- 常规状态优先使用灰阶、图标与文案；可用低饱和绿、蓝、黄 tag 表示成功、信息、待处理。
- 危险、拒绝、错误才使用 `red/red-bg`。
- 禁止大面积彩色渐变、彩色阴影和高饱和状态色。

## 3. 尺度系统

### 圆角

- 控件：`6px`
- 内嵌块：`8px`
- 浮层：`8px`
- pill / tag：`999px`

### 字级

- 元信息：`12px`
- 正文：`14px`
- 区块标题：`15px-16px`
- 页面标题：`28px-44px`，仅文档式页面标题使用。
- 避免散落使用过多相近字号。

### 间距

- 紧凑控件内边距优先使用 `6 / 8 / 10`
- 面板间距优先使用 `12 / 16 / 20`
- 页面级容器优先使用 `20 / 24 / 32`

### 阴影

- 默认不用阴影，只用留白、极淡分割线和局部浅灰状态表达层级。
- composer、popover、modal 可使用轻浮层阴影：`0 16px 40px rgba(15, 15, 15, 0.12)`。
- 禁止厚重彩色阴影。

## 4. Surface 层级

- `canvas`：App 外层和主工作区底色，默认应与 `page` 同为纯白。
- `sidebar`：导航、会话列表、辅助入口。
- `page`：主文档工作区、表单内容和列表内容。
- `surface`：选中态、用户消息、弱提示、tag、列表 hover，不承载大面积区块。
- `line`：不同区域之间的弱边界，存在感要低于正文和 tag。
- `accent`：主按钮和关键文字动作。

## 5. 组件规则

### Button

- 主按钮只给主动作，深灰底白字。
- 次按钮透明或白底，hover 使用浅灰底。
- 图标按钮使用 `28px-32px` 固定尺寸和 `6px` 圆角。
- 不使用彩色 hover 表达普通交互。

### Input / Select / Composer

- 输入区保持文档工具的紧凑感，不做大宣传页输入框。
- focus 使用 `accent` 边框和浅灰 ring。
- Workbench composer 贴近 Notion 输入块：低圆角、白底、细边框、底部 sticky。
- Workbench 审核态与补工作区态占用 composer slot，互斥隐藏输入框。

### Tag / Status

- tag 用于扫描，不用于长句说明。
- tag 圆角可保持 pill，但视觉重量要低于正文标题。
- 成功、信息、待处理使用低饱和浅底；失败、拒绝、危险态使用红色。

### Table / Database

- 表格应更接近 Notion database：极淡细线、白底、近白表头、紧凑行高。
- 行 hover 使用 `surface-hover`。
- 不把每行做成独立大卡片。
- Settings、下载页等列表型页面不使用灰底托白色大卡片的后台布局。

### Icon

- 默认使用线性图标。
- 小图标 `14px-16px`，常规图标 `18px-20px`。
- 图标优先承担扫描职责：来源、状态、动作、风险、模式。

## 6. 文字与文案

- 页面不是说明书，不要把状态说明写成长段解释。
- 能放进 tooltip、tag、状态条的文案，不要放成段落。
- 标题只负责定位，辅助文案只负责补充范围或行为。

## 7. 动效与交互

- 默认过渡时长 `160-180ms`。
- hover 只做浅灰底、边框变色或轻微透明度变化，不做夸张位移。
- 同类元素必须共享同一套 hover / active / focus 反馈。

## 8. Cursor 规则

- 可点击元素统一使用 `pointer`。
- 文本输入、`textarea`、`contenteditable` 使用 `text`。
- 帮助提示使用 `help`。
- 禁用态统一使用 `not-allowed`。

## 9. 辅助功能

- 所有交互元素必须可键盘访问。
- focus ring 必须清晰可见。
- 文本和背景对比度需满足正常阅读。
