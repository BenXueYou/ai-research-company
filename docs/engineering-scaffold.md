# 工程脚手架约定

本约定用于现有 `application/` 的增量开发和工程整理。业务范围及验收以 [第一阶段 Spec](../需求设计/08-第一阶段实施规格Spec.md#现有应用工程脚手架整理方案) 为准；具体业务规则以相应 PRD、技术设计和已批准决策为准。本文描述入口和工作方法，不改变现有接口、数据库初始化或业务取值。

## 入口和目录

| 位置 | 当前职责 | 新增代码的放置原则 |
| --- | --- | --- |
| `application/package.json`、`package-lock.json` | 唯一应用包与锁文件；npm 脚本入口 | 在此维护稳定命令；一次性排查命令不提升为常规脚本 |
| `application/web/main.ts`、`App.vue` | 安装 Pinia / Router 并挂载应用；应用外壳管理会话、登录、改密和路由出口 | 不在外壳重新集中引入业务组件；保持会话代次、身份门禁和导航职责 |
| `application/web/router/`、`stores/session.ts` | 路由表、角色门禁、导航元数据与共享会话状态 | 新路由按实际页面职责接入；请求参数来源留在所属业务模块 |
| `application/web/layout/`、`pages/` | 公共布局、未迁移业务的 `CompatWorkspace.vue` 和按业务域归位的页面及组件 | 已迁移页交由 RouterView 渲染；兼容容器仅保留未迁移模块，并保持实例状态与角色条件 |
| `application/server/main.ts`、`app.ts` | 进程启动、Nest 应用装配 | 新业务放对应服务、控制器和校验代码；装配入口只连接依赖 |
| `application/server/database.ts`、`cli.ts` | PostgreSQL 连接、当前新库初始化入口 | 数据结构变化先核对当前初始化路径；版本化迁移和回滚须单独设计验证 |
| `application/server/{identity,organizations,commerce,companies,email,upstream}/` | 各业务域的控制器、服务、schema 与上游适配 | 保持服务端权限、事务和适配器边界；移动文件时逐批核对公开行为 |
| `application/server/composition/services.ts` | 现有服务及适配器组装 | 只连接既有服务依赖；不在装配层改变请求字段和业务默认值 |
| `application/tests/`、`tests/browser/` | 纯逻辑、真实 PostgreSQL/HTTP、浏览器场景 | 按受影响流程选择测试，并记录夹具与观察到的业务结果 |
| `application/scripts/`、`compose.yaml`、`.env.example` | 部署入口、本地测试依赖和配置样例 | 新配置同时更新样例与运行说明；秘密只放受控环境或忽略的本地文件 |
| `需求设计/`、`docs/decisions/`、`docs/delivery/application/` | 规格、已批准决策、各票交付证据 | 规格证明契约，交付记录证明实际执行；历史记录不能代替新验证 |

`web/` 与 `server/` 的首批业务文件已按业务域整理，入口文件保持原位置。各领域实际移动范围、契约对照和验证边界见[结构整理记录](./server-web-structure-migration.md)。后续继续按小批次调整时，保留现有路由、请求/响应、鉴权、数据库读写、外部调用和页面提交行为；目录结构本身不授权修改业务逻辑。

### 控制台页面迁移现状（2026-10-28）

平台直属下级管理已由 `pages/organizations/PlatformOrganizationsPage.vue` 承载；列表、开户和详情分别通过 `/platform/organizations`、`?view=new`、`?id=<直属组织ID>` 定位，平台兼容容器不再挂载旧开户组件。页面按范围缓存以保留请求未确认上下文，采用公共离开保护；分销仍使用原组件。实际验收见 [#37交付记录](delivery/application/ISSUE-37-COMPLETION.md)。

`/platform/reconciliation` 已由 `pages/upstream/ReconciliationPage.vue` 作为真实路由页承载查询结果人工核对与上游快照入口；`/platform/reconciliation/upstream` 仍为独立上游监控页。前者只缓存本页实例，核对表单接入公共 `useFormLeave`：未提交修改离开时可继续编辑或确认放弃；提交中阻止离开；提交结果未知时保留核对上下文，经确认可离开并返回主动刷新核实。确认放弃会清除选择，返回不重发列表请求或业务提交。详见 [Issue #46 交付与真实业务验证](delivery/application/ISSUE-46-COMPLETION.md)。`App.vue` 不再逐个引入业务组件；未迁移内容集中由 `layout/CompatWorkspace.vue` 承载，仍按原角色条件挂载并在兼容菜单间保持实例。除上述对账页外，现有菜单仍有指向 `EmptyRoute.vue` 的兼容定位路由；菜单可用不代表独立页面已交付。

迁移下一域前先从 `router/index.ts` 和兼容容器核对该域是否重复挂载，确定表单、结果未确认请求及页面缓存边界，再记录前后请求字段和值来源。当前批次的前端核对与未验证范围见[对账页迁移记录](delivery/application/RECONCILIATION-ROUTE-MIGRATION.md)。平台其他业务页、分销与终端独立页仍按[控制台页面迁移 Spec](../需求设计/10-控制台角色导航与页面迁移Spec.md) 分批完成。

本轮 #40/#41/#42 共享集成：平台 `/platform/ledger` 使用 `PlatformPointOrdersPage`，新增 `/platform/ledger/procurement` 采购与费用页面，`/platform/settings` 保留独立计价与系数设置。采购与系数的旧兼容挂载已移除，分销订单与终端兼容模块继续保留。缓存仅包含明确组件名，以会话 generation 销毁；账号设置返回保留合法业务来源的 query/hash。Nest 与 Vite 白名单同步覆盖采购及已存在的邮件设置、业务数据深链。公共 `formLeave` 已可用，其接入契约与验证见 [#35 现状复核](delivery/application/ISSUE-35-DEPENDENCY-AUDIT.md)和[本轮汇总](delivery/application/PARALLEL-PLATFORM-INTEGRATION-2026-10-28.md)。这些接入不表示 #40 待补库存业务状态或全角色兼容退出已完成。

## 工具链与命令

`/platform/overview` 已由 `pages/overview/PlatformOverviewPage.vue` 承载平台只读运营概览，库存/上游历史快照/查询及订单待办复用原 GET 接口，App 不再把概览作为兼容路径挂载。页面离开销毁、返回重新读取，不增加业务写入或上游更新；四个快捷入口、角色门禁及 Nest/Vite History 验证见 [#47 交付记录](delivery/application/ISSUE-47-COMPLETION.md)。订单摘要已接入 #40 最终 `awaiting_stock` 契约，不表示其他角色兼容模块全部退出。

所有 npm 命令在 `application/` 执行。项目使用 npm 和已提交的 `package-lock.json`；当前已验证的本地环境为 Node.js 22.14.0 / npm 10.9.2，这只是复验参考，不限定其他版本。安装使用 `npm ci`，依赖变更同时提交 `package.json` 和锁文件。前后端均使用 TypeScript；应用栈为 Vue 3 + Vite + Element Plus / NestJS / PostgreSQL，部分流程使用 Redis。

项目安装了本地 Nest CLI。`npm run dev` 使用 `nest start --watch`，`npm run build` 使用 `nest build` 编译服务端，均显式采用 `tsconfig.server.json`，保持 `dist/server/main.js` 入口。`npm start` 运行该编译产物。代码生成可先用 `npx nest generate service identity/example --dry-run --no-spec --skip-import` 预览路径；生成的文件和依赖装配须按现有业务域结构人工核对。

| 用途 | 当前入口 | 作用与边界 |
| --- | --- | --- |
| 开发 | `npm run dev`、`npm run dev:web` | 后端与 Vite 分别启动；浏览器源须与 `APP_ORIGIN` 一致 |
| 静态检查 | `npm run typecheck` | 前后端 TypeScript 检查，不代表业务流程通过 |
| 纯逻辑 | `npm test` | 当前运行 `policy.test.ts`，不是全部测试 |
| 构建 | `npm run build` | 类型检查、服务端编译、前端构建；不连接数据库 |
| 数据库初始化 | `npm run db:migrate` / `npm run bootstrap` | 当前两者进入同一新库初始化逻辑；不代表版本化迁移或回滚 |
| 部署准备 | `npm run deploy` | 检查必要配置，构建，再调用 `db:migrate`；对真实 `DATABASE_URL` 有写入效果 |
| 启动 | `npm start` | 运行已构建的 `dist/server/main.js` |
| 基础集成 | `npm run test:integration` | 当前脚本仅列出身份、组织、成员、SMTP、U-Mail、公司搜索六个测试文件 |
| 基础浏览器 | `npm run test:e2e` | 构建后运行默认 Playwright 配置；专项 `test:e2e:t*` 配置按受影响票选择 |
| 部署测试 | `npm run test:deployment` | 单独验证部署入口；先确认其测试环境与数据边界 |

`test:members`、`test:t20` 等专项命令保留为有明确覆盖范围的入口。新增业务测试若未加入常规脚本，应在交付记录中写出实际执行命令；不得把 `test:integration` 或 `test:e2e` 的通过解释为所有票均已覆盖。脚本列表以 `package.json` 为准。

## 从安装到验证

1. 在 `application/` 执行 `npm ci`。按 [运行说明](../application/README.md#环境与安装) 配置 `.env`；开发和测试分别使用自己的配置与数据库。
2. 对**全新、专用**应用库，核对 `DATABASE_URL` 和配置后运行 `npm run deploy`，再运行 `npm start`；当前初始化不用于升级旧业务库。部署命令会写库，不能用于只读检查。
3. 测试使用独立、可丢弃、库名以 `_test` 结尾的 `TEST_DATABASE_URL`。按 [真实 PostgreSQL 测试说明](../application/README.md#真实-postgresql-测试) 准备 `.env.test` 和 Compose；测试会清空目标库中的表，不与手工验收或另一套件并行使用同一库。
4. 先运行适用的类型检查、构建或纯逻辑测试，再运行受影响的真实 HTTP/数据库与浏览器场景。供应商受控适配器测试和正式账号联调分开记录。

## 工程变更门禁

工程整理或页面迁移前，先在交付记录中建立受影响契约表：用户选择、数据来源、前端状态、最终请求字段和值、服务端取值、持久化/外部调用、权限和拒绝结果。以改动前代码与可运行场景为基线；当前工作区若有未提交改动，先标出所属任务，避免把别人的改动计入本次整理。

选择到提交链路的夹具应把 `id`、`fileId`、列表标识、详情 `data.id`、内部企业 ID、`mailsouId` 等适用字段设为**不同值**；身份链路也区分组织 ID、账号 ID、登录邮箱与回复邮箱，国家字段区分显示值与提交值。只记录该链路实际存在的字段，不按名称推断映射。修改前后逐字段对照值及来源，连同提交条件、默认值、兜底顺序和校验结果保存证据。

按影响范围检查允许与拒绝路径、租户权限、账务余额/流水、外部调用参数和调用次数。业务疑点单独提出；工程整理不顺手修正规则。类型检查、构建及无关测试只证明其自身范围。

### 交付记录格式

每批工程变更可在 `docs/` 或相应票的 `T*-COMPLETION.md` 记录：

| 项目 | 应记录的事实 |
| --- | --- |
| 基线 | 基准提交/工作区状态、移动或修改的文件、受影响路由和页面 |
| 契约对照 | 选择值、各标识的不同测试值、修改前后请求参数及取值来源、响应/落库/外部参数 |
| 验证 | 实际命令、环境、测试库、场景及允许/拒绝结果；账务和调用次数按适用范围记录 |
| 边界 | 未执行流程、外部阻塞、正式供应商或生产环境尚未验证的事项 |

完成标准：读者能从入口定位代码和命令；受影响的每条业务链路有前后取值及来源证据；执行结果与未验证范围明确。环境具备时再按上节完成新库安装、初始化、构建、启动和适用测试的复验。
