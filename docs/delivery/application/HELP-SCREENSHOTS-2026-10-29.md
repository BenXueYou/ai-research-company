# 帮助中心图文操作指南（2026-10-29）

## 范围与基线

按用户要求为帮助模块增加页面截图与解释说明。工作区已有帮助布局、角色帮助测试、国家选择及目录整理等未提交修改；本次沿用帮助布局，不覆盖这些既有改动。基线副本位于 `application/.scratch/help-layout/before-screenshots.vue`。

本次修改 `application/web/pages/help/RoleHelpPage.vue`，新增模块内 `components/HelpWalkthrough.vue`、`walkthroughs.ts` 和 `application/public/help/screenshots/` 下 13 张 PNG，总计约 1 MB。模块私有组件未放入全局组件目录；无依赖和接口调整。

## 展示与截图来源

四角色指南及账号设置增加“页面截图、图注、编号步骤”。保留原业务说明；图注说明使用示例数据。点击图片以原生 dialog 放大，支持关闭按钮和 Esc，关闭后焦点回到截图按钮。图片懒加载，宽度自适应；原居中布局、宽屏双列和窄屏单列保持。

截图来自本仓库当前真实 Vue 页面，在本地 Vite `http://127.0.0.1:5184` 下使用 Playwright 受控会话及 GET 响应生成，未连接真实业务数据或调用供应商。示例使用 `example.test` 邮箱；密码表单为空，未截图临时凭据。订单、邮件和成员示例均为虚构。截图仅展示部分页面，不代表执行了截图中的业务提交。

| 主题 | 图片文件名（均在 public/help/screenshots 下） |
| --- | --- |
| 平台开户、订单 | platform-organizations.png、platform-orders.png |
| 采购、计价、对账 | procurement.png、pricing.png、reconciliation.png |
| 分销开户、订单、利润 | distribution-organizations.png、distribution-orders.png、profit.png |
| 企业搜索、邮件记录、成员 | search.png、emails.png、members.png |
| 业务员权限、账号改密 | sales-permissions.png、account.png |

业务员团队权限配图来自业务员自己的查看页面；没有加入管理员维护入口。终端搜索、邮件及公共账号配图复用相同主内容区域，不含其他角色侧栏。

## 契约对照

浏览器验证脚本逐字比较 `const guides` 至 script 结束的内容（仅统一换行），与本次修改前一致，涵盖原角色映射、指南原文、path、link 和 computed。role 仍由父级会话传入，帮助组件仍仅通过原 `navigate` 事件发出路径。

| 角色 | 修改前后相同的入口路径 |
| --- | --- |
| 平台 | /platform/organizations、/platform/ledger、/platform/ledger/procurement、/platform/settings、/platform/reconciliation、/account/settings |
| 分销 | /distribution/organizations、/distribution/orders、/distribution/profit、/account/settings |
| 终端管理员 | /terminal/search、/terminal/emails、/terminal/members、/account/settings |
| 业务员 | /terminal/search、/terminal/emails、/account/settings；团队权限指南无业务按钮 |

新增交互只打开/关闭图片弹窗，无选择到业务提交的数据链路，无新增 API 请求和标识映射；未修改业务请求取值、校验、权限与费用规则。

## 验证与边界

命令均在 `application/` 执行。

- `node .scratch/help-layout/capture.mjs`：通过。13 张截图均从应用页面生成，页面运行错误为零，只允许 GET 请求。来源与结果记录于 `.scratch/help-layout/capture-results.json`。
- `node .scratch/help-layout/verify-screenshots.mjs`：通过。四角色 × 1920/1440/1024/390/320px 共 20 组；逐一滚动检查图片加载、放大图源、Esc 关闭及焦点恢复，另查关闭按钮；无横向溢出。17 个原有入口 URL 一致；帮助页无 pageerror，无业务写入。结果位于 `.scratch/help-layout/screenshot-results.json`。跳转目标使用不完整受控响应，只核对 URL，不将目标业务渲染解释为通过。
- `npm run typecheck`：通过，覆盖前后端类型检查。
- `node node_modules/vite/bin/vite.js build`：通过；保留既有大于 500 kB 的包体积提示。
- `npm run build`：通过，前端类型检查、Nest 编译和 Vite 构建均成功。13 张最终配图已复制到 `dist/web/help/screenshots/`。
- `git diff --check -- application/web/pages/help`：通过。
- 人工查看桌面/手机帮助截图和业务配图，核对内容、示例邮箱及空密码表单；复核订单、邮件与成员示例记录。
- 未执行真实数据库登录、开户、收款/划拨/退款、采购入账、收费查询、发送邮件、成员创建及修改密码流程。本次未改动这些业务代码，截图及受控响应验证不能代替真实业务验收。未部署。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1。
- 触发：自动；同时使用 vue 技能。
- 应用规则：MUST FCS-007、011、013、019、021～027、030（按触及代码适用）；GUIDANCE FCS-014。无依赖或全局状态新增。
- 校验结果：上述类型检查、完整构建、浏览器图文/弹窗/导航及 diff 检查通过。仓库未提供 lint/format 命令，未执行；默认纯逻辑、数据库集成、部署及完整 E2E 未执行，与本次展示改动不对应，具体业务未验证范围见上。
- 冲突：无。
- 存量规范债务：原指南对象的单行多属性写法未触及，不顺手整理。
- PENDING：FCS-002、003、005、006、012、015、034、035 未提升为强制要求；组件、数据文件命名、SFC 顺序和格式沿用项目惯例，无需澄清。
