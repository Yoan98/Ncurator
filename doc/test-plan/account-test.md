# NCurator-Desktop Account 测试计划

## 1. 总体目标

验证 [Account PRD](../prd/account.md) 的账号入口、授权、概览、独立退出和官网跳转，并保证原有免费、自定义及本地工作能力不被付费功能接管。通用规则遵循 [测试规范](../test.md)。

## 2. Suite 与验证边界

| Suite | 范围 |
| --- | --- |
| access | 原有免登录路径及本地数据保留 |
| authorization | 浏览器授权、续期及独立退出 |
| overview | 账号菜单、余额与官网跳转 |

正式 case 归入 `tests/case/account/<suite>/<caseId>.e2e.test.ts`，全部通过真实 Electron UI 及生产 Main、IPC 和服务执行，不直接写登录态、余额、模型选择或凭据存储。

使用独立测试 API 环境，外部认证、支付及模型计量在服务边界提供受控测试能力，客户端仍走完整登录、授权和请求流程。余额通过测试充值形成，异常使用过期、撤销、错误回跳或服务停机；真实邮箱验证码、微信及支付另做联调。

原有模型实际调用使用 live，不能用受控模型输出证明 AI 完成真实任务。本域验证桌面账号行为及接口结果；模型选择和一般任务交互见 Workbench 计划。

## 3. 回归清单

### access

#### `anonymous-existing-usage`

- 测试类型：`e2e / live`
- What：原有免费及自带 Key 路径继续免登录使用，登录变化保留已有配置和资料。
- Why：新增账号可能成为全局门禁，或将旧连接替换成平台付费。
- How：在隔离本地目录通过真实 UI 配置个人连接、创建两个伙伴和 UTF-8 文件资料，依次在未登录、同目录重启、A 零余额正常执行、A 运行中退出、退出后、B 零余额、网页撤销全部设备及重新授权 B 后经管理 UI 封禁八组状态，各发送免费／自定义一次，合计 16 次。记录对象 ID、原选择、连接公开属性、聊天前缀、工作区关联及文件内容保持；只读 IPC／数据库用于收证，不写业务状态。使用正式隔离目录、免费取票及调用路由；目录必须有预期条目且无错误，不能以错误态或空目录通过正向验收。
- Oracle：未登录、失效、封禁及零余额仍可用原路径，覆盖 `ACC-ACCESS-001-AC1`；运行中退出不停止免费／自定义，网页独立有效；登录变化保留配置和本地内容，不替换原连接、不自动恢复任务，覆盖 `ACC-ACCESS-001-AC2/AC3`。每组相对前置基线检查免费／自定义没有新增 `model_calls`、钱包预占和资金流水；正式 usage／funds 查询也不出现对应记录。显式登录创建身份与既有账单单独计数，不能仅以全库零记录推断。

### authorization

#### `browser-login-outcomes`

- 测试类型：`e2e`
- What：系统浏览器授权及成功、取消和无效回跳的处理。
- Why：网页成功不等于桌面已兑换登录，错误回跳可能造成串号。
- How：从桌面真实入口打开隔离官网完成登录和授权。使用实际签发的一次性码覆盖取消后的迟到回跳、届满过期、错误 state、成功和重复回跳；通过应用的协议入口投递，观察真实界面与账户会话。已处理的首次兑换响应丢失由账号 Unit 补证，系统浏览器和协议注册由签名包验收。
- Oracle：系统浏览器及目标正确，凭证保存成功后显示对应账号，覆盖 `ACC-LOGIN-001-AC1/AC2`；重复回调合并，一次性兑换结果不明可重新授权，异常不显示成功，凭证不泄漏，覆盖 `ACC-LOGIN-001-AC3/AC4`；旧回调不覆盖当前登录，覆盖 `ACC-SESSION-002-AC4`。

启用 `NCURATOR_E2E_LOCAL_BACKEND=1` 时，使用已启动的本地后端和官网。由真实桌面发起授权，只观察系统浏览器接收的地址。使用 Playwright 打开该地址，核对本地网页对同一 API 发出的会话请求。

#### `independent-sessions-and-restart`

