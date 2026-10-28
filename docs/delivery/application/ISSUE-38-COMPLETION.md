# Issue #38 平台下级账户与列表点数摘要

日期：2026-10-28（Asia/Shanghai）。功能模块已实现，公共面包屑接入及真实后端/数据库/浏览器专项已完成收尾复验。未部署、重启用户服务、提交、推送或改动远端票据。

## 本轮收尾复验（2026-10-28）

本轮读取 GitHub #38 正文与“应用根组件与兼容容器退出约定”补充验收（通过 GitHub REST API；无额外评论），并核对现行已批准 Spec、工程脚手架、应用说明、#37 完成记录及实际引用。复验基线 HEAD `f009895e16571113301e261a87a45051a52d21ac`，工作区仍有其他任务大量未提交改动。

当前 `router/index.ts` 将 `/platform/organizations` 直接绑定真实 `PlatformOrganizationsPage`；`view=accounts` 只切换本页子视图。`ConsoleBreadcrumb.vue` 已呈现“下级管理 / 直属下级 / 下级账户”，直属下级可点击返回，账户为当前位置。`App.vue` 的范围缓存包括该页面并以 session generation 销毁；`CompatWorkspace.vue` 中 `OrganizationOpening` 只为分销挂载，平台没有本模块重复挂载，也没有本票遗留滚动 target。分销及终端等其他兼容模块仍有调用方，继续保留兼容容器，不宣称完成全局退出。

核对 `ReportingService.overview`：组织范围由服务端会话 organization_id 递归取得，active=false 未被过滤；四项来自 internal_point_accounts，available 保持数据库 `balance-query_frozen-sales_reserved`；前端仍按组织 id 对应 organizationId，原样展示字符串，不使用管理员 accountId，不与上游库存合并。本轮无产品代码或请求契约修改，未触及 #37 开户、凭据、重置、离开保护与未知结果逻辑，未修改公共入口、#39 报表页或服务、#36 帮助页。

本轮仅修改 `application/issue38-tests/accounts.test.ts`、本记录，并新增 [收尾证据](ISSUE-38-CLOSEOUT-EVIDENCE.json)。测试新增可配置独立端口/静态产物目录及无秘密的证据输出；补充面包屑父级返回、跨模块返回与读取次数、加载禁用、null/缺失字段异常场景，修正公共面包屑新增后同名链接导致的旧选择器歧义。

实际命令均在 application 执行：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，前后端类型检查 |
| `node node_modules/typescript/bin/tsc -p issue38-tests/tsconfig.json --outDir .scratch/issue38-closeout-dist` | 通过，本票及业务服务独立编译 |
| `node node_modules/vite/bin/vite.js build --outDir .scratch/issue38-closeout-web` | 通过，已有大包提示保留 |
| `node --env-file=.scratch/issue37-real.env --test .scratch/issue38-closeout-dist/issue38-tests/accounts.test.js` | 最终 1/1 通过，真实 Nest/HTTP/PostgreSQL/Chromium |

最后一条进程环境设置 `ISSUE38_PORT=3498`、`ISSUE38_WEB_DIR=.scratch/issue38-closeout-web`、`ISSUE38_EVIDENCE=../docs/delivery/application/ISSUE-38-CLOSEOUT-EVIDENCE.json`、`ISSUE38_SCREENSHOT=.scratch/issue38-closeout-accounts.png`。只消费已有环境文件中的测试连接作为 CREATE DATABASE 连接源，不读取回显文件内容。所有初始化、夹具与写入都在随机新库 `issue38_84e7fde0849145e5907f17786ea18fc9_test`；测试 finally 删除该库且正常退出，未清空连接源库，未启动/重启用户服务。本轮没有 Vite 常驻服务，静态资源由独占 3498 的测试 Nest 提供；构建和编译均使用独立目录。

实际通过场景：

