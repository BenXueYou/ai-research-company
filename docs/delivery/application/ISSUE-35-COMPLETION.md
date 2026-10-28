# #35 独立账号设置与离开交互

## 2026-10-28 依赖状态复核

公共能力已存在且被 #43/#46 等页面使用；旧记录“公共能力未交付”的判断已过期。当前接入契约见 [依赖复核](ISSUE-35-DEPENDENCY-AUDIT.md)，本轮真实账号、公共状态、缓存、History 与身份回归见 [2026-10-28 公共集成记录](PARALLEL-PLATFORM-INTEGRATION-2026-10-28.md)。以下为历次验证基线；其中手写 History、其他表单未接入等描述不代表当前实现。公共前置可用、各业务整票验收及全角色兼容退出应分别判断。

## 2026-10-28 当前工作区复验

保留工作区已有的依赖、会话和 HTTP 改动，使用独立 Docker PostgreSQL `codex-issue36-test`（127.0.0.1:55441，`console36_test`），顺序运行 `npx tsc -p tsconfig.server.json --outDir .scratch/issue35-dist`、`npx vite build --outDir issue35-test-web` 和 `npx playwright test --config config/playwright/playwright.issue35.config.ts`，均通过；构建提示 chunk 超过 500 kB。浏览器场景包括账号设置导航、强制和主动改密、四角色、开户响应丢失重试以及直属组织与账号不同 ID 的参数核对，具体范围见下方补充验收。

其他业务表单仍未逐一接入或验收离开提示。订单、采购及配置的待确认请求和资金结果仍需对应迁移票验证；不以本次通过认定全部表单已受保护。

## 基线与实现

基线为工作区现有未提交的 #34 实现，HEAD `9b6145373a30d2597a4326099c67f402155c591c`；保留既有修改。账号设置沿用 `/account/settings`、`POST /api/auth/password`；当前密码、新密码、确认密码分别来自三个表单输入，服务端根据会话确定本人，不传账号 ID。成功后清除前端会话，服务端撤销该账号所有会话。前端规则保持 12–128 位可打印非空格 ASCII 和两次一致；当前密码与新旧相同由服务端拒绝。未修改下级、订单、采购等请求和幂等规则。

右上角进入记录当前角色合法业务来源；直接访问或无合法来源返回角色默认页。设置表单有输入时，菜单、返回及浏览器后退询问是否放弃；继续编辑保留输入，放弃后清除。提交期间阻止应用内导航；网络或响应解析失败提示结果未确认，当前页面会话中禁重复提交。兼容工作区在账号设置期间隐藏而非卸载，避免其内部请求标识和输入因切换丢失；刷新和跨页面持久化不在此保证范围。离开不触发业务取消、退款或重试。其他业务表单尚未接入离开门禁，不能宣称已保护。

#45 协调：仅平台允许 `/platform/reconciliation/upstream`，Nest 和 Vite History 清单均加入该路径。该路径单独显示对方 `UpstreamMonitorPage`，兼容容器隐藏且不重复挂载旧监控组件，上游与对账菜单高亮。该页面领域验收由 #45 负责。

## 验证

专用 Docker PostgreSQL `issue35-console-postgres`（127.0.0.1:55440，`console35_test`），Nest 3299；浏览器构建及结果分别为 `application/issue35-test-web`、`application/.scratch/issue35-dist` 和 `application/.scratch/playwright-results/issue35`。未操作手工开发库。

- `npx vue-tsc --noEmit`：通过；`npx tsc -p tsconfig.server.json --outDir .scratch/issue35-dist`：通过；`npx vite build --outDir issue35-test-web`：通过。
- `npx playwright test --config config/playwright/playwright.issue35.config.ts`：1 场景通过。真实后端覆盖未认证拒绝、平台初始强改及业务 403、四角色登录与切换、无权路径回退、直属组织开户/重置/停用，账号设置取消返回及浏览器后退保留输入、确认放弃、错误当前密码、主动改密后另一设备会话 401 和新密码登录，#45 子路径直接加载及菜单高亮。直属组织 ID、管理员账号 ID、父组织 ID 各不相同；重置 accountId 和组织状态 organizationId 分别来自对应原字段。
- 首次 #45 子路径直达测试返回 404，加入服务端 History 清单后复测通过。
- `node --test --test-concurrency=1 .scratch/issue35-dist/tests/identity.test.js .scratch/issue35-dist/tests/password-resets.test.js`：失败；身份专项并发主动改密预期 200/401，实际 400/400。现有夹具 second/third 密码含非 ASCII，与现有密码规则冲突；本次未改变测试或业务规则。其余输出包括强改限制、会话到期、四角色本人目标、平台引导与管理重置子项通过；整个命令不能记为通过。
- `git diff --check`：通过，Git 报已有文件换行提示。

