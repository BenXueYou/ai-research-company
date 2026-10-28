# #41 平台采购与承担费用

状态：本地实现及真实浏览器验收完成。公共收尾会话已完成路由、缓存、兼容挂载移除及 History；本票随后直接对已集成源码验证通过。未部署、提交、推送或改远端工单。集成核对见 [交接](ISSUE-41-INTEGRATION.md)。

## 基线与远端验收

2026-10-28 实时读取 GitHub BenXueYou/ai-research-company #41 正文（含兼容容器退出补充），comments 列表为空。`gh` 不存在，使用公开 GitHub REST API 只读获取；无远端修改。开始时 `git status --short` 为空，此后其他会话并行工作，保留其文件。

原 `PlatformProcurement.vue` 由 CompatWorkspace 仅平台条件挂载；包含采购、费用、重复计价表单；`PlatformSettingsPage` 已有完整计价入口。采购服务及 schema 已实现真实账务，不能从 Issue Open 推断未实现。

## 改动前契约

| 操作 | 用户字段/来源 → 最终请求 | 服务端及结果 |
| --- | --- | --- |
| 采购 | purchase.purpose（默认 sale）、upstreamPoints、amount、receiptReference、evidence 原字符串；仅 purpose != sale 且 expenseId 非空提交下拉选中的 expenses[].id | purpose 枚举 sale/coverage/failure/excess；X 从 platform_pricing 读取并快照，销售才生成库存与移动加权成本；失败/超额须关联已有同用途费用 |
| 费用 | expense.purpose（默认 failure）、amount、sourceReference、evidence；三个损耗标识各自非空时原值提交 | detailLossQueryId/contactLossQueryId/productLossPageId 分别查询不同损耗表，最多关联一个；用途匹配；费用来源与损耗唯一约束，不进入销售库存成本 |
| 幂等 | 每 operation 保留 payload JSON 与 UUID；相同载荷结果未知重试复用原 requestId，编辑后新 UUID | procurement_requests 核对 actor、operation、完整 JSON；相同返回原结果、不同拒绝，无重复流水 |
| 读取 | GET procurement，无 query 业务参数 | 系数、库存、费用、关联采购、差额及账务均为服务端快照 |

本票不修改 commerce 服务、schema、金额规则、取值来源、损耗枚举、校验及权限。计价配置由 #42 承载。


## 实际实现

- `/platform/ledger/procurement` 真实路由渲染 `PlatformProcurement`，导航为“点数与账务 / 采购与费用”，角色仅平台；旧 `compat-settings` 采购挂载及导入已移除。上述公共文件由公共收尾会话编辑，本票只核对和验收。
- 采购页删除重复计价表单和接口单价列表；完整计价入口在 `/platform/settings`，由 #42 维护。保留服务端系数、加价率、库存及最低售价显示，便于核对。
- `useFormLeave` 统一管理 clean/dirty/submitting/unknown。草稿放弃恢复最近确认的表单基线；提交时禁用编辑并阻止离开；未知结果保存原载荷和 UUID，经确认离开后限定缓存保留，不自动请求。
- `pending` 保持每 operation 相同载荷复用 UUID、编辑后新 UUID 的旧规则；另保存所有未确认 attempt，允许在新草稿已编辑时主动核对旧请求。核对旧请求不会将新草稿误标为已提交。
- 只在用户点击“使用原请求核对”时重发原始载荷与 requestId。服务端幂等使已入账请求返回原结果。采购/费用失败均保留输入；确定拒绝仍为草稿，网络错误及 5xx 视为结果未知。
- 写入成功与后续读取失败分开处理，提示“已记账，账务刷新失败”，不将读取失败当作写入结果未知。
- 保持原条件性字段、默认 sale/failure、金额字符串、采购费用选择来源及三个独立损耗字段；没有改动服务、schema 或业务规则。页面无 query 参数取值，无跨组件事件依赖。

## 真实参数与业务结果

最新完整证据：[ISSUE-41-EVIDENCE.json](ISSUE-41-EVIDENCE.json)，包含每次浏览器写请求（含拒绝与幂等重试）、不同标识、最终服务端快照、采购、费用和全部流水。后端查询损耗使用专用库夹具，未调用真实供应商生成损耗。

