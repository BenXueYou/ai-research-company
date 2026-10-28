# Issue #42 平台计价与换算系数设置交付记录

日期：2026-10-28。状态：本票模块及当前公共集成已通过真实后端专项验收；未提交、推送或部署。

## 范围与基线

基准提交 `f009895e16571113301e261a87a45051a52d21ac`。起始工作区无本票未提交差异，随后其他会话在共享目录进行 #40/#41 与公共集成；本票只修改 `PlatformSettingsPage.vue`、`components/PricingSettings.vue`、`CoefficientChanges.vue`、自己的测试/config 和交付记录，不编辑共享集成文件，不提交、推送、部署或重启服务。

已读取仓库约定、工程脚手架、应用 README、控制台 Spec 和第一阶段计价/系数规格，并通过 `https://api.github.com/repos/BenXueYou/ai-research-company/issues/42` 与 `/issues/42/comments?per_page=100` 实时只读核对完整正文与补充验收；评论为空。现有真实路由及组件作为基线，Open 状态未作为缺实现的证据。

## 契约对照（修改前后保持）

| 用户输入/选择 | 原来源及最终参数 | 本票行为 |
| --- | --- | --- |
| 最低加价率 | `pricing.minimumMarkup` 非空才发 `minimumMarkup` 原字符串 | 不补当前值/默认值 |
| 接口路径 | `pricing.interfacePath` 非空时才提交路径、单价、最大量、依据类型 | 不更改条件或字段映射 |
| 单价、最大量 | `pricing.upstreamUnitPrice`、`maximumBillableUnits` 原字符串 | 不数值转换、不剪裁 |
| 计价依据 | `pricing.evidence` 原字符串；类型默认 `supplier_verified` | 原枚举及默认值保留 |
| 计价幂等 | 按实际提交 payload 比较生成/复用 UUID requestId | 保留原策略，未知时锁输入，只能明确重试原请求 |
| 通知发布 | `form.coefficient` 原字符串、`new Date(form.effectiveAt).toISOString()`、`form.notice`、原 requestId | 成功后才换 requestId；未知时原上下文保留 |
| 系数生效 | `snapshot.changes[].id → activate(id) → {id}` | 不取通知 requestId、actorId 或组织ID，无兜底 |
| 服务端权限/持久化 | 原 ProcurementService、CoefficientService 事务及鉴权 | 未修改后端业务规则 |

本票增加公共 `useFormLeave` 登记：未提交取消保留、放弃恢复最近已确认表单；提交中禁止离开并锁定输入；未知结果确认离开后按限定缓存保留，不导航重放。计价/通知/生效均保留原幂等上下文，明确点击“重试原请求”才重发。读取失败和已确认写入后刷新失败分开处理，不把已确认写入当成未知。系数计时器在缓存停用时暂停，激活仅恢复时间，不发业务请求。设置页声明 name 以接入已有有限缓存。展示接口依据与版本。

## 专项测试资源与入口

- 测试：`application/tests/issue42-settings-real.spec.ts`；配置：`application/config/playwright/playwright.issue42-real.config.ts`。
- 编译：`node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/issue42-real-dist`。
- 前端：`node node_modules/vite/bin/vite.js build --outDir .scratch/issue42-real-web`。
- Playwright：`TEST_DATABASE_URL=<独立测试库> node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue42-real.config.ts`。
- 专用端口 3342；输出 `.scratch/issue42-real-results`；运行包装器随机创建 `issue42_<uuid>_test`，只对该名称模式清理，连接参数从已有环境读取且不打印。不清空共享/开发库、不占 dist/test-results。

## 公共集成

准确需求见 [ISSUE-42-INTEGRATION.md](ISSUE-42-INTEGRATION.md)。观察到公共会话已移除旧系数及采购兼容挂载，App 限定缓存包含 PlatformSettingsPage；本票未编辑这些公共文件。真实路由、兼容去重与 History 必须通过当前集成后的浏览器场景，不能以模块代码完成代替整票。

## 验证状态

