# 公共能力与平台并行集成验收

日期：2026-10-28（Asia/Shanghai）。基准提交 `f009895e16571113301e261a87a45051a52d21ac`；任务开始工作区干净，随后四个已授权会话在同一本地目录并行开发。本会话负责共享集成文件，不创建 worktree，不撤销其他会话修改。

## 当前结论

| 范围 | 本地实际成果与验收结论 |
| --- | --- |
| #34 | 当前公共框架、四角色导航、面包屑、独立滚动、History 与身份准入回归通过。保留 App 根入口和未迁移角色兼容实例；全局兼容容器退出条件尚未满足 |
| #35 | 现有公共 formLeave 可直接接入；真实账号设置和公共生命周期回归通过。修复同组件参数变化后确认放弃未清空草稿；修正过期阻塞记录。公共前置可用不代表所有下游业务验收完成 |
| #40 | 平台订单包装页、缓存、离开保护和既有履约链路已集成；真实浏览器/数据库专项通过。整票仍有既存后端缺口：无“已收款待补库存”状态，本轮没有改规则来补齐 |
| #41 | 独立采购与费用路由、缓存、旧兼容挂载退出及真实账务验收完成；参数、损耗关联、费用去重、移动加权成本、幂等和角色拒绝已留证 |
| #42 | 独立计价/系数设置、旧兼容挂载退出及生产构建/Vite入口专项通过；通知、生效、覆盖校验、幂等和上游调用次数已留证 |

