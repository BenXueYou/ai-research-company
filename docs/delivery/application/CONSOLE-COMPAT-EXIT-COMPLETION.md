# 控制台兼容容器最终退出

日期：2026-10-28（Asia/Shanghai）。**结构退出已实施；本票公共专项已通过。最终全角色全局验收未达成**：同批终端组合 T-INT-01 真实失败尚未修复，分销会话仍待最终公共版本复验。本记录不宣布整批放行。

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

最终成功运行：

| 命令（application 下） | 结果 |
| --- | --- |
| npm run typecheck | 最终通过；Vue 与服务端/测试 TypeScript |
| node scripts/verify-console-compat-exit.mjs | 独立 tsc、Vite 构建通过；真实 Chromium/Nest/PostgreSQL 专项 1 passed（27.7s，场景25.1s） |
| 触及文件 git diff --check | 通过 |
| rg 查找 CompatWorkspace/workspaceVisited/isCompatPath/meta.target/compat-（web） | 无剩余引用；退出码1表示无命中 |

运行 ID `1ac4eb5f702646e18617e1e52f0852ed`；PostgreSQL 库 `compat_1ac4eb5f702646e18617e1e52f0852ed_test`，运行后随自有容器清理。源码编译前/浏览器结束后 SHA-256 完整比较 stable=true，见 [SOURCE](CONSOLE-COMPAT-EXIT-SOURCE.json)。实际不同组织/账号 UUID、通知和导航请求记录、原请求脱敏值及账务快照见 [EVIDENCE](CONSOLE-COMPAT-EXIT-EVIDENCE.json)。证据没有 Cookie、CSRF、密码、连接串、密钥或 SMTP 凭据。

实际执行：四角色逐一真实登录默认页、所有主菜单、帮助、账号设置、后退/前进；21个唯一业务路径（按角色共27次）逐个生产深链及刷新，Nest/Vite 全路径 HTTP HTML承载检查，Vite 真实登录与用量刷新；跨角色直达回默认页、未知 API不返回HTML及缺资源404。正常账号通知始终单横幅，客户端导航/帮助/设置返回不增加 GET coefficient/notices；每次整页刷新只增加一次，分销订单没有第二通知请求。平台设置通知历史合法存在，横幅断言单独限定 .el-alert。

终端搜索输入 → 账号设置取消/放弃 → 账号表单后退取消/返回放弃，原query/hash完整返回，未提交搜索不执行业务。真实删除当前账号 sessions 后进入只读用量触发401，通知及旧缓存销毁；换业务员账号搜索为空。通知真实GET先取服务器响应，延迟到退出并登录分销后才交付，当前账号仅一个通知，不恢复旧会话。临时凭据登录/业务直达均不挂通知，直接通知API403；真实改密成功后回登录，再用新密码登录成功。

组合场景：管理员SMTP表单原值 host=smtp.compat.test、port字符串587、security=starttls、username=distinct-authentication、replyTo=distinct-reply@compat.test，区别于登录 admin@compat.test及组织/账号UUID。defaultChannel仍来自原复选框false，requestId由原组件产生；本票公共代码不读取或重映射这些值。真实后端在受控verify阻塞期间，帮助导航被阻止；保存成功后浏览器丢弃响应成为unknown。取消离开仍在设置；确认到账号设置→帮助→后退→返回工作台，unknown和原载荷保留，不自动GET/POST/核验。主动核实产生第二POST，脱敏请求完整相等（含原requestId），受控verify仍只有1次。凭据证据已替换为[REDACTED]。

11张余额/库存/订单/流水/邮件额度/批次/收件人/查询业务表前后快照相等：终端balance=123.4567，queryFrozen=2.0001，salesReserved=3.0002均保持；原空流水/额度/查询未增加。搜索及上游账户调用0，实际发信0；受控SMTP配置verify=1（不是发信），仅用户显式保存/核实POST2次。合法POST company-profiles/list是本地只读列表，已按现有接口职责识别，不误记成写入或收费请求。browser pageerror=0。

中间未通过运行均未计入通过：测试适配器类型不完整、通知历史与横幅选择器混计、Vite跨源使用错误后端APP_ORIGIN、尝试更新不可变通知历史的夹具、移除拦截器过早导致迟到route已处理、用量已移除标题的选择器、把本地只读POST列表误计为业务写入。只修测试夹具和断言，不放宽产品契约；最终使用新随机资源从头执行成功。测试源 `application/tests/console-compat-exit.spec.ts`，执行器 `application/scripts/verify-console-compat-exit.mjs`。每次随机独有 PostgreSQL 容器、库名 compat_<uuid>_test、回环数据库端口、Nest/Vite 端口及 `.scratch/compat-exit/<uuid>/{compiled,web,results}`；不读取正式供应商凭据，不写共享 dist/test-results。结束仅删除本次容器及其卷，关闭本次 Nest/Vite。

## 验证边界

- 本票只补公共组合边界，不重跑所有业务票完整流程；不同业务标识、收费查询、订单履约/退款/库存竞争、附件、联系人到邮件、跨日额度等由各票专项及同批独立集成证据承担。已只读核对同批 DISTRIBUTION-INTEGRATION-COMPLETION.md 和 TERMINAL-INTEGRATION-COMPLETION.md。前者已通过独立组合但标记等待最终公共版本，后者明确 1 passed / 1 failed、退出码 1。T-INT-01：公司名建档后，产品新候选独立详情 settled 且命中同一 detail.id，数据库只保留原内部档案，但产品成功结果缺少进入既有档案的链接。本票不修改产品/服务标识或规则；该缺陷与空兼容容器的去留无关，保留空容器不能修复，故完成结构清理并明确不满足最终全局放行。详见 [终端组合验收](TERMINAL-INTEGRATION-COMPLETION.md)。
- 正式腾道、SMTP/U-Mail 认证、DNS、实际投递/退信/回复、生产 HTTPS/反向代理、部署、跨刷新未知上下文恢复均未执行，不将构建通过当作业务验证。
- 原通知读取失败静默清空策略保持，未新增刷新、已读确认或推送机制。本票未额外验证每一种通知服务器异常/无效响应分支。
- 既有大 chunk 构建提示保留，没有为清理兼容逻辑改变拆包策略。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动；另应用 Vue skill。
- 应用规则：ACTIVE MUST FCS-007/011/013/019/021～027/030；GUIDANCE FCS-014/032。无依赖变更，FCS-028/029 无新增适用内容。
- 校验结果：npm run typecheck 已通过；独立 tsc/Vite 构建已通过；最终真实专项1/1通过，详见验证节。未执行常规 npm run build（会写共享 dist），使用独立 outDir 等效编译构建；无独立 lint/formatter 既有脚本；未执行无关全量测试与部署测试。
- 冲突：无。存量规范债务：未触及区域未格式化。
- PENDING：命名/块顺序/缩进/属性排序等沿用现有风格，无需本票澄清。


最终只读复核：源码 manifest 与成功运行逐项比较 changedSinceRun=[]。交付时共享仓库 HEAD 为 376a75c956d6783c599496a22109c8119b7c29da；本会话未执行 git commit/push，其他进程的共享仓库状态变化不归因于本票。已保留当前全部内容。

