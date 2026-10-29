# 帮助中心布局优化（2026-10-29）

## 范围与基线

用户批准采用居中内容容器、双列业务指南、末项与常见问题通栏的方案。只修改 `application/web/pages/help/RoleHelpPage.vue`，不移动文件、不抽取全局组件。改动前该文件无工作区修改；其余已有未提交改动均未处理。已读取工程脚手架、应用运行说明和控制台角色导航与页面迁移 Spec 的帮助与契约约定。

页面沿用现有蓝色主题、系统中文字体和白色卡片。内容最大宽度由 900px 调整为 1200px 并居中，卡片间距 24px。以内容容器实际宽度 960px 为双列断点，末项为奇数时通栏；手机单列并缩小间距、内边距。新增帮助中心主标题及常见问题主题小标题，原说明逐字保留；操作入口底部对齐、显示方向箭头并保留键盘焦点。

## 契约对照

组件整个 script 块与 HEAD 基线在统一 CRLF/LF 后完全相同：role 来源仍为会话，角色映射、指南文字、path、link、computed 和 navigate 事件均未改动；常见问题原三个段落完全相同。箭头使用 aria-hidden，不改变入口可访问名称。

| 角色 | 修改前后相同的跳转参数，按页面入口顺序 |
| --- | --- |
| 平台 | `/platform/organizations`、`/platform/ledger`、`/platform/ledger/procurement`、`/platform/settings`、`/platform/reconciliation`、`/account/settings` |
| 分销 | `/distribution/organizations`、`/distribution/orders`、`/distribution/profit`、`/account/settings` |
| 终端管理员 | `/terminal/search`、`/terminal/emails`、`/terminal/members`、`/account/settings` |
| 业务员 | `/terminal/search`、`/terminal/emails`、`/account/settings`；团队权限卡无操作按钮 |

页面不存在选择到业务提交的标识映射。本次未增加请求或业务写入，不改变服务端角色门禁和校验。

## 验证与边界

以下命令在 `application/` 执行：

- `node .scratch/help-layout/verify.mjs`：通过。使用现有 Playwright 在真实 Vite 应用与 Router 下，以受控会话/API 响应检查四角色 × 五屏宽（1920/1440/1024/390/320px），共 20 组；验证居中、单双列、末卡通栏及无横向溢出。17 个操作入口点击后 URL 与上表一致，业务员无团队维护按钮，键盘焦点轮廓可见，帮助页无 pageerror。核对 script 和原说明未变，过程中无 POST 请求。
- 已人工查看 `.scratch/help-layout/distributor-1920.png` 和 `distributor-390.png`；结果明细为 `.scratch/help-layout/results.json`。截图使用测试邮箱，不含真实账号或凭据。以上为本地临时验证材料，不作为产品文件。
- `npm run build`：失败。前置 `vue-tsc --noEmit` 通过；Nest 编译被非本次触及的 `tests/issue53-search.spec.ts:119` 两处 TS2339 阻断：`HTMLElement | SVGElement` 不含 `complete` / `naturalWidth`，未顺手修复。
- `node node_modules/vite/bin/vite.js build`：通过。仅有大于 500kB 的现有包体积提示。
- `git diff --check -- application/web/pages/help/RoleHelpPage.vue`：通过。
- 未执行数据库身份专项、集成、部署测试和完整 E2E：本次为单页展示调整，以上校验使用受控响应，不验证真实登录、服务端权限拒绝、开户、划拨、退款或修改密码业务提交。目标页只核对路由，不将其业务结果解释为通过。未进行部署。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1。
- 触发：自动；同时使用 frontend-design 和 vue 技能。
- 应用规则：MUST FCS-007、FCS-011、FCS-013；GUIDANCE FCS-014。script 未改动，未新增依赖、状态或工具配置。
- 校验结果：前端类型检查、Vite 构建、浏览器布局/导航、diff 检查通过；完整 build 失败，原因见上；仓库没有 lint/format 脚本，未执行；数据库及业务专项测试未执行，原因及范围见上。
- 冲突：无。
- 存量规范债务：未修改的 script 有单行多属性对象；不扩大范围整理。完整构建暴露的无关测试类型错误另行记录于上。
- PENDING：FCS-005（SFC 顺序）、FCS-006（缩进）、FCS-012（属性顺序）、FCS-015（样式属性顺序）未提升为强制规则；沿用现有结构，无需澄清。
