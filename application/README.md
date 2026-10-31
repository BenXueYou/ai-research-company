# 身份与直属组织开户应用

工程目录、命令分层及变更验证门禁见[工程脚手架约定](../docs/engineering-scaffold.md)。本文件保留应用配置、启动和业务运行说明。

当前代码入口保持 `server/main.ts`、`server/app.ts` 和 `web/main.ts`、`web/App.vue`；业务服务、schema、控制器按领域定位。前端页面位于 `web/pages`，各业务模块内部组件位于自己的 `components` 子目录；`web/components` 只用于跨业务模块复用的全局组件。请求适配和控制台布局分别位于 `web/api`、`web/layout`，纯工具预留在 `web/utils`。页面文件归位及验证见 [Web 分层迁移记录](../docs/delivery/application/WEB-LAYER-MIGRATION.md)；先前目录调整见[结构整理记录](../docs/server-web-structure-migration.md)。

T03已提供终端企业“成员管理”：创建业务员/终端企业管理员、当次展示及复制临时凭据、停用其他成员；本人和首位管理员不可停用。组织身份取服务端当前账号，成员不需要电话。实现、参数来源和实际验收结果见[T03记录](../docs/delivery/application/T03-COMPLETION.md)。管理方重置及补发属于T04。

成员API为`GET/POST /api/members`和`POST /api/members/disable`。创建仅接受`name,email,role,requestId`，停用仅接受`accountId`；客户端不得提交组织、密码、启用状态。`npm run test:members`运行真实成员集成测试，须显式提供专用可丢弃的`TEST_DATABASE_URL`（以`_test`结尾，测试会清空该库账号表）。浏览器目标为`members.spec`，沿用现有`npm run test:e2e -- members.spec`。

本目录是 Vue 3 + TypeScript + Vite + Element Plus / NestJS / PostgreSQL 的最小真实身份闭环，不是原型账号模拟。规则以[身份决策](../docs/decisions/001-t01-identity.md)为准。实现与测试结果见[验收记录](../docs/delivery/application/VERIFICATION.md)。T02已实现直属组织开户，结果见[T02验收记录](../docs/delivery/application/T02-COMPLETION.md)。管理员重置密码、供应商接入及后续业务模块未实现。

## 开发与验证目录

| 目录 | 用途 |
| --- | --- |
| `web/`、`server/` | 前端页面与后端业务实现 |
| `tests/` | 自动化测试源码、测试夹具及专项集成验证入口 |
| `config/` | 专项 TypeScript、Playwright 等工程配置 |
| `scripts/` | 部署、验证及维护命令 |
| `.scratch/` | 临时构建、运行输出、截图及保留的历史验证材料；不是全部可删除 |
| `dist/` | 常规应用构建产物，启动命令依赖该位置 |
| `node_modules/` | 安装的第三方依赖 |

原先散落的 `integration-distribution`、`integration-terminal`、`issue38-tests`、`issue45-tests`、`issue46-tests`、`issue57-tests`、`reconciliation-route-tests`、`verification` 已集中到 `tests/` 下同名子目录。它们是需要保留的业务验证源码，不是缓存。专项维持独立编译范围，不自动加入默认测试命令。

所有命令仍在 `application/` 执行，例如：

```sh
node tests/integration-distribution/verify.mjs
node tests/integration-terminal/verify.mjs
node node_modules/typescript/bin/tsc -p tests/issue45-tests/tsconfig.json
node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue45.config.ts
```

集成入口会创建专用测试资源，先阅读相应交付记录和下文数据库说明。历史交付记录中的旧路径保持原样；当前目录及验证边界见[本次整理记录](../docs/delivery/application/TEST-DIRECTORY-CONSOLIDATION-2026-10-29.md)。T06 专项的新产物位置为 `.scratch/t06/compiled`，浏览器运行目录为 `.scratch/t06/runtime`；复验前分别用 `tsc -p tsconfig.server.json --outDir .scratch/t06/compiled` 和 `vite build --outDir .scratch/t06/runtime/dist/web` 重建。旧 `test-results/` 已保留到 `.scratch/playwright-results/legacy/`，当前 Playwright 配置继续使用各自的 `.scratch/playwright-results/` 子目录。

## 环境与安装

验证环境：Windows 11、Node.js 22.14.0、npm 10.9.2、Docker Desktop、PostgreSQL 17.6。建议 Node.js 22 LTS。以下命令均在本目录执行；使用仓库根目录终端时先进入本目录。

```sh
npm ci
```

复制配置样例并填写自有 PostgreSQL 凭据、数据库及精确的浏览器访问源：

```sh
cp .env.example .env
```

Windows PowerShell 可用 `Copy-Item .env.example .env`。配置文件不会提交。连接串的用户名、密码须正确进行 URL 编码。应用不自动建库，也不在启动时自动初始化账号。