通过公开 GitHub REST 只读读取 [#34](https://github.com/BenXueYou/ai-research-company/issues/34)、[#35](https://github.com/BenXueYou/ai-research-company/issues/35)、[#40](https://github.com/BenXueYou/ai-research-company/issues/40)、[#41](https://github.com/BenXueYou/ai-research-company/issues/41)、[#42](https://github.com/BenXueYou/ai-research-company/issues/42) 的正文及全部评论。#34 包含布局及兼容退出补充与一条既有实施评论；其余评论为空。没有将 Open 视为未实现，也没有修改远端票据。

## 共享代码与生命周期

- `/platform/ledger` → `PlatformPointOrdersPage`，包装原 PointOrders；分销仍沿用自己的兼容 PointOrders 及原角色条件。
- 新增 `/platform/ledger/procurement` → `PlatformProcurement`，仅平台授权，菜单和面包屑“点数与账务 / 采购与费用”；`isBusinessPath` 包含该路径。
- `/platform/settings` → 现有 `PlatformSettingsPage`。移除兼容容器内采购、系数变更组件及导入；保留跨角色 CoefficientNotice、分销开户/订单/报表和终端模块。`compat-settings` 无剩余引用；`compat-orders` 等仍有调用方，不删除。
- App 的 KeepAlive 明确列出 `ReconciliationPage,PlatformPointOrdersPage,PlatformProcurement,PlatformSettingsPage,PlatformOrganizationsPage,UMailResourceSettings,PlatformEmailQuota`。以 session generation 作缓存边界，不使用 fullPath 作全局 key，不统一缓存所有页面。退出、成功改密、401、换账号销毁旧实例。
- 账号设置来源保存合法 `route.fullPath`，返回保留 query/hash；合法性判断只检查路径与当前角色，帮助等非业务来源及刷新后的设置页回角色默认页。
- 公共 formLeave 继续使用 Router beforeResolve/afterEach，成功导航后才执行已批准的放弃。修复 route query 更新使 state() 已变 clean 时未丢弃草稿的问题；若期间已变 submitting/unknown，仍不放弃。失败导航不清空输入，无手写 pushState 后退补偿。
- Nest 增加采购、业务数据路径；Vite 增加采购、业务数据及已存在的两项邮件设置路径。合法 GET/HEAD 承载 index，未知 API、缺失静态文件和未知路径保留错误响应。
- App 只组合身份、公共布局和 RouterView，没有重新集中引入业务组件；Pinia、HTTP、身份与业务服务契约未改。

共享文件实际变更：`application/web/App.vue`、`web/router/index.ts`、`web/router/formLeave.ts`、`web/layout/CompatWorkspace.vue`、`server/app.ts`、`vite.config.ts`。公共样式及其他布局无需新增修改。四份公共专项测试及独立 Playwright 配置保存在源码中；根忽略规则仅增加对应测试例外与本会话临时产物范围。

## 参数与业务结果证据

| 链路 | 原来源 → 当前提交及实际验证 |
| --- | --- |
| 本人改密 | 三个输入分别对应 currentPassword/newPassword/confirmPassword，不发账号或组织 ID；服务端会话确定本人。初始 super_admin、错误当前密码、相同/不一致新密码、长度/ASCII/空格边界、全设备撤销与旧密码拒绝已验证 |
| 账号离开/缓存 | 菜单、返回、退出、浏览器后退取消均保留三字段且不 POST；确认放弃后前进为空；刷新取消保留输入；合法 `?view=new` 返回不丢 query。提交中不能离开；真实写入后阻断响应，切页返回仍禁止重复提交，POST 恰好一次；重新登录用新密码成功 |
| 四角色身份 | 分销组织、终端组织与三个账号均使用不同 UUID；四角色默认来源及返回正确，角色切换不显示前一角色界面；直接 API 越权拒绝，强改不可绕过；业务 401 即使有 dirty 输入也清空界面，无确认保留失效数据 |
| 订单 | buyerId 仍来自直属 children[].id；orderId 仍来自 orders[].id，和组织/账号不同。既有收款预留、整单划拨、退款、停用买方保留预留、丢响应原请求重试已验。最终库存7、预留0，划拨/退款各1条；详见 [#40证据](ISSUE-40-EVIDENCE.json)与[交付](ISSUE-40-COMPLETION.md) |
| 采购费用 | expenseId 严格来自费用选项，三种损耗查询/页ID与费用ID各不同；原条件字段和字符串保留。6笔采购、5笔费用、11条流水；销售生成内部库存和移动加权成本，承担费用不增库存成本；损耗只确认一次，关联充值差额正确；供应商调用0。详见 [#41证据](ISSUE-41-EVIDENCE.json)与[交付](ISSUE-41-COMPLETION.md) |
| 计价系数 | 最低加价率非空条件、interfacePath非空条件及 evidenceType 保留；通知 requestId 与 change.id 不同，生效取 changes[].id。覆盖需求16.5000，上游8点拒绝、18点允许；显式两次生效上游调用共2次，已成功请求重试不再调用，余额和旧授权系数不重算。详见 [#42生产证据](ISSUE-42-PRODUCTION-EVIDENCE.json)、[开发证据](ISSUE-42-DEVELOPMENT-EVIDENCE.json)与[交付](ISSUE-42-COMPLETION.md) |

公共层没有改动请求参数来源、标识映射、枚举、默认值、兜底、校验、提交条件、权限或账务服务。资金及外部调用断言来自业务会话的真实专项结果，公共布局的响应模拟不冒充数据库业务验收。

四角色最终真实账号/组织ID与内置平台账号非邮箱特例的落库快照见 [公共身份证据](PLATFORM-INTEGRATION-IDENTITY-EVIDENCE.json)，不含密码、会话令牌或连接凭据。

## 本会话实际验证

独立 Docker PostgreSQL `codex-platform-shared-20261028`，回环 `55485`，数据库 `platform_integration_test` 与 `platform_identity_test`。没有连接、清空开发库或其他测试库。账号浏览器后端3384、会话故障夹具3385/3386、身份API3387/3388、Vite5184；布局Express使用随机回环端口。产物及输出均为 `.scratch/platform-integration-*`，未写共享 dist 或 test-results。

在 application 目录执行：

```powershell
npm run typecheck
node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/platform-integration-dist
node node_modules/vite/bin/vite.js build --outDir .scratch/platform-integration-web
# TEST_DATABASE_URL 显式指向上述独立可丢弃 _test 库
node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.platform-integration.config.ts
node --test --test-concurrency=1 .scratch/platform-integration-dist/tests/identity.test.js .scratch/platform-integration-dist/tests/password-resets.test.js
npm test
```

| 检查 | 实际结果 |
| --- | --- |
| npm run typecheck | 通过；前后端类型检查 |
| 独立 tsc / Vite 构建 | 通过；最终构建晚于业务组件最后修改；Vite仍有既有单chunk超过500KB提示 |
| 公共 Playwright | 最终完整13项通过（53.8s）：真实账号1、开发History1、登记生命周期1、布局/四角色/深链8、会话故障与旧响应2 |
| 补充未知结果默认阻止分支 | 修改专项夹具后单跑 formleave 两项，2 passed（7.6s）；覆盖未声明 retainUnknown 时拒绝离开，原有允许保留分支继续通过 |
| 真实身份/重置专项 | 12项通过；使用独立 platform_identity_test，顺序运行。为避免复用旧专项端口，仅在本轮生成的JS副本将3091→3387、3194→3388；没有改原测试或业务源文件 |
| npm test | 3项策略测试通过；邮箱规范、密码边界、KDF/临时密码 |
| git diff --check（本会话文件） | 通过；仅Git换行转换提示 |
| lint/formatter/stylelint | 未执行；package.json无对应命令，不安装工具或新增规范配置 |
| 默认 npm run build / test:e2e / test:integration / 部署测试 | 未执行；这些入口会用共享产物或并非本轮专项，采用独立编译/构建与相关真实流程；未部署 |

13项中的登记机制测试使用真实Vue/Router与公共formLeave的专用最小浏览器夹具，验证两个登记方隔离、后续守卫拒绝不丢草稿、同组件query更新、submitting拒绝、unknown保留/默认拒绝、KeepAlive停用、退出/beforeunload及注销。真实账号和业务测试另行连接真实后端与数据库。

会话恢复与晚到响应两项为受控HTTP故障测试，验证初始化失败可重试、同一次初始化不重复、401清旧界面与跨账号旧响应不回写；不将它们称为真实数据库验收。布局测试复用已有 #34 场景，覆盖双区滚动、历史位置、唯一高亮、面包屑离开、四角色窄屏键盘和详情长名称。

早期测试曾因旧账号按钮定位、重复“直属下级”链接定位与 `.scratch` sendFile默认拒绝而失败；已修正本轮测试夹具。刷新提示测试曾因先await evaluate、再处理beforeunload对话框造成等待，已改为先启动刷新、处理对话框、再await。中途一轮被中止，未计为通过；最终结果以上表实际完成的命令为准。

## 其他会话证据与剩余边界

- #40 专项的实际环境、命令和不同ID完整参数见其交付与JSON；现存缺库存收款409保持原行为，不能写成“已收款待补→补库预留”通过。该业务状态需要单独授权设计与实现，不能混入页面迁移。
- #40 最终真实专项1 passed（13.4s），3140端口，独立55440测试PostgreSQL及随机issue40_*_test；后退/前进、丢响应、真实预留/划拨/退款、允许/拒绝及四角色切换均已留证。
- #41 独立3441和随机issue41_*_test库，最终真实浏览器1 passed（12.2s）；直接使用当前共享路由/App/History，非替换集成演练。开发HEAD/生产深链、拒绝与账务证据见其记录。
- #42 独立3342/5342和两个随机issue42_*_test库，生产构建入口1 passed（15.7s）、开发入口1 passed（19.2s）。生产受控价格拒绝为真实服务/数据库断言，未启动HTTPS production HTTP。
- 未验证正式腾道/SMTP/U-Mail、生产反代/HTTPS部署、Firefox/WebKit/读屏、实际网络崩溃及并发多管理员改价；无跨完整刷新草稿持久化保证。
- 没有逐一重跑分销和终端收费搜索、档案、联系人、邮件全链或所有未迁移表单；四角色公共导航和身份回归不代表其独立页迁移完成。具体业务会话记录的未验证项仍有效；公共通用query测试不替代每个业务模块的query验收。
- 保留兼容容器、workspaceVisited、isCompatPath及仍有调用方的target；最终全局清理由最后一个完成全部角色模块迁移的票负责。平台概览的业务内容亦不计入本轮新增实现。
- 未部署、重启用户服务、提交、推送、关闭票据或更改远端依赖。其他会话对旧测试的整理保留原样，不属于本会话实现范围。

三个业务会话均已读取最终完成状态及交付文件后汇总。本公共会话的独立浏览器/HTTP/Vite进程均随测试结束，`codex-platform-shared-20261028` 已停止；起初额外拉起但未用的本会话 `codex-platform-integration-20261028` 亦已停止，两个容器和专属产物保留。业务会话报告自动审批以 `blocked by policy` 拒绝其临时目录/容器删除命令，没有更细原因；相关产物保留，#41测试容器已停止，#40容器依其交付继续保留。没有尝试代替这些会话绕过清理拒绝。

前端编码规范试点：规则版本0.0.1，自动触发；同时应用Vue技能。触及代码遵守ACTIVE MUST FCS-007/011/013/019/021～027/030及GUIDANCE 014/032；依赖与锁文件未改。验证状态如上；无配置冲突，无扩大存量规范整改，PENDING未提升执行，不需要额外澄清。