- 直属两行及授权多层四行、三级停用终端、上级名称/层级、账户缺行；组织 UUID 与管理员 UUID 不同，详细快照见收尾 JSON。直属四项为 111.1234 / 11.0001 / 3.0002 / 97.1231，三级停用账户为 333.3456 / 33.0003 / 5.0004 / 295.3449。
- 面包屑当前位置及父级 href/点击；账户页直接刷新、浏览器前进后退；离开到计价配置后从主菜单返回，再切账户，reports 累计仍只有首次一次请求；首次直属和账户子视图切换也只请求一次 organizations 与一次 reports，没有重复实例读取。
- 延迟真实 HTTP 读取时显示“账户读取中…”、按钮禁用并隐藏旧行，放行后显示真实数据；仅字段异常场景基于真实响应置 balance=null 并删除 available，明确展示两处“数据缺失”，其余两项保持原值。503 异常展示失败并清除旧值；返回直属显示失败，解除异常后主动刷新恢复。只有字段异常和 503 为浏览器构造，正常读取、权限与持久化结果均使用真实后端和库。
- 平台允许读取；分销/终端管理员/业务员平台深链跳转合法默认页，分销 reports 保持原授权后代且排除兄弟；匿名 401、强改 403 和设置新密码门禁；跨级状态、重置、建单、改价、收款、划拨等拒绝保持 403。
- 浏览器 POST 为零；停用账户余额保持 333.3456，订单单价保持 9.0000，状态事件、密码重置、点数划拨、三类查询账务写入均为零。已查看账户截图，确认四项原始精度、面包屑与只读入口显示。

运行中测试选择器曾将“平台设置”组按钮误当链接、全页“直属下级”命中面包屑与页内两个入口，已按真实导航限定选择器。另一次跨模块快速返回在设置初始读取 busy 时被公共离开保护拦住；测试现等待读取结束、刷新按钮启用再返回，最终通过。未修改其他模块行为。

本轮未重跑 #37 全套开户/凭据/重置/丢响应（相关产品代码未改）；四角色真实密码登录、退出、切换全组合仍引用 #37 的既有证据，本轮仅使用真实会话夹具验证角色门禁。未验证生产、其他浏览器、并发压力、正式查询/邮件供应商及 72 小时真实等待；未运行无关全量测试或共享输出的默认构建。当前 query 子页无需新公共路由修复。

前端技能核对：自动使用 Vue、frontend-coding-standards（规则版本 0.0.1），本轮未修改前端产品代码；契约、局部组件职责、既有状态与精度保持。类型检查、隔离编译/构建及专项通过；package.json 无 lint/格式化脚本，未执行；无依赖变更、规则冲突或 PENDING 决策需要澄清。

## 基线与范围

实时读取 GitHub #38（open）：要求直属列表四项点数摘要、授权多层下级只读账户、停用组织保留、缺失/失败不显示为零，并验证跨级权限。依赖 #37 的本地交付与真实验收记录已读取，且当前页面、组织接口、路由与真实数据库测试均可用；没有因远端仍 open 而停止。

基准 HEAD `04b85d8a4b72d05572004850cdd5d6c7f92812e3`。启动时工作区已有大量未提交改动，包括 #37 页面为 untracked、公共框架、报表和其他票。以读取到的 #37 页面为增量基线，保留其开户、凭据、离开保护、未知结果、重置与状态请求代码。

本票文件：

- `application/web/pages/organizations/PlatformOrganizationsPage.vue`：增加下级账户入口、`view=accounts` 子页、直属摘要、账户加载状态。
- `application/web/pages/organizations/components/PointAccountSummary.vue`：模块内部组件，仅显示四项内部点数，不读取或合并上游指标。
- `application/issue38-tests/accounts.test.ts`、`tsconfig.json`：独立专项；编译包含业务服务及本票测试，排除其他会话的测试文件。
- `application/.gitignore`：本票仅追加 `.scratch/issue38-*/`，保留已有 #37 忽略项。
- 本记录和 `ISSUE-38-EVIDENCE.json`：规格实施补充、契约、参数来源与验收。

未修改 App.vue、router/index.ts、layout、styles/index.ts、server/app.ts、reporting.ts、reporting.test.ts 或 reports 页面。

## 规格实施补充及契约对照

承接《10-控制台角色导航与页面迁移Spec》用户故事17、平台下级管理及多层查看验收项；将本记录作为 #38 的实施细化，避免并行修改公共规格文件。