## 本地开发数据库（Docker Desktop）

`compose.dev.yaml` 使用独立的开发数据库 `acquisition_dev`、数据卷和回环端口 `55433`，与 `compose.yaml` 的测试库分开。当前本地 `.env` 已配置数据库密码及两个独立加密密钥；该文件被 Git 忽略，应与开发数据卷一起保留，不要重新生成密钥来连接已有数据库。

在 `application/` 目录运行：

```sh
docker compose -f compose.dev.yaml --env-file .env up -d --wait
npm run db:migrate
npm run dev
```

当前配置使用 `APP_ORIGIN=http://127.0.0.1:3000`，该地址由后端提供 `dist/web` 中的前端构建。需要更新页面时先运行 `npm run build`；若另起 Vite 开发服务器，按下文将 `APP_ORIGIN` 改为 Vite 的实际源并重启后端。腾道服务尚未配置时，保持 `REDIS_URL` 和三个 `TENGDAO_*` 配置为空。

停止开发数据库并保留数据：

```sh
docker compose -f compose.dev.yaml stop
```

新环境需先按 `.env.example` 准备 `.env`，设置高熵 `POSTGRES_PASSWORD`，将 `DATABASE_URL` 指向 `postgresql://acquisition:<密码的URL编码值>@127.0.0.1:55433/acquisition_dev`，并分别生成两个独立的32字节密钥（64位十六进制）。仅对全新、专用开发库执行首次初始化。

## 新库初始化与单环境部署

本版本面向新系统、新数据库，不升级此前一次性邮箱实验库或T01旧表结构。请使用专用新库，不能清空已有业务库。使用专用新库和数据库角色；不要删除已有数据库来套用此流程。配置可由本地 `.env` 或进程环境提供，进程环境优先。

```sh
npm ci
npm run deploy
npm start
```

`deploy` 检查配置、构建应用，再执行真实数据库初始化；任一步失败立即停止。进程应由部署环境的服务管理器负责常驻与重启。首次初始化在同一事务内创建表、平台组织、内置 `super_admin` 账号及审计，仅保存密码摘要。初始密码按已批准的[身份决策](../docs/decisions/001-t01-identity.md)交付，命令不打印密码；72小时内登录并强制改密，改密前不能访问业务。平台账号没有伪造邮箱，数据库的email为空、username为super_admin；其他账号仍使用原邮箱规范。

可单独运行 `npm run db:migrate`；`npm run bootstrap` 是同一幂等初始化入口，无需交互输入邮箱。并发、重复初始化不会重复创建组织/账号，也不会修改已有密码、状态、有效期或会话。初始化成功不代表账号凭据仍有效；平台密码遗失或初始凭据过期的恢复功能已撤出一期，重复初始化不会重置凭据。

HTTP登录请求继续使用 `email` 字段承载输入值，只有精确的 `super_admin` 是非邮箱特例。普通邮箱仅域名折叠大小写，不裁剪、不合并别名。会话响应新增 `loginName` 用于显示；`email` 对平台初始账号为null，对普通账号保持真实邮箱。本人改密仍只按会话确定账号，不接受客户端目标ID。

## 启动

推荐先验证生产构建的同源运行方式：

```sh
npm run build
npm start
```

默认打开 http://127.0.0.1:3000 。`APP_ORIGIN` 必须与浏览器源完全一致（协议、主机、端口），不能混用 localhost 与 127.0.0.1。应用只监听回环地址。

开发时两个终端分别执行：

```sh
npm run dev
npm run dev:web
```

此时浏览器使用 Vite 显示的端口，并把配置中的 `APP_ORIGIN` 改为该精确源后重启后端；Vite 代理 API 至后端 3000 端口。浏览器安全策略以生产同源构建为验收目标，开发热更新不是生产部署方式。

生产须设置 `NODE_ENV=production`、HTTPS 的 `APP_ORIGIN`，并由同机 HTTPS 反向代理转发到回环端口。生产 Cookie 带 Secure。日志/代理/APM 禁止记录 Cookie、Set-Cookie、密码请求体、CSRF 头及引导输出。为数据库配置 TLS、最小权限、备份及受控迁移权限；这些运维项不由本票自动配置。当前未启用信任任意代理头，因此限流在反代后按代理地址聚合；上线前应在可信入口补充限流，不能直接信任客户端 X-Forwarded-For。

## 功能与安全边界