- 测试类型：`e2e`
- What：登录恢复、按需续期、独立退出及失效后的使用边界。
- Why：共用会话或全局清理会造成设备互相退出、授权复活或本地数据丢失。
- How：通过授权建立网页和两个独立桌面会话，退出应用后重启，核对登录恢复且原任务不自动执行。访问凭证到期后触发刷新，丢弃已成功处理的刷新响应，检查协议恢复及持久化后重启；恢复失败时重新授权。暂停后端后恢复，核对网络失败不误退出。分别退出网页、当前桌面或经官网撤销设备，检查各会话范围、本地数据及重新授权后的原账号和钱包。
- Oracle：重启恢复、按需续期、响应丢失恢复及新凭证持久化正确，旧响应不复活会话，覆盖 `ACC-SESSION-001-AC1`；网页与各桌面独立退出，覆盖 `ACC-SESSION-001-AC2`；明确失效后不能新开馆长调用，重新授权保留原账号和钱包，不恢复旧任务，本地数据和免登录能力保留，覆盖 `ACC-SESSION-001-AC3`。

#### `account-change-during-runs`

- 测试类型：`e2e / live`，使用 `pnpm test:e2e:source --case account-change-during-runs` 单独执行。
- What：桌面退出确认和换号时的馆长任务与费用归属。
- Why：迟到响应可能覆盖换号后的账号，或使旧任务由新账号继续扣费。
- How：用真实上游完成已受理的馆长请求，在测试网络边界暂扣原始响应。在真实桌面打开退出确认，先取消再打开并确认退出。重新授权另一个测试账号后交付原响应，核对界面、调用编号、会话和两个钱包。
- Oracle：取消确认时账号及运行保持，确认时停止对应馆长任务，补证 `ACC-SESSION-002-AC1`。换号后迟到结果不能恢复旧任务、覆盖新账号或重复执行，费用留在原账号，补证 `ACC-SESSION-002-AC3/AC4`。免费和个人连接的退出独立性见 `anonymous-existing-usage`。撤销、追加消息与子任务的边界分别由账号 Unit 和运行服务契约覆盖，对应 `ACC-SESSION-002-AC2`，相关真实 UI 组合仍待补全。

### overview

#### `account-menu-and-page`

- 测试类型：`e2e`
- What：账号菜单、头像、设置导航和余额异常状态。
- Why：入口不一致、读取失败或残留数据会展示错误账号或误导余额为零。
- How：用键盘展开菜单，核对模型优惠标签在「登录」下方且同属一个菜单项，以及设置、帮助、版本和收起行为。点击登录，确认浏览器授权地址和桌面路由。授权后核对优惠标签已收起、脱敏邮箱、首字符，以及左下入口和菜单头像一致的薄荷绿圆底、浅绿描边和深绿文字。进入设置确认导航分类。通过测试充值形成余额，在桌面网络边界中断余额读取后再恢复。真实 Electron 使用正常窗口和原生最小 1400×800 窗口记录菜单尺寸与截图。通过菜单退出并核对网页会话。
- Oracle：登录前后入口、菜单操作与设置分类正确，覆盖 `ACC-ENTRY-001-AC1/AC2/AC3`。应用继续运行，网页会话仍有效。余额读取失败保留本人金额并标记待更新，覆盖 `ACC-BALANCE-001-AC4`。

#### `balance-display-and-funds-state`

- 测试类型：`e2e`
- What：真实零额、两位默认金额、精确值、非零小额与退款资金占用。
- Why：展示舍入与资金预占需要与实际可用余额一致。
- How：使用独立 Account 测试服务的管理配置。登录后读取零余额并通过测试渠道充值，从桌面发送由受控计量上游处理的馆长请求，再从管理网页对同一笔测试订单提交原路部分退款，使可用余额降至一分钱以下。核对两端精确值、退款冻结和模型消费。
- Oracle：零余额、小额与普通金额准确区分，精确值与实际扣费一致，补证 `ACC-BALANCE-001-AC1/AC2`。退款冻结单独显示，未作为模型消费，补证 `ACC-BALANCE-001-AC3`。欠费与模型预占金额由服务端账务及行为测试覆盖；桌面离线反馈见 `account-menu-and-page`，欠费和结算中提示的全部桌面分支待补。

#### `balance-refresh-and-ordering`