- `vue-tsc --noEmit`：已通过（application 目录执行）。
- 专项后端/测试编译：已通过。
- 独立前端生产构建：已通过，现有 chunk 大小提示仍存在。
- 真实 HTTP/PostgreSQL 浏览器：生产构建入口与 Vite 开发入口各 1 场景通过，分别使用新建随机 `_test` 库且完成回收。覆盖实际参数、数据库结果、允许/拒绝、丢响应、幂等、外部调用计数及导航。
- 初次失败属于测试误用旧账号按钮、折叠菜单状态、旧菜单文案及无单价错误码预期；旧编译副本一度被递归发现，现配置排除 browser 旧副本。已按真实 UI/契约修正测试，不修改业务逻辑。一轮旧测试等待时中止了本票 worker，包装器仍回收专用数据库。最终结果以完成的专项运行及下列证据为准。
- `git diff --check`：本票组件及测试通过。

### 已执行业务结果

| 场景 | 实际观察 |
| --- | --- |
| 无单价 | 新候选报价 HTTP409，消息“尚无已核实的单价及最高计费量”，无上游账户调用；已有旧报价不作为无单价夹具 |
| 最低加价率 | 输入 `0.0200`、依据“合同42”；接口路径留空时只发 minimumMarkup/evidence/requestId，未补单价、最大量或类型 |
| 接口配置 | `/v2/company`、`2.1234`、`9`、supplier_verified、合同42 原字符串提交；落库分别 numeric 2.1234、integer 9，保存并展示依据和 UUID 版本 |
| 原价格请求丢响应 | 后端写入后中断浏览器响应；输入锁定；切页返回不 POST；明确重试相同 payload/requestId，pricing 流水总数保持2，不新增流水 |
| 生产受控价拒绝 | 使用真实登录 token 调用 `ProcurementService(pool,true)` 被“生产计价…”拒绝，未写入接口配置；此项为真实数据库服务验证，未启动 HTTPS production HTTP |
| 系数通知丢响应 | `0.5000`、ISO 时间和通知原值，requestId 与 change.id 不同；明确重试保留 requestId，只存在一条通知 |
| 覆盖不足 | 上游8点，生效409；当前X仍1.0000；只有显式生效触发上游查询 |
| 全链覆盖 | 平台余额4、分销3、终端3；预留1+1、查询冻结3均含余额中；三类pending锁定内部3，上游在途已扣0.5；正常敞口14、旧授权剩余2.5，合计16.5000 |
| 生效丢响应与重试 | 上游18点后成功；重试 id=changes[].id，命中已生效记录，不再调用上游；覆盖不足与成功两次操作合计上游调用2次 |
| 余额与旧授权 | 平台4.0000、终端3.0000不重算；已确认pending详情X仍1.0000；旧quoted详情标记expired |
| 未提交导航 | 菜单取消、后退取消、beforeunload均保留输入；确认放弃返回恢复空草稿；前进后退与账号设置返回无额外业务提交/系数GET |
| 提交中导航 | 延迟真实保存响应，菜单离开被阻止，输入禁用，释放响应后正常显示成功 |
| 权限及会话 | 分销/admin/sales深链被拒绝，计价写、通知写、生效写及系数管理读均403；三角色仍读到通知；临时账号强制改密不可绕过；重新平台登录不复用旧草稿 |
| 入口与去重 | 独立路由GET/刷新、HEAD200；设置页系数输入仅1份；返回限定缓存不重读系数；未知API404 JSON、缺失js404且无app HTML；开发入口采用本票5342 Vite代理3342 |

### 可复验命令与证据

在 `application/` 运行上述编译与前端构建后，执行 `node --env-file=.env scripts/verify-issue42.mjs`。脚本只借用 DATABASE_URL 的连接权限创建/回收随机本票库，将 TEST_DATABASE_URL 显式指向它，不初始化或清空源库。

开发验证先设置进程环境 `ISSUE42_DEV=1` 再执行同一包装器；测试配置启动本票5342 Vite，后端仍独占3342。生产构建模式不设置该变量，测试服务从 `.scratch/issue42-real-web` 提供页面。