| 前后契约核对 | 本次实际输入/来源及结果 |
| --- | --- |
| 销售采购 | 表单 sale、upstreamPoints=`10`、amount=`40`、receiptReference=`SALE41`、evidence=`supplier receipt verified`；无 expenseId。X 从库读取 `3.0000`，未由客户端提交；生成 `30.0000`，初始库存 10、成本 2 → 余额 40、成本 1.5000；重复点击沿用同一 UUID，仍一笔采购 |
| 详情损耗 | 用户填 `b863087a-80d3-4fd2-a82f-f9ac127bcdd3` → detailLossQueryId → platform_expenses.detail_loss_query_id；费用 ID 为 `97f859ad-58ea-496a-96a9-c165ec44c9b8` |
| 联系人损耗 | 用户填 `28dfbf7e-eac4-4a08-99bf-eb9921b73e35` → contactLossQueryId → contact_loss_query_id；费用 ID 为 `8a38e278-a74b-46ca-a1c8-aaac5f778db9` |
| 产品名单损耗 | 用户填 `4aef74aa-1421-4a62-98ea-d605a14da965` → productLossPageId → product_loss_page_id；费用 ID 为 `13d12d7b-5010-498f-a5e8-9f84954f47f0` |
| 关联充值 | 下拉选择 expenses[].id 原值 → expenseId；failure 费用 7 关联两笔各 5 元充值，replenished_amount=10、reconciliation_difference=3；费用仍只确认 7，不增内部库存或销售成本 |
| 补足额度 | coverage 采购 9 元，不选费用、不提交 expenseId，服务端按原规则新增承担费用；不增库存 |
| 未知采购 | LOST41 已提交并真实落库后丢失响应。等待中阻止导航；未知后切页返回 0 新读写。草稿改为 NEW-DRAFT41 / 99 元后，主动核对仍发旧 LOST41 / 40 元和原 UUID，新草稿继续保留 |
| 未知费用 | EXPENSE-LOST41 / coverage / 7 元已提交后模拟 503；切页返回 0 新读写；主动核对原 UUID，最终仅一笔费用 |
| 最终账务 | 6 笔采购、5 笔费用、11 条流水；上游累计 60、采购支出 104、费用 37；库存余额 70、冻结/预留均 0、移动加权成本 1.4286、最低售价 1.4429；供应商调用审计 0 |

拒绝验证：同一损耗另一个来源重复登记 → 409；用途不一致、一次关联两个损耗、failure 采购未选费用、错误用途关联、sale 采购带费用 → 400；同 UUID 改金额 → 409；分销/管理员/业务员采购读取和采购/费用写入均 403，前端深链重定向且无采购页。初始平台强制改密会话读取采购 403。

## 实际验证与环境

Windows / Node 22，PostgreSQL 17.6 Alpine 独立容器 `codex-issue41-20261028`、数据库端口 55441；每次测试随机创建并只删除自己的 `issue41_<uuid>_test` 库。最新库名为 `issue41_bdb99282f81c41259351ba98d412f042_test`。真实 Nest HTTP 端口 3441；专项开发入口检查端口 3442。未清空共享/开发库、未启动或重启用户应用。

在 `application/` 下执行：

```powershell
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit
node node_modules/typescript/bin/tsc -p config/tsconfig.issue41.json
node node_modules/vite/bin/vite.js build --config config/vite.issue41.config.ts
# TEST_DATABASE_URL 显式指向可创建测试库的独立 PostgreSQL，库名须以 _test 结尾。
node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue41.config.ts
```

