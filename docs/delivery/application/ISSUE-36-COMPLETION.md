# #36 四角色帮助中心（部分验收）

## 2026-10-28 平台入口及链接补充验证

平台帮助入口移到侧栏主菜单末尾；分销、终端管理员和业务员继续使用底部入口。没有将帮助加入业务路由表，也没有改变业务请求或表单。帮助页的各业务链接目前指向现有路由；其中尚未拆分的页面仍由兼容工作区承载。

在隔离 Docker PostgreSQL `codex-issue36-test`（127.0.0.1:55441，`console36_test`）和真实 Nest 后端上，运行 `npx vue-tsc --noEmit`、`npx tsc -p tsconfig.server.json --outDir .scratch/issue36-dist`、`npx vite build --outDir issue36-test-web` 和 `npx playwright test --config config/playwright/playwright.issue36.config.ts`，均通过。构建提示 chunk 超过 500 kB。浏览器场景验证四角色帮助入口样式、角色内容隔离、刷新和直达、未登录及强制改密限制；逐一点击每个角色的帮助按钮，断言其具体 URL 并后退，包括账号设置。测试使用受控测试库，未连接正式供应商。

仍未逐项复验业务现场所有费用、风险、校验错误及业务提交；这些流程和后续独立页面的业务验收不能由本测试代替。未部署、推送或修改工单。

## 范围与契约

新增 `application/web/help/RoleHelpPage.vue`：根据认证会话的 `platform`、`distributor`、`admin`、`sales` 展示各自指南，导航事件由公共框架处理；未知角色不显示其他角色指南。公共框架由 #35 接入并隐藏兼容容器，分销和终端业务仍是兼容承载，帮助中明确说明。帮助页无业务请求、表单、数据选择或提交；本次没有迁移或修改既有业务组件，原请求字段、值、来源、标识、服务端取值、落库和外部调用均未改动。因此没有受本票改变的选择到提交链路，也没有将无关夹具作为此链路验收。原开户凭据有效期、采购费用、订单风险、搜索收费与发信确认等现场内容未删除；静态核对不代替所有交互复验。

## 验证环境与结果

专用 Docker PostgreSQL `issue36-console-postgres`，127.0.0.1:55441，`console36_test`；Nest 3399；独立构建 `application/issue36-test-web`、编译 `.scratch/issue36-dist`、浏览器输出 `.scratch/playwright-results/issue36`。使用真实后端及隔离测试库，未连接正式供应商。

在 `application/` 运行：

- `npx vue-tsc --noEmit`：通过。
- `npx tsc -p tsconfig.server.json --outDir .scratch/issue36-dist`：通过。
- `npx vite build --outDir issue36-test-web`：通过，Vite 提示单个 chunk 超过 500 kB。
- 设置 `TEST_DATABASE_URL=postgresql://postgres:issue36@127.0.0.1:55441/console36_test`，运行 `npx playwright test --config config/playwright/playwright.issue36.config.ts`：1 场景通过。覆盖未登录直达帮助及 API 401、平台临时密码状态直达帮助及业务 API 403；四角色依次登录，从侧栏进入帮助，核对角色特有及其他角色内容隔离、刷新、一个角色业务链接、浏览器后退和直接访问；每次退出后切换角色。夹具分别创建不同组织与账号 ID；本测试不提交组织操作。
- 首次两次运行失败：测试库清理后未重新调用初始化，平台账号不存在；增加 `migrate(pool)` 后通过。首次也增加登录完成等待。迁移测试文件后曾因旧编译输出导致同场景执行两次，均通过；最终配置限定新位置后复测一次通过。
- `git diff --check`：通过，Git 对已有文件提示换行转换；未跟踪文件不在该命令范围。

## 未完成及边界

- 平台帮助目前仍使用所有角色共用的侧栏底部 `sidebar-help`，尚未核实平台主菜单归位；已通过协调文件通知 #35。完成前不能宣布整票验收完成。
- 各角色只实际点击一个帮助业务链接；其余链接依据现有 App 路径和兼容目标静态核对，未逐个浏览器点击；账号设置链接、所有业务现场费用/风险/错误路径、所有菜单和复制链接尚未完整复验。
- 未执行开户、定价、采购、订单、搜索建档、发信等业务提交及其拒绝、金额、幂等和外部调用次数；未进行正式供应商联调。帮助页无这些提交，不把构建或导航测试作为业务验收。
- 未部署、提交、推送、关闭工单或评论。保留其他任务未提交工作。

## 前端编码规范试点反馈

规则版本 0.0.1，自动触发。适用 ACTIVE MUST FCS-007、011、013、019、021–027、030；GUIDANCE FCS-014、032，VERIFY 为项目既有检查。上述类型检查、编译和构建通过；项目未发现相关 lint/格式化脚本，其他业务专项因未触及其业务逻辑未执行。无已知配置冲突；未对未触及代码作规范整改。PENDING FCS-001–006、008–010、012、015–018、020、031、033–035 未作为实施依据，无需本次澄清。
