# Issue #49：分销下级点数摘要与授权多层账户

日期：2026-10-28（Asia/Shanghai）。本地实现与验收完成；未部署、重启用户服务、提交、推送、关闭票据或调用正式供应商。

## 基线、规格及范围

基准 HEAD：`2bf193c186d40c939494d317d40eafb459d9dd0e`。开始时工作区已有 #48/#50/#51 及平台、终端的未提交成果；以当前文件为基线增量实施，未 reset/stash 或覆盖其他任务。读取 AGENTS.md、工程脚手架、应用 README、控制台迁移 Spec v1.2、第一阶段 Spec、PRD R38–43/R71/R76、#48 交付及实现、#38 交付、平台摘要组件和 reporting 契约。实时从 GitHub API 读取 [#49 正文及补充验收](https://github.com/BenXueYou/ai-research-company/issues/49)，评论数量为 0。远端 Open 未被当作未实现依据。

本记录也是控制台迁移 Spec 中分销下级账户入口的实施补充：默认 `/distribution/organizations` 在直属列表显示四项摘要；`/distribution/organizations?view=accounts` 独立承载授权多层只读账户。query 只控制视图，不作为 API 组织参数。

本票修改范围：

- `application/web/pages/organizations/DistributionOrganizationsPage.vue`：复用 #48 页面增加账户子视图、直属摘要、读取状态和当前子页高亮。模块组件沿用组织域内部 `components/PointAccountSummary.vue`，未修改该组件、平台组织页或 reporting 服务。
- `application/web/layout/ConsoleBreadcrumb.vue`：在 #48 已有平台/分销共用分支内，仅将 `view=accounts` 识别扩大至分销路径；保留其他会话变更。
- 本票测试、Playwright/Vite/隔离编译配置、`scripts/verify-issue49.mjs`、根 `.gitignore` 本票测试白名单及私有产物排除，以及本记录和 `ISSUE-49-EVIDENCE.json`。

请求仍复用页面既有 request 适配，未为传递一个既有 GET 人为增加适配层或全局组件。App、Router、Nest/Vite History 已由 #48 支持同一路径，无需重复接入。开始核对时 CompatWorkspace 仅剩系数通知及终端 SMTP/U-Mail；分销组织原挂载已由 #48 移除，无本票旧挂载需要再删。本批 #57 仍并行处理设置及兼容退出，本票不承担其公共清理，也不宣称全局兼容退出完成。

## 契约前后对照

| 链路 | 修改前来源和契约 | 修改后及实际证据 |
| --- | --- | --- |
| 直属范围 | GET organizations → children，仅直属，含组织 id 和独立 accountId | 保留原列表；`child.id` 查找 `reports.accounts[].organizationId`，不用管理员 accountId |
| 四项账户 | GET reports 返回 balance/queryFrozen/salesReserved/available 字符串 | 原字符串逐项展示；前端不 Number 转换、不舍入、不重算、不合并上游库存 |
| 可用余额 | 服务端既有 `balance-query_frozen-sales_reserved` | 222.2345−22.0002−4.0003=196.2340；停用叶子333.3456−33.0003−5.0004=295.3449 |
| 多层范围 | reports 从当前会话 organization_id 递归读取，含自身和停用后代 | 仅显示 depth>0，排除自身，保留授权多层与 active=false；父名称按同一授权集合 parentId 查找 |
| 请求及授权 | GET reports 无目标组织参数，服务端从身份确定树 | 保持无请求体/无 URL 目标参数；一级 A、二级 A2、另一一级 B 三套真实身份分别验证正确树，不可借 query 扩权 |
| 缺行/字段/失败 | 账户可能不存在，不能推断零 | 无账户“暂无点数账户数据”；null/缺失字段“数据缺失”；加载隐藏旧快照并禁用刷新；失败清除旧账户并提示，主动刷新可恢复 |
| 原开户 | name/kind/countryCode/phone/email 原表单值及原 requestId | 未改写；完整 #48 回归逐字段验证 +852/13948001234/browser48@example.com，账号与组织UUID不同 |
| 原重置/状态 | `child.accountId→accountId`，`child.id→organizationId`、active取反 | 保持原字段及来源；#48 回归正常重置、丢响应、停用/恢复和会话撤销；账户子页无这些操作按钮 |
| 定价与跨级写 | 只读范围不授权跨级建单/改价/收款/划拨/重置/停用 | 本票跨级与其他分支状态/重置/建单403；#48 回归跨级改价403，原 quantity=1.0000/unitPrice=1.1000不变，二级分销不能再开分销 |
| 客户内容 | 分销 reports 不返回客户档案与邮件正文，导出仅自有账务 | 三种分销身份均检查响应无 customers/emails/keywords/contacts；真实 own-ledger.csv 返回200且无正文类字段，分销档案API403；本页无导出或客户查看入口 |

具体不同组织/账号 UUID、测试数据、选择快照、原写请求、允许/拒绝结果及计数保存在 [本票证据](ISSUE-49-EVIDENCE.json)。凭据、会话、密钥、连接串不进入交付证据。

## 生命周期

