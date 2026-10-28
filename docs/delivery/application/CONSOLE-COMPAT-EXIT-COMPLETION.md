# 控制台兼容容器最终退出

日期：2026-10-28（Asia/Shanghai）。本记录仅验收本地公共兼容退出，跨分销和终端的完整业务组合验收由同批独立会话另外留证；单票结果不替代最终全局集成。

## 基线及授权范围

基准 HEAD `2bf193c186d40c939494d317d40eafb459d9dd0e`。工作目录 C:\PXY\ai-research-company，未建 worktree。接入前工作区已有分销、终端、平台页面、样式和测试的大量未提交成果；本次先保留 App/router/兼容容器/原通知组件快照于忽略目录 `.scratch/compat-exit/`，仅增量编辑本票公共文件，没有 reset/stash、覆盖其他成果、部署、重启用户服务、提交、推送或远端工单更新。

读取 AGENTS、工程脚手架、应用 README、控制台 Spec v1.2 的根组件职责/退出条件/缓存/测试约定、一期 Spec 系数提前通知及权限要求，并以各业务票现行交付和代码核对路由、旧挂载和事件依赖。#49、#55 完成交付已读取；删除前通过 wait_threads（timeoutMs=1000）确认 #57 status=completed、thread=01a182eb-f797-7cd0-aa31-78a2437d2d85，并读取 ISSUE-57-COMPLETION.md 最终交付。没有向其他会话发送消息。

## 逐路由及生命周期审计

以下为实际绑定及本次保留策略；各业务内部的字段/幂等/未知结果验收沿用对应票据，不把本次导航验证替代业务验收。

| 角色/路径 | 真实组件 | 实例策略/交付依据 |
| --- | --- | --- |
| platform overview | PlatformOverviewPage | 离开销毁，返回读取；#47 |
| platform organizations（含 new/id/accounts） | PlatformOrganizationsPage | 有限缓存、公共离开；#37/#38 |
| platform organizations/business-data | PlatformBusinessData | 只读不缓存；#39 |
| platform ledger | PlatformPointOrdersPage → PointOrders | 有限缓存、未知请求保留；#40 |
| platform ledger/procurement | PlatformProcurement | 有限缓存；#41 |
| platform ledger/profit、flows | PlatformReportPage | 不缓存，同组件页别复用快照；#44 |
| platform reconciliation | ReconciliationPage | 有限缓存、未知请求保留；#46 |
| platform reconciliation/upstream | UpstreamMonitorPage | 不缓存；#45 |
| platform settings | PlatformSettingsPage | 有限缓存，计价/系数操作继续原契约；#42 |
| platform settings/umail、email-quota | UMailResourceSettings、PlatformEmailQuota | 有限缓存；#43 |
| distributor organizations（含 new/id/accounts） | DistributionOrganizationsPage | 有限缓存；#48/#49 |
| distributor orders | DistributionPointOrdersPage → PointOrders | 有限缓存；#50 |
| distributor profit | DistributionProfitPage | 不缓存，离开销毁；#51 |
| admin/sales search | TerminalSearchPage → CompanySearch/ProductSearch | 有限缓存；#53/#54 |
| admin/sales profiles（含 id） | CompanyProfilesPage → CompanyProfileDetail | 有限缓存，原联系人/邮件/档案链路；#52/#55 |
| admin/sales emails（含 batchId） | EmailRecordsPage | 有限缓存；#56 |
| admin/sales sending-settings | TeamSendingSettingsPage | 有限缓存；#57 |
| admin/sales members | MemberManagement | 有限缓存；sales 仅权限说明；#58 |
| admin/sales usage | TerminalUsagePage | 不缓存，离开销毁；#59 |
| 四角色 /help | RoleHelpPage | 不缓存，依 role 展示 |
| 四角色 /account/settings | SettingsRoute + App 真实改密表单 | SettingsRoute 只为空路由出口；表单在根，保留原公共离开登记 |

14 条业务菜单、7 条平台额外业务路由全部绑定真实组件。EmptyRoute 仅用于 unknown 路由，经守卫回角色默认页；不再作为业务缺省。业务页映射缺失将明确抛开发错误。SettingsRoute 保留其已有公共表单布局职责，不视为待迁移业务。App 的 KeepAlive 名单与业务参数传递完整保留，不使用 fullPath 全量缓存；generation 销毁公共通知及整个限定页面树。所有新业务组件只在 RouterView 当前出口（或限定缓存）下存在，原兼容模块已无挂载、角色分支或跨组件事件依赖。