## 尚未验证和已知限制

未逐项验证账号表单菜单离开、所有密码边界、响应丢失后切换/刷新、提交中请求、不同角色各自设置来源与旧密码拒绝。未对兼容业务表单真实模拟已提交响应丢失、切页再返回的幂等、余额和流水；兼容容器并非跨刷新持久化机制。未逐一验证所有菜单、深层复制链接和后续业务页面；#45 的业务结果和权限由其专项任务验证。当前浏览器后退取消通过重新压入当前 URL 恢复，历史栈细节仍需进一步验证。账号结果不确定状态仅保留在当前页面会话内，刷新后须由用户重新登录核实。上述缺口未计入完成。

未部署、提交、推送或修改 Issue。前端编码规范技能自动触发，规则版本 0.0.1；适用 ACTIVE MUST（FCS-007、011、013、019、021–027、030）、GUIDANCE（014、032）及项目既有类型检查；未改依赖或配置以接入规范。未发现本次触及代码与项目自动化配置冲突；未触及存量代码未作规范整改；PENDING 项未作为实施依据。项目无相关 lint/格式化脚本，其他与本次变更无关的专项测试未执行。

## 2026-10-28 补充验收（覆盖上文旧的失败与缺口描述）

- 修正 `tests/identity.test.ts` 并发成功场景的两个非 ASCII 密码夹具为互不相同、符合规则的 ASCII；增加明确的非 ASCII 改密 400 断言，未修改业务规则。`node --test --test-concurrency=1 .scratch/issue35-dist/tests/identity.test.js .scratch/issue35-dist/tests/password-resets.test.js`：12 项通过，包括并发仅一笔成功、全设备失效、四角色本人改密及重置、临时凭据和会话到期、CSRF/Origin 拒绝。`npm test`：3 项通过，包括 12/128 位边界、129 位、非 ASCII 和空格拒绝。
- 使用同一独立 `_test` 数据库及 3299 端口，`npx tsc -p tsconfig.server.json --outDir .scratch/issue35-dist`、`npx vue-tsc --noEmit`、`npx vite build --outDir issue35-test-web` 均通过；Vite 提示打包块超过 500 kB。`npx playwright test --config config/playwright/playwright.issue35.config.ts`：1 场景通过；源码保存在 `application/tests/browser/issue35-navigation.spec.ts`。
- 浏览器进一步覆盖账号输入后菜单和返回拒绝离开保留三字段、后退拒绝保留、后退确认放弃、前进后表单为空；平台、分销、终端管理员、业务员的各自合法来源返回及刷新；错误当前密码、相同密码、短密码、129 位、空格、非 ASCII 拒绝；成功改密后旧密码拒绝、新密码登录、另设备旧会话 401。帮助页往返保留开户输入。
- 真实改密请求先由服务端完成，再通过 Playwright 阻断响应：提交期间菜单不离开、提交按钮不可用；结果不确定时切页返回仍禁止重复提交，捕获 POST 恰好一次，刷新后旧密码拒绝、新密码登录。该测试不证明刷新后还保留不确定状态；刷新重新验证会话并要求登录。
- 真实开户先由服务端完成再阻断响应：切换账号设置并返回保留输入；不自动重发；用户手动重试时两次完整请求体（含 requestId）一致，服务端返回已完成且只存在一个组织。开户组织和管理员账号 ID、父组织 ID 不同；状态、重置分别使用原 organizationId 与 accountId。未更改业务 payload 和幂等规则。
- `/help` 已接入 #36 提供的 `RoleHelpPage`，向其传入会话角色，导航事件使用公共门禁，兼容容器隐藏且不销毁。`/platform/reconciliation/upstream` 已在 Nest 和 Vite History 承载，独立页面及菜单高亮已由本浏览器场景覆盖；专项业务结果由 #45 验证。

剩余边界：账号结果不确定状态不跨刷新持久化；其他业务表单尚未逐一接入未提交提示，兼容容器在会话内保留不代表跨刷新草稿；订单、采购、费用、邮件等丢响应及资金流水仍属各后续业务票验收。未逐一验证所有菜单和深层链接、正式供应商及部署环境。#36/#45 内容与业务验收分别由对应任务负责。未提交、推送、部署、关闭 Issue 或发表评论。

帮助页接入后的补充回归：从帮助页进入账号设置时视为非业务来源，返回当前角色默认页，随后回下级管理仍保留之前输入；最新构建和上述浏览器场景重新通过。
