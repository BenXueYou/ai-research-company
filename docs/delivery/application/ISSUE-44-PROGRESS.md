# Issue #44 实现与业务验收

2026-10-28 18:18（Asia/Shanghai）续验。实时票据：[平台交易利润与账务流水页面](https://github.com/BenXueYou/ai-research-company/issues/44)，读取时为 open，已包含兼容容器退出补充验收。本票本地实现及适用业务验收完成：补齐开发深链，移除平台旧报表挂载与重复导航，公共面包屑布局回归通过。未提交、推送、部署或关闭线上票据。

## 基线与改动归属

- 基准提交 `04b85d8a4b72d05572004850cdd5d6c7f92812e3`，工作区已有大量其他任务的未提交修改。
- 承接已有 `PlatformReportPage.vue`、报表路由和 `reporting.ts`，没有重复实施页面。利润、流水分别为 `/platform/ledger/profit`、`/platform/ledger/flows`。
- 首轮只增量修改 `application/server/reporting.test.ts` 和本票交付记录。用户确认公共面包屑布局会话结束后，续轮为本票收尾在 `vite.config.ts` 增加两条报表路径、在 `CompatWorkspace.vue` 限制旧 `UsageReports` 仅供非平台角色使用、从 `App.vue` 移除重复的两条报表导航。没有改动公共布局外观、身份事件处理、Router、styles、server/app.ts、报表服务或 #38 账户摘要。
- 接手时 `reporting.ts` 已有客户及邮件读取范围的未提交调整，`PlatformReportPage.vue` 已移除页面内重复标题；这些是承接基线，不归因于本轮。本轮没有扩大统计范围、字段、导出边界或账务算法。
- 旧记录的构建与测试不作为本轮证据。本轮重新构建共享源码并执行真实后端、数据库和浏览器测试；最后验证的源文件哈希及实际 UUID 见 [验收证据](./ISSUE-44-EVIDENCE.json)。

## 契约对照

本模块只有读取和下载，没有选择后提交链路、幂等请求标识或业务表单。下表按迁移前 `UsageReports.vue`、`ReportingService` 与当前独立页核对；采购 POST 仅用于测试准备并验证账项，不是报表页新增操作。

| 链路 | 原有及当前参数来源 | 当前展示或结果 |
| --- | --- | --- |
| 页面读取 | `request('reports')` → `GET /api/reports`；无 query、无 body | 服务端使用 Cookie 会话中的 `identity.organization_id` 与角色确定授权组织树，不由页面传组织或账号 ID |
| 授权交易 | `point_orders.id/seller_id/buyer_id` | 利润页展示授权组织树内交易；订单 ID 与组织、账号、采购、费用 ID 刻意不同 |
| 销售毛利 | 明细来自授权卖方 `point_transfers`；平台汇总只求 `seller_id=identity.organization_id` 的 `gross_profit` | 明细含平台及分销订单，汇总平台 1.5000，不把分销 1.0000 再计入平台毛利 |
| 平台承担费用 | `platform_expenses` 主记录的 `amount` 求和 | 0.5000 + 0.2500 = 0.7500；同一费用关联两笔采购后仍为 0.7500 |
| 扣除后结果 | 平台销售毛利减平台承担费用 | 1.5000 − 0.7500 = 0.7500；不称净利润 |
| 库存、采购与费用流水 | `platform_inventory`；`procurement_ledger.id/reference` 原样显示 | 流水数字 ID 与业务引用 UUID 分列；采购引用采购 ID，费用事件引用费用 ID，不替换成凭证号或费用来源 |
| 扣点流水 | `product_search_ledger.id/page_id` → `id/referenceId`（其余既有 detail/contact 分支不变） | 两个企业、两条查询不同引用；展示流水 ID、业务引用、组织、事件和点数，不混用 ID |
| 导出 | 原链接 `/api/reports/own-ledger.csv`，无参数；服务端按会话范围取自有账务 | 两页浏览器下载文件相同；平台只导出采购流水及平台自身销售，不含分销销售、查询关键词或客户邮件内容 |

CSV 保持 UTF-8 BOM、双引号包围、CRLF、文件名 `own-ledger.csv`；七列如下。浏览器文件与真实 HTTP 响应核对（`fetch.text()` 会去除 BOM），再逐列对独立 SQL 读取结果断言，而非仅搜索关键词。

| CSV 列 | procurement 行数据库来源 | sale 行数据库来源 |
| --- | --- | --- |
| type | 固定 `procurement` | 固定 `sale` |
| reference | `procurement_ledger.reference` | `point_transfers.order_id` |
| event | `procurement_ledger.event` | 固定 `transferred` |
| amount | `cash_outflow` | `sales_amount` |
| balance_or_cost | `balance_after` | `sales_cost` |
| frozen_or_gross | `expense_delta` | `gross_profit` |
| created_at | `String(created_at)`，保持现有序列化 | `String(created_at)`，保持现有序列化 |

最终文件为表头加六条数据：三条采购、两条费用事件和一条平台销售。费用事件的 `amount` 为 0，其费用值在 `frozen_or_gross`；这是既有导出契约，没有新增费用列或调整列义。

## 本轮实际执行

环境为 Windows、Node、真实 PostgreSQL 与 Playwright Chromium。HTTP 独立端口 `3344`；使用本地 PostgreSQL `55433` 的连接凭据连接维护库 `postgres`，每轮新建随机 `issue44_<uuid>_test`，仅在该库执行 migrate 和写入，finally 关闭自身服务并删除该随机库。不清空、迁移或读写另一任务业务库。`.env.issue44` 为本地被忽略的专用连接配置，不入库交付。

在 `application/` 执行：

```powershell
npm run typecheck
npx tsc -p tsconfig.server.json --outDir .scratch/issue44-dist
npx vite build --outDir .scratch/issue44-web
node --env-file-if-exists=.env.issue44 node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.server.json --test server/reporting.test.ts
```

以上均通过。最终端到端测试 1 项通过、0 失败，包含以下业务断言；不是单纯挂载或快照测试。Vite 仍有既有大 chunk 提示，未据此扩大本票改造。

- 平台两页直达、刷新、侧栏点击、浏览器后退及前进；生产静态入口合法路径 GET/HEAD 返回页面，未知 API、未知路径和缺失静态文件保持 404。
- 利润页显示平台/分销不同订单、费用 ID 与原金额，统计 1.5000/0.7500/0.7500；本页不展示客户与邮件内容，也不出现“净利润”。
- 流水页逐格核对采购流水 ID、业务引用、事件、内部/上游点数、现金、费用及余额；对照不同企业查询流水引用及点数。
- 两页均实际点击下载 CSV，逐列对照上述独立 SQL；排除分销销售订单、费用来源字符串、采购凭证字符串及查询关键词，保留业务引用字段。
- 两次真实 `POST /api/procurement/purchases` 关联同一费用：采购 ID 分别不同且与费用 ID 不同；每次相同 requestId 重试返回相同结果，新 requestId 配合重复凭证返回 409，无额外采购或流水。重复费用来源由唯一约束拒绝。另有销售采购生成内部库存 10.0000，均价 1.2500；补损采购不生成内部库存、不新增费用事件。
- 报表浏览期间捕获的 API 请求均为 GET，`/api/reports` 无查询参数；读取、刷新、下载和导航没有增加采购流水。所有角色与改密场景结束后仍只有三笔采购、五条采购/费用流水，毛利及费用汇总不变。
- 分销、企业管理员、业务员分别直达两页均回到各自合法默认页且不挂载平台报表。直接 HTTP 的 `/api/reports` 沿用各自合法范围，不返回平台 totals/procurement/expenses；该接口本来允许这些角色使用，不能为了验收改成统一 403。管理员/业务员 CSV 均 403；分销 CSV 为其自有范围 200，不含平台费用或客户内容。
- 未登录读取报表或导出均 401；平台强制改密期间两接口均 403。
- 同一浏览器真实登录、退出与切换顺序：平台 → 分销 → 企业管理员 → 业务员 → 平台。默认路径正确，退出后平台报表被移除，非平台不显示平台流水链接。
- 平台强制改密直达利润、流水、帮助和账号设置均停留改密界面；实际完成改密，旧 Cookie 访问变为 401；用新密码登录后再进入利润页正常。

本次采购通过真实本地 HTTP/数据库入账；报表不调用供应商接口。未发送正式邮件、未使用正式供应商账号。原始下载与运行证据保存在 `application/.scratch/issue44-results/`；无密码、Cookie 或密钥写入交付 JSON。

## 公共框架接入续验与生命周期

用户确认公共面包屑布局会话已结束后重新读取当前源码及实时票据。当前 HEAD 仍为上述基准，布局成果以共享工作区未提交修改存在；不虚构已落地的新 commit。

- 原 Vite 缺口已修复：只向现有白名单加入利润和流水路径。专项测试在 `3444` 自行启动 Vite，代理至本票 `3344` 真实后端；Chromium 以真实 Cookie 直达并刷新两页均通过。未知 API、缺失 JS、未知前端路径均 404。Vite 在 finally 关闭，没有重启用户开发服务。
- 平台旧 `UsageReports` 挂载已退出：从概览剩余兼容工作区进入利润页，旧 `.usage-reports` 实例数量始终为 0，报表读取恰好增加一次，不会隐藏保留第二份平台报表。分销及终端仍依赖原组件，原 HTTP/浏览器账务断言继续通过；保留其 `compat-usage`、target 与共享导入。
- App 原有 `/platform/ledger` 条件导航已移除；报表入口统一来自现有侧栏路由元数据，没有增加业务路由或页面缓存。
- 利润/流水页的唯一菜单高亮、当前面包屑、无重复页面 h1、切页、前进后退均通过。真实账号菜单进入设置再返回利润页，仅发生一次重新读取，没有业务写请求；报表页属于只读页面，离开销毁、返回读取，无草稿或未确认提交。相同报表组件的 kind 切换仅切换展示，复用现有已授权快照，不新增自动重试或收费操作。
- 四角色登录切换、无权深链、HTTP 范围与导出、强制改密、改密旧会话失效及两页 CSV 下载逐列对照均在当前新构建上重跑通过。
- 最终专项测试 1 项通过、0 失败，实际耗时约 18.5 秒；类型检查、隔离服务端编译及 Vite 构建通过。中间两次测试因新增用例未展开侧栏分组而超时，修正测试操作后复跑通过，不作为产品失败或通过证据。原始 CSV/JSON 保存在本票 `.scratch/issue44-results/`，持久证据已更新。

仍有分销/终端业务与平台采购/系数依赖兼容容器，因此保留 `CompatWorkspace`、`workspaceVisited`、`isCompatPath` 及其共享逻辑；本票完成不表示全局兼容容器退出。#38 摘要读取及完整业务流程未在本票验收。

## 未验证范围

正式供应商联调、生产反向代理、生产数据及部署未验证。扣点浏览器夹具直接覆盖 product 来源；detail/contact 的查询执行、退款业务创建与端到端费用确认未重新执行。采购和订单创建页面、完整履约/退款流程未重新验收，订单历史数据通过独立 SQL 准备。未执行 Firefox/WebKit、全套无关测试及部署测试。以上保留边界不代表修改或完成其他票。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动；同时使用 vue 技能。
- 应用规则：触及区域 ACTIVE MUST FCS-007、011、030；GUIDANCE FCS-032（不新增全局状态）。其他 ACTIVE 规则未引入对应变更，依赖与工程格式配置不变。
- 校验结果：`npm run typecheck`、隔离 tsc/Vite 构建、真实 HTTP/PostgreSQL/Chromium 专项通过；lint/formatter 未执行，package.json 没有相应命令；全套无关测试与部署测试未执行，范围不适用。
- 冲突：无。存量规范债务：未触及区域保留现有格式，不扩大修改。
- PENDING：未提升任何待定规则，本轮删除导航与增加角色条件不依赖其裁决，无需澄清。

历史记录曾记载此前误执行默认 `.env` 的 `npm run db:migrate`；该事实仍保留，影响未由本轮追溯确认。本轮没有再次执行该命令，初始化只作用于自身新建随机测试库，未重启共享开发服务，也未改写已有 `.scratch/t28-web` 生成物。