- 前端及服务端专项类型检查：通过。无新增依赖，无现成 lint/format 脚本。
- 专项构建：通过，产物仅 `.scratch/issue41-web` 与 `.scratch/issue41-dist`；已有单包大小提示仍存在。
- 最终 Playwright：`1 passed (12.2s)`，真实浏览器驱动后端/数据库，未使用 API mock 成功数据。仅故障注入拦截响应，实际请求仍经真实后端提交。
- 已覆盖菜单取消/放弃、浏览器前进取消/放弃及后退返回、生产深链直达与刷新、单实例/首次一次读取、返回零额外请求、提交中阻止离开、两个操作的未知结果及原请求幂等核对、提交成功后刷新失败、同浏览器退出换业务员再回平台清空缓存。
- Vite 开发入口 HEAD：`/platform/ledger/procurement` 为 200 text/html；`/assets/missing41.js` 与 `/unknown41` 为 404。生产未知 API/缺失静态文件同为 404。专项 Vite 检查完成后已关闭独立进程。
- 首次沿用 `.env.test` 时因 55432 未运行出现 ECONNREFUSED，随后改用本票独立容器并完成实际通过验收；不将首次失败写成通过。早期内存集成演练通过后已删除临时变换；最终测试无替换 router、App、兼容容器或后端 History。
- `git diff --check` 本票文件通过。未运行 npm 默认测试/全量集成，因为未覆盖本次链路且默认入口可能使用共享 dist/库；已用专项真实流程替代。

## 公共集成与边界

公共集成已核对且被最终测试直接覆盖，无待接入的本票路由项。本票没有编辑 App、router、layout、公共样式、server/app、vite.config、package.json 或锁文件。其他分销/终端兼容模块仍存在，不宣称全局兼容容器退出。

未验证：正式供应商账单/生产采购和部署；跨刷新恢复未知结果（规格明确不承诺持久化）；本票不重测完整系数生效流程、最低加价率配置、全部订单履约或其他票所有角色业务。三类损耗为有真实 FK 的测试夹具，本票未重新触发其上游查询过程。全局首次会话网络竞态、强制改密 UI 完整矩阵由公共收尾会话负责，本票覆盖采购准入拒绝及实际账号切换清理。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动（Vue 3 修改）。同时应用 vue 技能。
- 应用规则：ACTIVE MUST FCS-007/011/013/019/021～027/030；GUIDANCE FCS-014、032（局部表单保留页面状态）；VERIFY 按已有 package.json 与 tsconfig 入口执行。
- 校验结果：vue-tsc、专项 tsc、专项 Vite 构建、Playwright、diff whitespace 检查通过；lint/format 未执行（项目无脚本），默认 npm test/全量集成未执行（不覆盖本链路且共享产物边界不安全）。
- 冲突：无；存量规范债务：无本票额外整改。
- PENDING：FCS-001～006、008～010、012、015～018、020、031、033～035 未擅自提升执行；沿用既有组件名称及脚本先于模板的布局，不需要澄清。


## 测试资源收尾

每次随机业务测试库均已由测试 finally 删除。自动审批拒绝了删除 `.scratch/issue41-*` 临时产物与移除本票测试容器的合并清理命令，仅返回 `blocked by policy`，未执行删除。改用较温和的 `docker stop codex-issue41-20261028` 已成功；容器保留但已停止，临时产物保留在本票专属目录，正式证据已复制至本文同目录。未操作其他会话或用户服务。


## 风格 B 页面优化（2026-10-28）

按 `原型设计/原型V2-设计说明.md` 的 B 布局方向和既有浅色工作台视觉 tokens 优化采购页，仅修改 `PlatformProcurement.vue` 模板分区与 scoped CSS：

- 顶部改为标题、业务层级眉题、说明和刷新动作的横向页头。
- 库存、成本、费用和余额摘要改为 4 列白色指标卡，数字使用等宽数字与单位层级。
- 采购入账与承担费用保留双栏操作区，输入框、下拉框和按钮统一为细边框、蓝紫焦点与 7px 控件圆角。
- 费用、采购、账务流水分别使用白色数据卡和计数标签，表头浅灰、悬停浅蓝紫，移动端自动折叠为双列摘要并保持表格横向可滚动。
- 颜色沿用风格 B：浅灰蓝工作区、`#fff` 卡片、`#4356e0` 强调色、`#e6e9f0` 细边框、Segoe UI / Consolas 数字；没有新增状态判断、请求、字段或业务文案契约。

校验：`vue-tsc --noEmit`、专项 Vite 构建和 `git diff --check` 通过；Vite 产物仅写入 `.scratch/issue41-web`。真实业务专项之前已通过，本轮未改动脚本，因此未重跑数据库流程。