机器可读证据：[生产构建入口](ISSUE-42-PRODUCTION-EVIDENCE.json)、[Vite开发入口](ISSUE-42-DEVELOPMENT-EVIDENCE.json)。含随机数据库名、区分的组织/账号/通知请求/通知ID、完整捕获载荷、版本、覆盖快照与调用次数；不包含密码、Cookie或连接凭据。

## 未验证边界

正式腾道与生产服务部署/运维未执行；真实供应商账户由受控 account 适配器代替。未启动 HTTPS production HTTP，生产受控价拒绝由真实服务与数据库验证。完整刷新后草稿恢复不在规格范围。尚未专项验证：设置页无业务查询参数的同组件 query 变化、未知状态时完整刷新关闭后的人工核实、真实网络中断/进程崩溃、并发多管理员改价；本票不改变这些业务规则。允许/拒绝、查询结果和金额验证仅限上表，不以本票宣称所有查询与采购全链功能均已回归。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动；同时应用 Vue 技能。
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021～027、030；GUIDANCE FCS-014、032；未修改依赖声明。
- 校验：类型检查与专项编译、构建已通过；测试见上；仓库未配置独立 lint/格式化脚本。常规 npm test、基础 integration 未执行，因为不覆盖本票且有共享产物/数据库风险。
- 冲突：无；存量规范债务：未扩大范围整理；PENDING 规则未提升执行，不需要阻塞本票澄清。

## 最终运行与产物说明

最终生产构建入口专项：`1 passed (15.7s)`；最终 Vite 入口专项：`1 passed (19.2s)`，均使用已归档的不同随机测试库，包装器正常回收数据库。后一次已等待最后登录后的计价/系数读取完成再关闭测试服务，避免开发代理在收尾时连接已关闭的3342。

本票尝试删除 `.scratch/issue42-real-*` 等可丢弃临时产物时，自动审批以 `blocked by policy` 拒绝且无更细原因；未绕过拒绝，产物保留在本票独立目录。未影响共享 dist、test-results、开发数据库或其他会话文件。测试文件因仓库全局忽略测试目录而使用 `git add --intent-to-add --force` 标记为可审阅差异，没有暂存文件内容、提交或推送。

## 2026-10-28 原型风格样式优化

本轮只调整 PlatformSettingsPage、PricingSettings、CoefficientChanges 的 template/style，逐文件对照 HEAD，三个 script 块均完全一致。参照 `原型设计/原型V2.html` 与设计说明，沿用浅灰 #f2f4f9、白卡片、蓝紫 #4356e0、细边框 #e6e9f0 及既有中文系统字体。增加页面标题与同组设置导航；桌面双列表单、窄屏单列；价格用可横向滚动表格展示依据/版本；系数通知历史采用分组记录。无新增请求、缓存或业务字段。

验证：application 目录 `vue-tsc --noEmit` 通过；专项 tsc 编译通过；Vite 独立 `.scratch/issue42-real-web` 构建通过（既有 chunk 大小提示）；`node --env-file=.env scripts/verify-issue42.mjs` 真实 HTTP/PostgreSQL 回归 1 passed (16.9s)，覆盖原请求字段、权限、覆盖16.5000点、幂等与调用次数、离开生命周期。该轮在本票编译后的测试副本末尾临时加截图/窄屏溢出检查，未改测试源：1440×1100与390×844截图已检查，窄屏 document 宽度未超过视口。截图位于 `application/.scratch/issue42-style-desktop.png`、`application/.scratch/issue42-style-mobile.png`。未进行部署或重启开发服务。

前端编码规范试点反馈：版本0.0.1，自动触发；使用 frontend-design 与 Vue 技能。应用 ACTIVE FCS-007/011/013/014/030；脚本未触及，不扩散整理。类型检查、构建、专项回归和 diff --check通过；未执行常规 npm test（不覆盖本票），无独立 lint/格式化脚本；冲突无，相关 PENDING不提升为执行约束。正式供应商及生产部署仍未验证。