| 链路 | 修改前实际来源 | 本票实现及验证 |
| --- | --- | --- |
| 直属列表 | `GET organizations` → `children[].id`；只返回直属开户组织，管理员标识另为 `accountId` | 保持列表请求和直属范围；以 `child.id` 查找 `reports.accounts[].organizationId`，从不使用 `accountId` |
| 点数 | `GET reports` 已有四项：balance、queryFrozen、salesReserved、available | 原值字符串显示；available由服务端既有 `balance-query_frozen-sales_reserved` 得出，前端不重算、不舍入、不合并上游库存 |
| 授权范围 | reports 服务从会话组织递归读取 organizations及内部账户，保留active=false | 子页只显示depth>0（排除自身），保留所有后代和停用组织；父名称由同一授权组织集合按parentId定位，不使用直属列表过滤多层范围 |
| 下级账户入口 | 无独立入口 | `RouterLink` → `/platform/organizations?view=accounts`，沿用已接入页面和History合法路径；查询参数只控制视图，不进入业务API |
| 请求参数 | reports无需目标ID，服务端从认证identity.organization_id确定范围 | 仍为无请求体的 `GET /api/reports`；没有按URL目标读取任意组织的新接口 |
| 缺失/失败 | 原始报表允许不存在内部账户行；原列表无点数摘要 | 读取中显示加载；无账户行显示“暂无点数账户数据”；字段null/undefined显示“数据缺失”；失败清除旧账户并明确失败，手动刷新恢复，不自动重试 |
| 管理操作 | `child.id → organizationId`、`child.accountId → accountId`，原直属操作与校验 | 管理代码未改；多层子页没有管理按钮或交易链接，读取不增加任何写请求；HTTP验证跨级状态、重置、建单、改价、收款、划拨403 |
| 生命周期 | #37既有范围缓存、useFormLeave、会话销毁边界 | 复用原机制；首次挂载及用户刷新只调用读取，切换本页子视图不重挂、不自动写入；未知结果原处理不变 |

本轮真实组织和账号UUID见 `ISSUE-38-EVIDENCE.json`，彼此不同。直属分销 `ba87151e-0fdf-4415-b70c-321431b2b52f` 关联余额111.1234、冻结11.0001、预留3.0002、可用97.1231；其账号为 `2441d6a1-a26b-449a-8a3e-54de708fbbf8`。三层停用终端 `ac6fa4de-70ce-4af7-bbb4-eb81d30c7920` 关联333.3456、33.0003、5.0004、295.3449，其账号为 `f14cc30e-68db-475a-8020-dc0c59c98c87`。二级分销为222.2345、22.0002、4.0003、196.2340。另一直属终端没有账户行，不生成0。

## 实际验证

使用已运行PostgreSQL实例，仅从 `.scratch/issue37-real.env` 读取连接源；测试自行 `CREATE DATABASE` 新随机专用库，所有migrate/夹具/写入都发生在新库，finally仅DROP本次创建库，不清空或迁移连接源库。最终库 `issue38_064a4660c5b141d5874270376a39758b_test` 已删除。应用独占3398；独立输出 `.scratch/issue38-dist`、`.scratch/issue38-web`、`.scratch/issue38-results.log`。每次运行生成独立随机组织和SMTP加密密钥；不输出连接串或秘密。

以下命令在 `application` 执行：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 最终通过；第一次因并行reporting.test.ts尚未使用导入失败，未修改对方文件，后来其更新后复验通过 |
| `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit` | 通过 |
| `node node_modules/typescript/bin/tsc -p issue38-tests/tsconfig.json` | 通过，隔离服务端与专项编译 |
| `node node_modules/vite/bin/vite.js build --outDir .scratch/issue38-web` | 通过；保留已有大包提示 |
| `node --env-file=.scratch/issue37-real.env --test .scratch/issue38-dist/issue38-tests/accounts.test.js` | 最终1条通过；真实Nest/HTTP/PostgreSQL/Chromium |

专项通过的实际场景：

- 直属列表2组织，精确四项值来自正确组织；多层页4组织（包含二级分销、三级停用终端及缺失账户的直属终端）；停用状态、上级名称及层级显示正确。
- 点击入口、子页直达刷新、浏览器后退/前进；不产生POST。此处实际使用现有公共真实路由与生产静态History承载，未使用临时测试路由或模拟成功业务响应。
- reports失败503后隐藏旧账户值；返回列表明确显示失败；解除故障后主动刷新恢复。仅该错误分支由浏览器拦截构造503，所有正常读取和权限断言均为真实后端/数据库。
- 平台、分销、终端管理员、业务员使用真实服务端会话；后三角色访问平台账户深链回到合法默认页，不挂载账户子页。匿名reports401；强改reports403且UI进入设置新密码。终端/业务员reports仍可读取既有自己的报表，但没有organizations字段；不将这种原有允许描述为整接口403。
- 分销report不包含兄弟组织，仍包含自己的深层停用后代；平台多层查看没有授予跨级写权限。平台跨级状态/重置/建单/改价/收款/划拨403，分销管理兄弟403，二级分销再开分销403，终端点数订单403。
- 验收后停用终端余额仍333.3456；跨级订单单价仍9.0000；组织状态事件、密码重置、点数划拨、三类查询点数流水均0。读取页面未进行采购、查询、邮件或上游更新操作。