- 邮箱只将域名转小写，本地部分区分大小写，不合并加号别名或圆点。
- 新密码为 12～128 位可打印 ASCII 字符（英文、数字和常见符号），不允许空格，不得与当前密码相同。
- 随机盐 scrypt 摘要；随机不透明会话令牌，数据库仅存 SHA-256；CSRF 令牌独立生成并存摘要。
- 会话最长 8 小时，空闲 30 分钟失效。退出撤销当前会话；首次/主动改密撤销所有设备，必须重新登录。
- 全局守卫默认保护 API，只有登录公开；临时及重置态禁止工作台请求，不能通过直接请求绕过 UI。
- 改密仅从会话确定本人，不使用客户端目标账号字段；所有角色共用入口。重置状态的测试由数据库夹具模拟，没有本票之外的重置接口。
- 审计只保存固定事件、账号 ID、时间，不保存请求体、密码、摘要或令牌。登录错误统一提示；数据库持久化每来源 15 分钟最多 40 次 KDF 预算。
- 后续业务控制器必须保留默认守卫；当前最小工作台不代表后续多租户业务授权已实现。

## 真实 PostgreSQL 测试

**集成和浏览器测试会清空指定测试库的全部身份表。本版本须使用当前结构的新测试库，旧邮箱实验库不可直接复用。只能使用独立、可丢弃的库；库名必须以 `_test` 结尾。不要并行运行两个测试套件或与手工验收共用库。**

可使用提供的 Docker Compose 测试数据库。创建本地 `.env.test`，自行填写以下两个变量，不要提交或展示真实值：

```dotenv
POSTGRES_PASSWORD=<自行生成的高熵测试数据库密码>
TEST_DATABASE_URL=postgresql://acquisition:<上面密码的URL编码值>@127.0.0.1:55432/acquisition_test
```

```sh
docker compose --env-file .env.test up -d --wait
npx playwright install chromium
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
```

测试使用真实 Nest HTTP 服务、真实 PostgreSQL 和 Chromium，不替换后端请求。集成服务端口 3091、浏览器端口 3092，请确保空闲。浏览器测试关闭 trace 和截图，避免将凭据写入工件。测试脚本自动读取本地 `.env.test` 并编译后运行。Playwright 结果统一写入被忽略的 `.scratch/playwright-results/`，默认测试使用 `default/`，专项配置各用自己的 `tNN/` 子目录。构建产物、测试日志、浏览器报告、依赖与环境秘密均被忽略。

关闭测试数据库（保留数据卷）：

```sh
docker compose --env-file .env.test down
```

仅在确认是可丢弃的测试数据时才另行删除数据卷。测试结束后库内是测试夹具，实际部署应使用另一空库执行 npm run deploy。

## 当前验证与边界

最新补齐与验收结果见 [T01补齐记录](../docs/delivery/application/T01-COMPLETION.md)，历史REVIEW/VERIFICATION保留为旧基线证据。本地新库部署、真实PostgreSQL及Chromium流程可复验；生产HTTPS/反向代理、备份与生产权限仍需目标环境验证。开户现由T02交付；重置、点数、查询、发信仍属后续票。

## T02 直属开户

平台及分销管理员登录并完成改密后，工作台显示“下级管理”。平台可开一级分销或终端；一级可开二级或终端；二级只可开终端。填写组织名称、类型、国家区号（默认+86）、无空格电话号码、管理员邮箱，开户成功后复制临时凭据。组织及管理员同时启用，密码24字符、72小时有效；新管理员从真实登录页登录并强制改密。

上级由服务端当前账号组织确定，不接受客户端目标组织、角色、启用状态或密码。组织上级/类型/分销层级建立后不可修改。列表仅返回直属组织、管理员邮箱及脱敏联系号码，无密码查询接口。复制失败可在当前成功页重试；重复开户请求返回409并不再次返回密码。若网络中断丢失成功响应，刷新列表核实结果；重发相同请求不会再次开户，凭据补发需T04，当前未开放重置入口。

### 联系号码加密配置

部署和启动前设置 `ORG_CONTACT_KEY`：独立的32字节密码学随机密钥，以64位十六进制表示，通过受控环境变量或本地受保护配置注入。可由Node `crypto.randomBytes(32).toString('hex')`生成，勿提交、写入日志或贴入工单。安全备份并在同一数据库的所有实例使用同一密钥；直接更换会导致启动失败，当前不提供在线轮换工具。

号码以AES-256-GCM加密（组织ID为关联数据），唯一索引采用带密钥摘要。判重输入为原始区号与原始号码的有序组合；不去空格、不去前导零、不改标点、不做国际号码推断。不同区号的相同本地号码不合并。查询只显示脱敏号码。数据库记录密钥指纹，防止配置变动造成唯一性失效；初始化不输出密钥。

新库初始化及重复初始化继续保留super_admin语义。旧结构检测失败会回滚，不自动删表或迁移已有业务库。测试库会清空新增的组织开户、审计、密钥指纹表；仅在显式独立可丢弃库执行。测试自动生成运行期测试密钥，不读取供应商秘密。浏览器测试关闭截图、trace、失败DOM快照并不保留输出，凭据比对仅输出布尔结果。

## T10 公司名免费找企业

