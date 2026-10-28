# #34 公共控制台与角色导航

2026-10-28 当前复核：下文为早期交付基线；当前实现已经采用 Router/Pinia、公共布局和 formLeave，账号设置期间保留所需兼容及限定缓存实例。最新四角色、History、布局和会话回归见 [本轮公共集成](PARALLEL-PLATFORM-INTEGRATION-2026-10-28.md)，布局历史证据见 [布局交付](ISSUE-34-LAYOUT-COMPLETION.md)。全角色兼容退出仍未满足条件，不以公共框架通过代替业务迁移验收。

## 修改前契约基线

- HEAD：`9b6145373a30d2597a4326099c67f402155c591c`。工作区已有本地开发配置、需求及设计资料的未提交修改，本次保留。
- 原工作台按会话 `role` 挂载业务组件。登录提交输入的 `email`、`password`；改密提交当前密码、新密码和确认密码，账号由服务端会话确定，成功撤销会话；会话 `id` 传入成员管理及企业搜索。
- 下级列表的 `child.id` 用于组织状态请求的 `organizationId`，`child.accountId` 用于密码重置的 `accountId`；开户使用表单名称、类型、国家区号、电话和管理员邮箱。此次没有修改业务组件及这些提交代码。

## 实施范围和限制

公共账号区、按会话角色的菜单及默认路径、History 和高亮已接入。未迁移业务继续聚合在兼容工作区，菜单滚动到相应原组件；它们不是独立业务页面。部分入口尚无独立目标：业务员成员入口不挂载管理员组件，帮助入口尚无正式帮助内容；档案入口暂指向企业搜索。`/account/settings` 继续使用原有改密功能。账号设置完善、帮助、平台业务页面及分销和终端页面迁移属于后续票，不能以此次菜单交付替代。

## 验证

使用任务专用 Docker PostgreSQL `issue34-console-postgres`（127.0.0.1:55439，库名 `console34_test`）、Nest 端口 3199、Vite 端口 5199；测试结束后停止了该容器和 Vite，未操作手工开发数据库。构建及测试输出为 `application/issue34-test-web` 和 `application/.scratch/issue34-*`；清理这些输出的命令被执行策略拒绝，因此输出仍在本地。

在 `application` 目录执行：

- `npx vue-tsc --noEmit`、`npx tsc -p tsconfig.server.json --noEmit`：通过。
- `npx vite build --outDir issue34-test-web`：通过。
- `npx tsc -p tsconfig.server.json --outDir .scratch/issue34-dist`，设置指向上述独立库的 `TEST_DATABASE_URL` 后运行 `npx playwright test --config config/playwright/playwright.issue34.config.ts`：1 个浏览器场景通过。
- Vite 使用独立 5199 端口：`/platform/organizations`、`/terminal/search`、`/help` 返回 HTML 200；缺失静态文件返回 404，未知 API 返回 404 而非成功 HTML。Nest 测试同样检查缺失资源及未知 API 为 404。
- `git diff --check`：通过（Git 仅提示已有文件的换行转换）。

浏览器场景覆盖平台、分销、终端管理员、业务员登录和默认路径、角色切换、非法角色路径回退、刷新、前进后退、当前位置、账号设置返回；未登录及强制改密请求拒绝；平台首次强制改密后重新登录；业务员成员接口拒绝；实际开户、管理员重置密码和停用组织。

组织夹具实际创建不同的直属组织 ID 和管理员账号 ID，并验证父组织 ID 不同于账号 ID。选择该直属组织后，重置请求的 `accountId` 等于该行管理员账号 ID，且不同于组织 ID；状态请求的 `organizationId` 等于组织 ID、`active=false`，并验证对应组织落库停用。服务端根据会话确定操作者及其组织。开户结果通过组织与账号关联和父组织查询核对；此次没有捕获完整开户请求快照。

## 尚未验证

- 未完整逐一验证四角色每个菜单与所有业务组件的可用性、各角色直接链接和复制链接；兼容容器的所有业务仍聚合展示。
- 未验证主动改密的旧会话失效、改密校验拒绝、组织操作的跨级拒绝、订单/采购/报表的余额流水及幂等、搜索到档案和邮件的参数链路、供应商调用次数及正式供应商联调。
- 未实现或验证后续票的独立业务页面、角色帮助及未提交表单离开提示；进入账号设置会卸载当前兼容业务容器，未提交表单可能丢失。
- 构建和类型检查不代表上述业务流程验收。此次没有部署、重启现有服务、提交、推送或修改 Issue。