运行历史：默认 `.env.test` 指向的55432未运行，连接拒绝后改用已运行实例作为CREATE DATABASE连接源，没有启动/重启数据库或开发服务。前两次夹具SQL因同一占位符用于uuid和text报错，改为独立参数后通过；首次完整浏览器执行仅强改页标题断言不匹配当前公共布局，修正为实际“设置新密码”后通过。最终补充跨级订单拒绝并再次通过。

## 公共接入与未验证范围

公共布局会话已完成最小接入：`ConsoleBreadcrumb.vue` 识别 `/platform/organizations?view=accounts`，显示“下级管理 / 下级账户”，并保留 `view=new` 与详情 `id` 的既有分支。当前 query 子页已通过真实路由点击、直达、刷新及前后退验收；无需新增 Router、Vite、Nest 或 App 接入，也未重复修改公共布局文件。

若公共框架后续改为独立 pathname，须由公共会话同步 router、导航、Vite 与 Nest 合法路径，并重新执行真实路由端到端验收；本票当前结果证明 query 子页。

未重新执行 #37 全套开户、凭据丢响应、重置正向与停用恢复、四角色真实密码登录/退出/切换全组合（本票身份场景使用真实会话夹具）、其他浏览器、生产部署、压力并发、正式查询/邮件供应商。现有reports接口会返回超出点数摘要的授权报表内容，保留原读取契约，本票组件只存储组织与四项账户字段；未为此新增后端轻量接口。生产供应商联调无结果，不以本次验收代替。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动；同时应用Vue技能。
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021–027、030；GUIDANCE FCS-014、032。未新增依赖，028/029无修改。
- 校验结果：上述类型检查、隔离编译、构建、专项真实业务测试通过。格式化/lint未执行：package.json未提供对应脚本；基础npm test及其他票集成/浏览器套件未执行：不覆盖本票必要流程，避免使用其他任务测试库。未执行npm run build的默认输出：为遵守共享工作区要求使用等价隔离服务端编译与Vite输出。
- 冲突：无。存量规范债务：无本票整改；保留未触及区域。PENDING：命名、排序等未提升为强制，不影响实施，无需澄清。

## 2026-10-28 原型 B 样式补充

依据 `原型设计/原型V2.html`、设计说明及当前公共样式增量调整：下级账户白色面板标题/刷新按钮同列，组织状态与上级信息归组，四项内部点数按2×2网格排列、等宽数字并强调可用余额；缺失/失败独立浅色提示；窄屏纵向组织行。页签按本页实际view显示选中态，避免Vue Router同pathname匹配导致所有query页签同时高亮。只改模板展示、class和scoped CSS，未改script业务逻辑、数值、请求字段或权限。

自动应用前端编码规范0.0.1（相关ACTIVE规则FCS-007/011/013/014/019/021–027/030/032）及Vue、frontend-design技能。`npm run typecheck`、专项tsc与隔离Vite构建通过（保留既有大包提示）；格式化/lint未执行，项目无对应脚本。真实HTTP/PostgreSQL/Chromium专项在3498端口通过；3398首次启动失败没有明确诊断，换独立端口后通过，未停止其他服务。新随机测试库只创建和删除本次库。

桌面1280×720截图 `.scratch/issue38-style-desktop.png` 已人工检查。另在临时编译副本增加390×844视口与无页面横向溢出断言，重新专项运行通过，截图 `.scratch/issue38-style-mobile.png` 已检查；该视觉探针仅在忽略的编译输出，不修改测试源或其他任务文件。两次真实验收保持组织/账号UUID不同、不同点数、跨级拒绝、缺失及503恢复、浏览器无POST及查询/划拨流水无变化。未复验开户/凭据交付的全部正向组合、其他浏览器和正式供应商；未部署、重启用户服务或提交推送。冲突与PENDING需澄清项：无。