沿用 #48 限定 KeepAlive 及会话 generation 销毁。首次挂载并行读取一次 organizations 和一次 reports；返回、前进后退及同组件 query 切换均不自动重读或写入。主动列表刷新同时更新账户；主动账户刷新仅调用 reports，并阻止重复在途读取。没有新增自动重试或业务写入。

原开户输入、凭据交付、提交中阻止离开、结果未知保留原请求标识、确认核实及凭据关闭策略均保持。刷新不恢复草稿/凭据，账户不是跨刷新持久化数据。原 #48 全套取消导航、提交中导航、丢响应/主动重试/核实已实际回归；账户专项额外验证晚到 reports 响应期间退出，重新用另一分销账号真实登录后只显示其树，旧账户不能恢复。

## 实际验证

在 application 执行：

| 命令 | 结果 |
| --- | --- |
| `node scripts/verify-issue49.mjs` | 最终通过，2/2真实 Chromium/Nest/HTTP/PostgreSQL 专项 |
| 脚本内 `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit` | 通过，前端类型 |
| 脚本内 `node node_modules/typescript/bin/tsc -p config/playwright/tsconfig.issue49.json --outDir .scratch/issue49/dist` | 通过，真实业务服务、本票及原 #48 专项隔离编译 |
| 脚本内 `node node_modules/vite/bin/vite.js build --outDir .scratch/issue49/web` | 通过，保留既有大包提示 |
| 脚本内 Playwright `--config config/playwright/playwright.issue49.config.ts` | 2 passed，34.8s |
| `npm run typecheck` | 通过，完整前后端类型检查 |

脚本从受保护 `.env` 只读取连接源，向已有 PostgreSQL 新建随机 `_test` 库；仅在新库初始化/清理测试夹具，不修改来源库。最终库 `issue49_6c0306ff71_test`，动态独占端口为主后端55801、Vite后端55802、Vite55803。编译、静态构建、结果、环境秘密和截图均只写被忽略的 `.scratch/issue49/`。未使用共享 dist/test-results；测试 app 和 Vite 在 finally 关闭，未操作用户服务。测试库保留为可丢弃夹具，每次复验另建新库。

专项实际通过：

1. 一级 A 直属两行、多层三行，二级 A2 仅一行后代，另一一级 B 仅自己的后代；组织/账号UUID刻意不同。直属及深层四项精确到四位小数，停用叶子继续显示余额、上级及第2层；缺账户和部分字段缺失不伪装零。
2. 真实读取延迟时加载状态、刷新禁用，正常放行后恢复；受控 null/字段缺失、503注入后不显示旧值，解除后手动刷新恢复。只有异常分支由浏览器修改响应，正常读取及所有权限、账务均走真实后端数据库。
3. 真实路由点击、生产深链刷新、帮助页返回、前进后退；首次 organizations/reports各一次，缓存返回不增加读取，整页刷新各增加一次。Vite同一账户深链直达和刷新均通过。二级分销以无权组织ID访问详情显示未找到，无管理按钮。
4. 账户页面业务 POST 为0；退出后真实登录另一分销账号，不保留旧树；390px移动端无横向溢出。已查看桌面/移动截图并修复子页标签同时高亮。
5. #48 全套真实开户、临时凭据复制失败重试及关闭、取消/放弃导航、提交中门禁、开户409去重、重置丢响应与主动核实、状态停用恢复、不同组织/账号ID、跨级/分支拒绝、四角色登录/退出换账号及强制改密通过。编译出的测试副本仅替换独立产物目录和随机端口，并增验Vite账户深链，不修改 #48 原源码或交付记录。
6. 账户专项前后 internal_point_accounts全行相等；组织状态事件、密码重置、划拨、三类查询流水均0，受控供应商调用0。独立 #48 回归允许的开户/重置/状态写入另见证据，不将其误称为无写入；回归查询流水/划拨/供应商调用亦0。

执行中曾因另一票测试文件处于编辑中导致全库编译语法失败，随后本票改用限定源码的隔离编译；对方完成后完整 npm run typecheck已通过。早期账户专项在解除晚到响应拦截时出现测试自身 `Route is already handled` 竞态，改为等待处理器完成后再解除，最终全部通过；无对应产品业务规则修改。

## 边界及前端规范反馈

未部署或验证生产HTTPS、正式查询/SMTP/U-Mail、其他浏览器、压力并发、72小时真实等待、断电后恢复或跨刷新凭据恢复；未重跑与本票无关的报表/采购/终端全部流程。原 reports 同时返回已有授权聚合指标，服务契约未改，本页仅保存组织和四项账户数据。最终公共兼容退出由并行设置任务根据所有调用方与证据判断。

前端编码规范试点交付反馈：

- 规则版本：0.0.1；触发：自动；同时应用 Vue Composition API 技能。
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021–027、030；GUIDANCE FCS-014、032。未修改依赖，028/029无新增事项。
- 校验结果：完整 typecheck、隔离编译/构建、两项真实业务浏览器专项通过。lint/格式化未执行：package.json无对应命令；npm test及无关套件未执行：不覆盖当前账户/开户流程；默认npm run build未执行：避免覆盖共享dist，改用等价隔离输出。
- 冲突：无。存量规范债务：本票未整改其他区域或并行改动。PENDING：目录/命名/SFC顺序等保持当前仓库惯例，无需用未决规则作新增决策。