- 测试类型：`e2e`
- What：事件刷新、30 秒复用、逐次结算快照以及旧响应防覆盖。
- Why：多余轮询增加数据库访问，乱序或串号响应可能展示错误余额，断流重放还可能造成重复消费。
- How：通过真实 UI 登录、打开账号菜单、前后台切换和官网充值跳转。通过桌面账号 IPC 建立受控的余额读取，用实际网络记录及真实等待核对 30 秒窗口和相同请求合并。发起使用受控计量上游的真实馆长调用，检查每次完成确认的资金快照及查询次数，不以固定输出证明 AI 任务质量。网络交付控制仅延迟或丢弃真实响应，不改写响应内容，覆盖新版本先到、原完成确认缺失、退出后旧响应到达及重新登录；核对余额、调用状态与任务没有重复变化。
- Oracle：登录恢复获取余额，覆盖 `ACC-BALANCE-002-AC1`；普通查看复用并合并，充值返回立即读取，覆盖 `ACC-BALANCE-002-AC2/AC3`；逐次快照直接更新，缺失仅按原请求读取或补读，不重发模型、不轮询保活或自动补账，覆盖 `ACC-BALANCE-002-AC4`；旧版本、旧账号和重建上下文前的响应被丢弃，覆盖 `ACC-BALANCE-002-AC5`。

#### `account-web-navigation`

- 测试类型：`e2e`
- What：官网跳转、退款边界及海外功能隔离。
- Why：跳转可能泄漏凭证、假定网页登录或错误显示海外付费入口。
- How：从菜单打开账户概览、充值及账单，在系统浏览器调用边界核对公开地址。从菜单打开帮助，核对当前语言的联系页。无网页会话时分别登录并检查原页面回跳，验证网页可使用不同于桌面的账号。打开充值后返回桌面，核对一次即时余额读取。检查桌面无退款入口、用户编号一致，并用海外发行配置确认无国内账号及资金入口。海外入口使用现有源码发行配置验证，安装包发行标记另按包验收。
- Oracle：目标和打开方式正确，不带桌面凭证、不假定网页登录，覆盖 `ACC-WEB-001-AC1/AC2`；桌面无退款入口、编号与官网一致，海外不展示国内资金能力，覆盖 `ACC-WEB-001-AC3/AC4`。

## 4. 执行与自动化覆盖边界

菜单、余额与网页跳转的源码回归使用独立的回环测试服务。将该服务生成的测试描述文件路径设为 `NCURATOR_ACCOUNT_E2E_FIXTURE`，运行 `pnpm test:e2e:source --domain account --case account-menu-and-page --case account-web-navigation --case balance-refresh-and-ordering --case balance-display-and-funds-state --case independent-sessions-and-restart --case browser-login-outcomes`。隔离浏览器按桌面给出的地址操作，回跳与回到窗口的焦点事件由测试交给应用入口，后续处理走实际 Main、IPC、凭据存储和 UI。系统默认浏览器、真实焦点切换及安装协议关联由安装包验收。

`anonymous-existing-usage` 的节点验收只运行真实上游的 16 次矩阵：个人自定义经已授权的本机订阅代理使用 `gpt-6-luna`，平台免费专项使用现有产品目录中的智谱 `glm-4.7-flash` 或 `glm-4-flash-250414`。免费服务用 `NCURATOR_ACCOUNT_E2E_FREE_MODEL` 显式选定本轮型号，默认前者，不自动回退；执行前复核零价条件，复用已有个人智谱测试凭据。账号、钱包和授权复用既有隔离 PG／Fastify／受控邮件；两条模型回复与用量来自真实供应商，不使用固定回复或填补缺失 usage。新增模拟矩阵暂停，其历史结果不作为节点验收。

执行真实矩阵时，隔离服务显式选 `NCURATOR_ACCOUNT_E2E_PROFILE=node-one-free-live`，免费 Key 只注入服务内存；桌面读取已有 custom live 配置，真实查询本机代理的模型列表并通过 UI 保存个人连接。控制描述位于 OS 私有临时目录并保持 0600；桌面使用同一 `NCURATOR_ACCOUNT_E2E_FIXTURE` 执行 `pnpm test:e2e:source --domain account --case anonymous-existing-usage`。测试资料和消息不含秘密。只记录阶段、发送 ID、状态、固定错误码、公开源码坐标、字节／时长及不变量，保留必要脱敏诊断，不保存完整凭据或原始认证报文。既有本机代理按其当前遮罩规则运行，不改共享配置，不读取／清理已有日志，不作绝对零风险承诺。网页登录有效时比较正式 usage／funds 返回，封禁后按权限拒绝，另以正式管理列表／钱包概要核对，不能将拒绝视为空账单。

