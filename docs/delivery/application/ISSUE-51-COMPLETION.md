# Issue #51 分销交易利润与自有账务页面

2026-10-28（Asia/Shanghai）。本地实现与适用业务验证完成；实时 [Issue #51](https://github.com/BenXueYou/ai-research-company/issues/51) 读取时为 Open，已读取正文与兼容容器退出补充验收。未更改远端工单、提交、推送、部署或重启用户服务。

## 基线、职责和改动

核对了 AGENTS.md、工程脚手架约定、application/README、控制台迁移 Spec v1.2、第一阶段 Spec 的分销范围与 AT-05/06、PRD R37～R44/R66/R67、T28 与 #44 交付、`UsageReports.vue`、`ReportingService`、CommerceController、路由及兼容容器。基准 HEAD 观察值为 `2bf193c`，共享工作区在并行实施；本票没有 reset、stash、覆盖其他业务组件或操作共用测试库。

原 `/distribution/profit` 是 `EmptyRoute` + `compat-usage` 定位，由 `CompatWorkspace` 为分销挂载旧 `UsageReports`。后端已有完整分销报表及自有 CSV，故没有重复开发或修改报表服务、金额/成本算法、订单状态或导出字段。

本票新增：

- `application/web/pages/reports/DistributionProfitPage.vue`：独立只读页面。
- `application/web/pages/reports/components/DistributionReportTable.vue`：仅本模块使用的表格，保留缺失值提示与窄屏横向滚动。
- `application/web/api/distributionProfit.ts`：同一 `reports` 读取适配与报表类型，验证响应角色，不新增接口或参数。
- `application/tests/issue51-profit.spec.ts`、本票 Playwright 配置、隔离 PostgreSQL runner、本记录及 [脱敏证据](ISSUE-51-EVIDENCE.json)。根 `.gitignore` 仅追加本票测试源码和隔离产物规则。

公共文件仅接入本票：router 导入并渲染真实页、移除本模块 target；App 的兼容路径排除加入 `/distribution/profit`；CompatWorkspace 删除分销 UsageReports 挂载及无剩余调用的导入。每次修改前读取最新内容，保存后核对 #48/#50 路由、缓存名和其他已迁移角色页仍在。未修改两票业务组件、公共样式、Nest/Vite 装配、#40 订单规则或平台报表。共享 diff 中的其他票文件与改动不归属于本票。

终端已由 #59 独立承载，没有剩余旧 UsageReports 挂载；历史源文件保留但不被本票导入。CompatWorkspace 仍含终端 SMTP/U-Mail 设置及系数通知，App 的共享 `workspaceVisited`/`isCompatPath` 继续保留，本票不宣称全局退出。没有新增手写导航或滚动定位。

## 迁移前后契约

本链路为只读查询与下载，没有用户选中后业务提交、请求幂等标识或业务草稿。没有把多层账户查看范围当成跨级交易或下级明细权限。

| 链路 | 修改前及修改后来源和最终请求 | 服务端/页面结果 |
| --- | --- | --- |
| 页面读取 | `request('reports')` → `GET /api/reports`，无 body、query 或客户端组织 ID | 角色与 `identity.organization_id` 来自当前会话，服务端推导授权组织树 |
| 账户及组织 | `organizations.id/parentId/active/depth`；账户 `organizationId/balance/queryFrozen/salesReserved/available` | 展示已有范围与停用历史，不相加账户、不重算余额；组织名只由响应中的匹配 ID 取得，保持 ID 兜底 |
| 交易 | `point_orders.id/seller_id/buyer_id` → `id/sellerId/buyerId` | 分销仅 `seller_id=当前分销组织`，一级可看二级账户及用量，但不因此看到二级自有订单 |
| 自有毛利 | `point_transfers.gross_profit` 求和，卖方限定当前组织；明细 sales 原快照 | 一级 5.0000 + 6.0000 = 11.0000；二级 8.0000；旁支 13.0000，不混入平台销售或下级毛利 |
| 查询及邮件用量 | 三类流水 settle 按授权树组织/source 分组；`email_daily_usage` 的日期、reserved/used | 只显示汇总，保留来源与四位小数，不读取或展示查询词、客户、联系人、邮件正文 |
| 自有流水 | detail/contact/product 各自 id 与 query_id/page_id → `id/referenceId`；只取当前组织 | 原事件、金额、余额、冻结与时间，不把流水 ID、查询 ID、档案 ID、上游 ID 互换 |
| CSV | 原 `/api/reports/own-ledger.csv`，无参数，`own-ledger.csv` 文件名；成功读取报表后显示下载入口 | 服务端继续只输出自有三类流水和当前分销售出快照；UTF-8 BOM、CRLF、双引号包围和七列表头不变 |

CSV 每列逐项对照独立 SQL：

| 列 | 自有查询流水 | 自有 sale 行 |
| --- | --- | --- |
| type | detail/contact/product | sale |
| reference | query_id 或 page_id | order_id |
| event | 原 event | transferred |
| amount | amount | sales_amount |
| balance_or_cost | balance_after | sales_cost |
| frozen_or_gross | frozen_after | gross_profit |
| created_at | 原 created_at 的 String 序列化 | 同左 |

夹具采用不同组织、账号、买卖双方、订单、搜索、候选、详情查询、档案、联系人查询、产品页与上游标识。上游 detail.id=`upstream51`、fileId=`different51`、内部档案 UUID 彼此不同；它们均不进入分销报表。三类流水各自的数字 id 与查询引用分列，页面没有新增业务 ID 选择或替换规则。实际非秘密 UUID、原响应及两级 CSV 行见证据 JSON。

既有 `?organizationId=其他组织` 会被报表接口忽略，仍按会话返回原范围；本票保留这一契约，不能将它描述为接口 403。真正的跨级与跨组织划拨探针均返回 403，且业务表未变。通用 `GET /reports` 原本允许平台及终端本企业读取；本票没有为了路由拒绝而把整个接口改成仅分销可用。

## 生命周期

报表只读、没有未知业务提交，所以不加入 KeepAlive、表单离开保护或重试。页面离开销毁，返回或刷新重新读取；同一组件内无业务语义的 query 更新复用已有快照，不额外读取。刷新先清空旧报表，失败显示错误，不保留旧金额；字段 null/undefined/空字符串显示数据缺失，缺少账户行不补零。读取中禁用重复刷新。

会话 generation 沿用现有 store 隔离，组件卸载标记阻止迟到响应回填。测试把真实报表响应延迟到退出并在同一文档登录二级分销后才释放，旧一级订单与毛利没有回填。无 localStorage/sessionStorage 或跨刷新缓存，也没有浏览器关闭后的草稿恢复承诺。只读请求未知时通过刷新核实，不自动调用收费接口、取消、退款或写入账务。

## 实际验证

Windows、Node、真实 PostgreSQL 17.6 Alpine、Playwright Chromium。runner 自建随机名 Docker 容器和随机回环 PostgreSQL 端口，仅将运行期随机密码注入环境，不回显连接串；测试在容器内创建 `issue51_<随机UUID>_test`，结束后关闭自身服务、删除该随机库及自建容器。没有清空用户库或共享测试库。

本票独占 HTTP 3351、Vite 5351 及其后端 4351；编译、前端构建、浏览器产物均位于 `application/.scratch/issue51/`。没有写入共享 dist/test-results，也没有写其他票交付文件。

在 `application/` 实际执行：

```powershell
npm run typecheck
npx tsc -p tsconfig.server.json --outDir .scratch/issue51/compiled --incremental false
npx vite build --outDir .scratch/issue51/web
node scripts/verify-issue51.mjs
```

最终均通过；完整专项 **1 passed (23.5s)**。Vite 保留现有大 chunk 提示，未据此扩展拆包范围。最终自身源码及构建入口哈希写入证据。

- 一级报表组织范围为自身、二级分销、二级直属企业、一级直属停用企业；二级只含自身与其直属企业。旁支不进入账户/用量/组织响应。停用企业状态和历史可见，不改停用规则。
- 一级授权交易与 sales 只含一级两个卖出订单，毛利 11.0000；二级为一个卖出订单、8.0000；旁支为 13.0000。平台卖出、下级交易及其他分支不混入自有毛利和 CSV。
- 两级浏览器实际下载，校验文件名、BOM、全部七列；独立 SQL 分别读取三类流水及 point_transfers 逐行逐列相等，同时与真实 HTTP 下载正文一致。无客户/邮件字段、上游 detail/fileId、私有查询词或邮件正文。
- 一级伪造旁支 organizationId、二级伪造上级 organizationId 均保持会话原范围。二级请求上级与旁支订单划拨均 403，未扩大交易权限。
- 浏览器登录/退出并在同一文档切换一级→二级→平台→终端管理员→业务员→旁支分销；无本页旧数据残留。平台/终端两角色直达分销页回到合法默认页，不挂载分销报表；终端 CSV 403。匿名两接口 401，组织停用后的读取 401，强改期间两接口 403、页面只显示改密。实际完成本人改密，旧 Cookie 读取 401。
- Nest 静态与 Vite 开发入口直达、刷新均正常；帮助页往返、后退/前进、账号设置返回、唯一侧栏高亮与面包屑通过。query 通过路由更新回到相同组件不增加读取；账号设置返回只新增一次读取。
- 真实数据库临时移走 point_transfers 表使读取失败：旧毛利与表格消失、错误可见，恢复后刷新恢复；删除自有账户记录不显示原余额或伪造零，恢复后业务快照一致。
- GET reports 均无请求 query/body；页面导航、读取、下载产生的业务写请求为 0。两次故意直接 HTTP 划拨拒绝探针单独记录，不算页面提交。17 张库存/订单/账务/查询/邮件业务表前后完整快照相等，受控企业搜索/详情/联系人/产品名单适配器调用为 0；没有正式扣费或发信。
- 桌面 1280 与手机 390 宽度已截图目视核对，手机表格在各卡片内横向滚动，文档宽度不超过视口。截图保存在本票 scratch，未收录真实凭据。

中间失败未计作通过：先修正测试 BOM 比较与 APIRequestContext 请求不触发 page request 事件的断言；开发入口期间曾遇并行修改中的平台报表缺闭合标签，未覆盖该文件，待其恢复后重建；Vite 登录输入可见性等待曾超时，补充显式界面等待及 pageerror 观测后最终整套通过。未将这些运行解释为业务权限或账务变更。

## 未验证范围

未部署、未使用正式腾道/SMTP/U-Mail、未验证生产 HTTPS/反向代理、生产多实例、Firefox/WebKit、大数据量分页或报表性能。未重跑完整开户、定价、下单、缺库存收款/预留、真实划拨退款、收费查询结算与邮件投递；本票用历史 SQL 夹具核对读取，不将其当作这些创建流程的再次验收。强改成功后的新密码重新登录、浏览器彻底关闭后的恢复和所有角色切换排列未在本票单独穷举。#48/#50 与平台报表的具体业务验收归相应票；本票保留它们的接入。

未发现需混入本票的业务规则修复；既有范围和金额算法保持。未修改公共规格汇总，依据本票执行边界只新增本票交付及证据。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1。
- 触发：自动；同时读取并应用 `.agents/skills/vue` 技能。首次误读 `.codex/skills/vue` 不存在，随后按可用技能目录纠正，没有跳过技能。
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021～027、030；GUIDANCE FCS-014、032。没有依赖新增或变更，FCS-028/029 无对应改动。
- 校验结果：`npm run typecheck`、隔离 tsc、隔离 Vite、真实 HTTP/PostgreSQL/Chromium 专项通过；共享接入 `git diff --check` 通过。lint/formatter 未执行：package.json 无相应命令，未引入自定义扫描器或修改配置；全量无关测试和部署测试未执行，超出只读迁移范围且后者可能写真实配置库。
- 冲突：无；沿用已有目录及文件命名，不擅自提升 PENDING。
- 存量规范债务：未触及区域保持，不审计或格式化其他票代码。
- PENDING：FCS-001～006、008～010、012、015～018、020、031、033～035 未用于改变实现或审批，无需澄清。
