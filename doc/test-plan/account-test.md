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

### 执行

**隔离源码回归。** 将 `NCURATOR_ACCOUNT_E2E_FIXTURE` 指向本轮仍在运行的隔离账号服务生成的描述文件。用 `--case` 选要回归的用例。下列命令执行账号、授权、换号、余额和网页跳转的八条隔离用例。

```bash
pnpm test:e2e:source --domain account \
  --case account-menu-and-page --case account-web-navigation \
  --case balance-refresh-and-ordering --case balance-display-and-funds-state \
  --case independent-sessions-and-restart --case browser-login-outcomes \
  --case account-change-during-runs --case account-change-pending-child
```

**免登录真实模型。** 用 `NCURATOR_ACCOUNT_E2E_PROFILE=node-one-free-live` 启动隔离账号服务，再将对应描述文件传给 `NCURATOR_ACCOUNT_E2E_FIXTURE`，执行 `pnpm test:e2e:source --case anonymous-existing-usage`。模型和授权要求见[真实模型与自动化覆盖边界](#4-真实模型与自动化覆盖边界)。

**馆长图文。** 将 `NCURATOR_ACCOUNT_VISION_E2E_FIXTURE` 指向允许调用真实馆长模型的隔离服务描述文件，执行 `pnpm test:e2e:source --case managed-image-conversation`。验证范围见 [Workbench 馆长图文用例](workbench-test.md#managed-image-conversation)。

**国内正式包。** 准备普通和图文两套隔离服务，按[候选包发布流程](../deploy/release.md#22-影响评估)执行。完整发版回归自动选中账号与馆长模型必验用例，按影响评估分批执行时需补齐同一制品的通过证据。

**本地服务联调。** 按[环境变量示例](../../.env-example)将本地客户端配置同步到桌面项目的 `.env`，桌面与网页分别选择 `local` 并重启。执行 `NCURATOR_E2E_LOCAL_BACKEND=1 pnpm test:e2e:source --domain account --case browser-login-outcomes`，核对授权网页和浏览器会话请求均指向选中的本地服务。本分支仅验证真实授权入口和未登录会话请求，不代替完整登录、余额及模型调用验收。隔离源码账号 fixture 将自己的签名 Key 写入私有临时 `.env`，与开发机的 `.env` 隔离；正式包仍使用包内 Key。

Main 与 runner 对 `.env` 行尾注释的解析、两组 Key 的切换及隔离、同步失败时清除旧本地 Key、保留生产配置及正式包固定走生产，由 `tests/case/unit/app/service-environment.test.ts` 验证。源码本地与生产联调目录按现有规则隔离；环境选择不进入产品设置。

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
- How：通过授权建立网页和两个独立桌面会话，退出应用后重启，核对登录恢复且原任务不自动执行。首个桌面保持无个人连接，从工作台提示可见时开始授权，授权完成后确认提示消失。访问凭证到期后触发刷新，丢弃已成功处理的刷新响应，检查协议恢复及持久化后重启；恢复失败时重新授权。暂停后端后恢复，核对网络失败不误退出。分别退出网页、当前桌面或经官网撤销设备，检查各会话范围、本地数据及重新授权后的原账号和钱包。
- Oracle：重启恢复、按需续期、响应丢失恢复及新凭证持久化正确，旧响应不复活会话，覆盖 `ACC-SESSION-001-AC1`；网页与各桌面独立退出，覆盖 `ACC-SESSION-001-AC2`；明确失效后不能新开馆长调用，重新授权保留原账号和钱包，不恢复旧任务，本地数据和免登录能力保留，覆盖 `ACC-SESSION-001-AC3`。登录后无个人连接也不显示配置提示，补证 `WB-COMPOSER-007-AC22`。

#### `account-change-during-runs`

- 测试类型：`e2e`，源码使用 `pnpm test:e2e:source --case account-change-during-runs`，同时纳入国内正式包回归。
- What：桌面退出确认和换号时的馆长任务与费用归属。
- Why：迟到响应可能覆盖换号后的账号，或使旧任务由新账号继续扣费。
- How：使用受控上游和真实计费 API 完成已受理的馆长请求，在测试网络边界暂扣原始响应。通过桌面界面提交排队消息，再打开退出确认，先取消后确认。重新授权另一个测试账号后交付原响应，核对界面、调用编号、会话和两个钱包。
- Oracle：取消确认时保留账号、运行和排队消息，确认时停止原账号运行并将旧队列移出待发送状态，补证 `ACC-SESSION-002-AC1/AC2`。换号后迟到结果不能恢复旧任务、覆盖新账号或重复执行，费用留在原账号，补证 `ACC-SESSION-002-AC3/AC4`。免费和个人连接的退出独立性见 `anonymous-existing-usage`。

#### `account-change-pending-child`

- 测试类型：`e2e`，纳入国内正式包回归。
- What：退出和换号期间待审批的馆长子任务如何收尾。
- Why：审批卡和子任务若跨账号存续，旧任务可能由新账号继续执行。
- How：从实际界面启动馆长任务，使用受控上游派发子任务并生成待人工审批。先取消退出，再确认退出并授权第二个账号。
- Oracle：取消退出保留待审批；确认退出关闭审批和子任务，新账号无旧审批和账单，对齐 `ACC-SESSION-002-AC1/AC2/AC3`。

### overview

#### `account-menu-and-page`

- 测试类型：`e2e`
- What：账号菜单、头像、设置导航和余额异常状态。
- Why：入口不一致、读取失败或残留数据会展示错误账号或误导余额为零。
- How：用键盘展开菜单，核对模型优惠标签在「登录」下方且同属一个菜单项，以及设置、帮助、版本和收起行为。点击登录，确认浏览器授权地址和桌面路由。授权后核对优惠标签已收起、脱敏邮箱、首字符，以及左下入口和菜单头像一致的薄荷绿圆底、浅绿描边和深绿文字。进入设置确认导航分类。通过测试充值形成余额，在桌面网络边界中断余额读取后再恢复。点击左下角账号入口时强制 `refresh-wallet`，绕过 30 秒钱包缓存；刷新期间保留旧值并显示刷新中，失败保留旧值。真实 Electron 使用正常窗口和原生最小 1400×800 窗口记录菜单尺寸与截图。通过菜单退出并核对网页会话。缩窄渲染视口，核对未登录菜单宽度和优惠文字换行，再恢复原视口。
- Oracle：未登录优惠菜单随内容定宽，窄视口内标签换行，菜单与版本行完整可见。登录前后入口、菜单操作与设置分类正确，覆盖 `ACC-ENTRY-001-AC1/AC2/AC3`。应用继续运行，网页会话仍有效。余额读取失败保留本人金额并标记待更新，覆盖 `ACC-BALANCE-001-AC4`。

#### `balance-display-and-funds-state`

- 测试类型：`e2e`
- What：真实零额、两位默认金额、精确值、非零小额与退款资金占用。
- Why：展示舍入与资金预占需要与实际可用余额一致。
- How：用隔离账号服务登录、充值并发送馆长请求。从管理网页对同一笔订单提交部分退款，使可用余额低于一分钱。随后控制新调用停在费用已决定、结算待提交的状态，再由真实结算路径完成扣费并形成欠费。
- Oracle：零余额、小额与普通金额准确区分，精确值与实际扣费一致，补证 `ACC-BALANCE-001-AC1/AC2`。网页单独提示退款处理中，账务按退款冻结记录。桌面和网页按实际资金状态切换结算中与欠费提示，补证 `ACC-BALANCE-001-AC3`。桌面离线反馈见 `account-menu-and-page`。

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
- How：从菜单打开账户概览、充值及账单，在系统浏览器调用边界核对公开地址。从菜单打开帮助，核对当前语言的联系页。无网页会话时分别登录并检查原页面回跳，验证网页可使用不同于桌面的账号。打开充值后返回桌面，核对一次即时余额读取。检查桌面无退款入口、与网页会话 API 的用户编号一致，并用海外发行配置确认无国内账号及资金入口。海外入口使用现有源码发行配置验证，安装包发行标记另按包验收。
- Oracle：目标和打开方式正确，不带桌面凭证、不假定网页登录，覆盖 `ACC-WEB-001-AC1/AC2`；桌面无退款入口、编号与官网一致，海外不展示国内资金能力，覆盖 `ACC-WEB-001-AC3/AC4`。

## 4. 真实模型与自动化覆盖边界

隔离源码回归中，浏览器按桌面给出的地址操作，回跳和焦点事件由测试交给应用入口，业务处理走实际 Main、IPC、凭据存储和 UI。Windows 正式包的 `browser-login-outcomes` 核对协议注册指向已安装程序，并用隔离用户目录执行注册命令，验证已运行实例能接收真实回跳并完成登录。系统默认浏览器和实际焦点切换由安装包人工验收。

`anonymous-existing-usage` 的 16 次调用均使用真实上游。个人自定义经已授权的本机订阅代理使用 `gpt-6-luna`，免费路径使用目录中的 `glm-4.7-flash` 或 `glm-4-flash-250414`。用 `NCURATOR_ACCOUNT_E2E_FREE_MODEL` 选择免费型号，默认 `glm-4.7-flash`，执行前核对零价条件。账号、钱包和授权使用隔离服务，回复及用量采用上游实际结果。

免费 Key 仅注入隔离服务内存。桌面使用本机已配置的 custom live 连接，通过模型列表和 UI 保存连接。控制描述保存在权限为 `0600` 的私有临时文件，测试仅留脱敏诊断。网页登录有效时比较正式 usage／funds，封禁后验证权限拒绝，再用管理查询核对资金事实。

可设 `NCURATOR_ACCOUNT_E2E_FAMILY=custom` 或 `free` 仅执行一条路径的八组，结果只覆盖该路径。失败时保留实际请求和错误证据，按原因决定是否复跑。

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

人工待验收：用 macOS、Windows 安装包验证浏览器唤起、默认协议关联和回跳。Windows 核对安装器注册及回跳交给正在运行的实例。通过系统入口直接打开已安装应用，分别验证未登录启动、授权成功后完全退出再启动、账号退出后再启动。三个场景均无系统凭据授权弹窗，已登录时正常恢复，退出账号后保持未登录。凭据写入失败时应显示错误。同一本地目录运行不同发行包时账号隔离且个人数据保留。上述检查补证 `ACC-LOGIN-001-AC1/AC3/AC4`、`ACC-SESSION-001-AC1/AC2`、`ACC-ACCESS-001-AC2`、`ACC-WEB-001-AC4`。

开发联调使用 `pnpm dev` 和支持本机回跳的国内授权服务，从系统浏览器完成登录。在同一台机器上保留安装包并分别发起授权，检查各自登录状态和退出范围，以及开发版重复授权、取消或退出后旧端口释放，补证 `ACC-LOGIN-001-AC5`。

真实渠道验收记录邮箱及微信登录，以及充值到账回桌面后的余额刷新，对应 `ACC-LOGIN-001-AC2`、`ACC-BALANCE-002-AC3`。按候选影响范围沿用已有渠道回执或补充验证。