一条路径受阻时，可显式设 `NCURATOR_ACCOUNT_E2E_FAMILY=custom` 或 `free` 独立执行另一条尚未完成的八组；不调用对侧模型、不填模拟结果，只形成对应分支证据，不能据八次部分通过宣称完整矩阵完成。失败的已消费许可不自动补发，保留累计请求及失败证据，根据原因和实际可用性人工恢复，避免高频盲重试；不以自设累计次数上限阻止已授权的正常验证，已独审通过的分支不重跑。

该 profile 逐次发放一次推理许可，免费／自定义各最多八次，异常、超时或关闭撤销后续许可；输入最多 64 KiB，流式累计到 16 KiB 立即中止，单次 30 秒、整例 10 分钟；禁止工具执行、重试、回退及额外探测。GPT 路径以已批准的字节／时限约束执行，不冒充实际生成 token 或费用硬限；免费参数硬限 256 token。该例从创建 context 起不启用 trace／HAR／视频／DOM snapshots，避免凭据表单进入产物；用脱敏状态、源码坐标和计数排查，临时产品凭据按正常流程保存于私有用户目录，收尾整体销毁。真实缺失 usage 保持缺失，不调整产品压缩行为。

`independent-sessions-and-restart` 当前自动化覆盖两个独立桌面、网页、重启恢复与各自退出；到期刷新响应丢失、长期停机恢复和全设备撤销仍由主进程 Unit、跨端回归及签名包验收补证。`balance-refresh-and-ordering` 当前覆盖短期复用、真实结算先于延迟余额响应、完成确认丢失后按原请求查回及退出后迟到余额；30 秒边界与多窗口并发另由主进程 Unit 补证，不将其计为该 E2E 已覆盖。

下列 [Unit 用例](../../tests/case/unit/officialApi/desktop-account.test.ts) 补证主进程边界，桌面操作与系统实际行为由各 E2E 和人工验收覆盖。

| 验收 | 已有用例与断言范围 |
| --- | --- |
| `ACC-LOGIN-001-AC1/AC2/AC4` | `keeps the verifier in Main and coalesces matching callbacks until secure storage succeeds` 检查授权地址、回跳校验、合并兑换和保存 |
| `ACC-LOGIN-001-AC3` | `does not replay an uncertain exchange or publish success on storage failure` 检查兑换结果不明及保存失败 |
| `ACC-LOGIN-001-AC5` | `binds development callbacks to the active loopback listener`、`closes the development listener on cancellation, expiry and start failure` 通过实际回环 HTTP 验证地址绑定、回跳和清理；原生协议仍由已安装应用接收 |
| `ACC-SESSION-001-AC1` | `coalesces refresh, preserves the previous protected credential on failure, and rejects stale results after logout` 检查换新及退出时的迟到结果 |
| `ACC-BALANCE-001-AC4`、`ACC-BALANCE-002-AC2/AC5` | `shares wallet reads, retains the last good amount offline, and ignores results from an older context` 检查读取合并、短时间复用、失败保留及旧响应 |
| `ACC-BALANCE-002-AC4` | `looks up the original managed call without a wallet round trip and applies only a newer snapshot` 检查按原请求读取及更新钱包 |
| `ACC-SESSION-002-AC4` | `discards an exchange response after cancellation and after a newer authorization` 检查过时兑换不写入凭据 |

人工待验收：用 macOS、Windows 安装包验证浏览器唤起、默认协议关联、回跳、系统凭据存储。Windows 核对安装器注册及回跳交给正在运行的实例。验证凭据保护不可用时拒绝保存，同一本地目录运行不同发行包时账号隔离且个人数据保留，补证 `ACC-LOGIN-001-AC1/AC4`、`ACC-SESSION-001-AC1`、`ACC-ACCESS-001-AC2`、`ACC-WEB-001-AC4`。

开发联调使用 `pnpm dev` 和支持本机回跳的国内授权服务，从系统浏览器完成登录。在同一台机器上保留安装包并分别发起授权，检查各自登录状态和退出范围，以及开发版重复授权、取消或退出后旧端口释放，补证 `ACC-LOGIN-001-AC5`。

真实渠道待验证：实际邮箱与微信登录、真实充值到账后回桌面及余额刷新，补证 `ACC-LOGIN-001-AC2`、`ACC-BALANCE-002-AC3`。