删除 CompatWorkspace 导入/挂载及文件、workspaceVisited/isCompatPath、专用 menu/currentTitle/watch、RouteMeta/NavigationItem target 和锚点定位。保留 App 根组件、会话 store、formLeave、账号设置 previousPath、真实业务 target 局部变量及 DOM event.target；保留滚动位置 Map、history position 和前后退位置恢复，这些仍是公共导航用途。Nest/Vite 路径白名单原已齐全，不需要产品改动。

## 系数通知契约及去重

原容器最后只剩无角色条件的 CoefficientNotice。迁移各路径后，isCompatPath 对全部菜单均为 false，容器剩余通知被隐藏；不能以此推导通知无用。原服务器 GET coefficient/notices 在身份守卫后对四角色开放，取最近五条，不接收组织/账号/业务参数，没有确认/已读接口，也没有通知收费或供应商调用。原组件 onMounted 读取一次，失败清空，没有轮询和自动重试。

实现原样移到 `web/components/CoefficientNotice.vue`，公共 `layout/ConsoleNotices.vue` 组合通知和路由 slot，按 session generation 单实例。正常四角色在业务页、帮助和账号设置均可看到同一通知；强制改密/未登录不挂载。业务导航、激活及返回不重读通知；刷新重新读取；退出/401/改密/换账号销毁。旧请求通过 session generation 拒绝，不能重新恢复会话。

分销订单已有单独通知调用。遵守本票不编辑分销业务页面的分工，原 `pages/commerce/components/CoefficientNotice.vue` 保留为薄展示适配：注入公共布局通知所有权时不挂载第二实例，独立使用时仍渲染全局通知组件。它有真实调用方，不是旧工作区/业务路由兼容逻辑；没有网络缓存、共享账户数据或隐藏第二请求。平台设置内“通知历史”仍属计价业务，不删除，也不把其合法 GET coefficient 误算成重复 GET coefficient/notices。

公共稳定文件清单见 [CONSOLE-COMPAT-EXIT-PUBLIC-CHANGES.md](CONSOLE-COMPAT-EXIT-PUBLIC-CHANGES.md)。不改其他票记录、全局 Spec、分销/终端业务组件及服务；通知原位置的适配是本票必要通知接线。

## 验证与证据

最终执行结果和脱敏证据待本轮成功运行后补入本节。测试源 `application/tests/console-compat-exit.spec.ts`，执行器 `application/scripts/verify-console-compat-exit.mjs`。每次随机独有 PostgreSQL 容器、库名 compat_<uuid>_test、回环数据库端口、Nest/Vite 端口及 `.scratch/compat-exit/<uuid>/{compiled,web,results}`；不读取正式供应商凭据，不写共享 dist/test-results。结束仅删除本次容器及其卷，关闭本次 Nest/Vite。

## 验证边界

- 本票只补公共组合边界，不重跑所有业务票完整流程；不同业务标识、收费查询、订单履约/退款/库存竞争、附件、联系人到邮件、跨日额度等由各票专项及同批独立集成证据承担。最终全局集成是否通过须汇齐另两个会话证据后决定。
- 正式腾道、SMTP/U-Mail 认证、DNS、实际投递/退信/回复、生产 HTTPS/反向代理、部署、跨刷新未知上下文恢复均未执行，不将构建通过当作业务验证。
- 原通知读取失败静默清空策略保持，未新增刷新、已读确认或推送机制。本票未额外验证每一种通知服务器异常/无效响应分支。
- 既有大 chunk 构建提示保留，没有为清理兼容逻辑改变拆包策略。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动；另应用 Vue skill。
- 应用规则：ACTIVE MUST FCS-007/011/013/019/021～027/030；GUIDANCE FCS-014/032。无依赖变更，FCS-028/029 无新增适用内容。
- 校验结果：npm run typecheck 已通过；独立 tsc/Vite 构建已通过；最终真实专项结果见验证节。未执行常规 npm run build（会写共享 dist），使用独立 outDir 等效编译构建；无独立 lint/formatter 既有脚本；未执行无关全量测试与部署测试。
- 冲突：无。存量规范债务：未触及区域未格式化。
- PENDING：命名/块顺序/缩进/属性排序等沿用现有风格，无需本票澄清。