启用查询时必须同时配置 `REDIS_URL`、`TENGDAO_BASE_URL`、`TENGDAO_API_KEY` 与从供应商账号合同取得的 `TENGDAO_BUSINESS_DAILY_LIMIT`；任一缺失都会拒绝启用，不使用演示配额。Compose 已提供只绑定回环地址的 Redis，供共享令牌、跨接口分钟守卫和按日调用计数使用。API key 与访问令牌不得写入前端配置、日志或提交文件。

终端企业管理员/业务员按公司名及三位国家代码查询，每页最多 20 条。该接口免费且不产生内部点数流水，但每次供应商请求都计入共享账号数据类次数。候选默认待核实，必须人工明确确认；后续联系人和发信入口必须复用服务端已核实候选准入检查。完整实现和验证边界见 [T10 交付记录](../docs/delivery/application/T10-COMPLETION.md)。

## T18 档案及人工记录附件私有留档

部署前设置 `COMPANY_ATTACHMENT_STORAGE_DIR` 为应用可写且受文件系统权限保护的绝对路径，须位于 `dist/web` 等静态目录之外；数据库和该目录需一起备份。设置 `COMPANY_ATTACHMENT_SCANNER` 为安全扫描程序可执行文件；程序收到私有临时文件路径作为最后一个参数，仅退出码 0 表示通过。若需要固定参数，使用 JSON 字符串数组 `COMPANY_ATTACHMENT_SCANNER_ARGS`。未配置或扫描失败时上传被拒绝；正式环境需实际部署并验证扫描程序。

终端企业成员从档案上传、下载，或把附件挂在本档案人工记录；企业管理员可软删除，文件到期（默认两年）后可手动清理，系统不会自动删除。格式白名单为 jpg/png/webp、pdf/doc/docx/xls/xlsx/ppt/pptx、zip/rar；服务端核对扩展名、MIME 和文件特征，单文件最多 20MB，每企业最多 50 个未删除附件。附件只经鉴权接口访问，下载和变更均写审计。档案附件不会进入邮件发送，邮件仍只使用平台预设模板附件。完整验证见 [T18 交付记录](../docs/delivery/application/T18-COMPLETION.md)。

## T19 国内 SMTP 团队渠道

终端企业管理员可在工作台维护本企业最多一套国内 SMTP：服务地址、端口、TLS/STARTTLS、SMTP账号、授权凭据、团队回复邮箱及是否为默认渠道。业务员只能查看不含凭据的团队配置和验证结果；平台、分销与其他企业不能借查看权限维护本企业设置。接口为`GET/POST /api/sending-channels/smtp`，组织始终取当前会话，不接受客户端组织标识。

部署及启动必须配置独立的`SMTP_CREDENTIAL_KEY`：32字节密码学随机值，以64位十六进制表示。该密钥用于AES-256-GCM加密SMTP授权凭据，组织ID和渠道类型作为关联数据；数据库保存密钥指纹并拒绝直接换钥。密钥不得复用`ORG_CONTACT_KEY`、提交、记录日志或放入前端配置，须由受控密钥配置提供并安全备份。

当前默认适配器不会连接真实SMTP，而明确保存`not_live_verified`结果；测试通过注入受控适配器验证可用、不可用及异常结果。真实SMTP认证/连接、DNS、发信投递、退信和回复实收属于T31，当前配置页和本地验证不能作为生产联调证据。完整实现、参数来源及验收边界见 [T19交付记录](../docs/delivery/application/T19-COMPLETION.md)。

## 企业来源与精确详情专项

设计规则见[来源定位决策](../docs/decisions/002-company-source-identity.md)。来源选择、人工归档、联系人/邮件准入分别管理。旧 identity_state 默认值不会自动生成操作证据；现有记录需具备独立、可追溯的准入依据，不能通过直接改 verified 放行。当前尚无正式证据登记工作流，未具备依据的联系人/发送保持拒绝；上线前须完成证据登记与存量准入验收。

正式腾道适配器尚未配置 recordLookup：缺少精确请求原文契约时，来源详情报价在冻结前拒绝。测试注入的 recordLookup 只用于受控验证，不能通过将 supplierVerified 改为 true 代替证据。费用未知时资料可读，自动获取费用证据仍由后续账务票实现。

以下命令要求显式设置 TEST_DATABASE_URL，库名以 `_test` 结尾且必须专用、可丢弃。浏览器命令会清空该专用库的 public schema；不要与其他测试并行共用库。

- `npm run test:company-sources`：真实HTTP、来源/详情/邮件准入、迁移及票03/04专项。
- `npm run test:company-sources:browser`：构建专项页面后，执行公司名/产品词关联和档案来源详情流程，输出截图到 `.scratch/company-sources/`。

实际结果和未验证边界见[本轮交付记录](../docs/delivery/application/SOURCE-IDENTITY-2026-10-31.md)。
