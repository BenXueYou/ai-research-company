# 顶部账号菜单（方案 1）

日期：2026-10-28（Asia/Shanghai）。用户确认采用“统一账号菜单”。

## 改动范围

- `application/web/layout/ConsoleHeader.vue`：使用现有 Element Plus Dropdown，在右上角展示头像首字母、当前登录账号和箭头；菜单展示账号、角色、账号设置及分隔后的退出登录。
- `application/web/styles/index.ts`：补充 Dropdown 必需样式。
- `application/tests/browser/account-header.spec.ts`：新增 7 个浏览器场景。
- 根 `.gitignore`：仅追加该测试文件的白名单，保留工作区已有修改。
- 工作区已有大量未提交业务改动，本次没有修改其业务逻辑、目录或参数。

账号菜单属于控制台布局，继续放在 `web/layout`，没有抽入全局组件或业务模块。默认关闭，点击切换；支持键盘操作、Esc 关闭与点击外部关闭。路由或会话变化时关闭菜单。长账号顶部省略，展开后完整换行显示。

## 契约与行为

| 项目 | 修改前 | 修改后 |
| --- | --- | --- |
| 账号文案 | `session.loginName` | 相同；头像只取其首字符大写用于显示 |
| 角色 | 服务端会话 `session.role` | 相同；仅映射中文展示名，不改变权限判断 |
| 账号设置 | `!session.mustChange` 时发出 `settings` | 相同，通过菜单触发；增加同条件的事件处理保护 |
| 退出 | `busy` 时禁用，发出 `logout` | 相同，通过菜单触发；增加忙碌事件处理保护 |
| 退出请求 | `App.vue` 中 `request('auth/logout', {})` | 相同，方法仍为 POST、请求体 `{}`、CSRF 仍来自 `identity_csrf` Cookie |
| 未保存修改 | `formLeave.prepareLeave()`、`organization-before-logout` | 沿用原流程；本次未改动 |
| 设置返回 | 原有 `previousPath` 和角色默认路由判断 | 沿用原流程；帮助页不属于合法业务返回页，仍返回角色默认页 |
| 退出失败 | 原有错误反馈，成功前不清除会话或表单 | 相同 |

夹具明确区分 `id`、`email` 和 `loginName`：例如 `different-account-id`、`different-email@example.com`、`super_admin`。显示来源只用 `loginName`，退出请求不新增上述标识字段。

## 验证

- `npm run typecheck`：通过，前后端类型检查。
- `npm run build`：通过；沿用 Vite 的大于 500 kB 包体积提示，本次未扩大至分包优化。
- `node node_modules/typescript/bin/tsc -p tsconfig.server.json`：通过，编译浏览器测试。
- `node node_modules/@playwright/test/cli.js test --config playwright.config.ts account-header`：7 个通过。
- `git diff --check`（本次触及文件）：通过。

浏览器测试使用真实构建产物和页面、拦截身份接口，不连接或清空数据库：

1. 平台、分销、企业管理员、业务员分别验证默认收起、显示来源、角色、账号设置跳转及原有返回路径（4 个用例）。
2. Enter 打开并聚焦、方向键切换、Esc 关闭并返回焦点、点击外部关闭；1440、375、320 px 下长账号菜单处于视口内。
3. 首次登录强制改密时无设置菜单项，仍可退出并回到登录表单。
4. 有未保存密码时取消退出，不发送请求且保留表单；接受退出但请求 503 时保留会话与表单；重试过程中菜单退出禁用；成功回到登录表单。两次请求均为 `{}`，CSRF 值保持一致。

首轮测试对“帮助页返回目标”和 Dropdown 自带的键盘首次聚焦行为有误判；对照原有代码及组件行为修正测试预期后，上述场景通过，没有为满足测试改变业务流程。

本机对实际账号菜单进行了截图复核。未执行真实数据库身份服务、生产环境、其他业务模块的全量回归；原有部分浏览器用例直接查找顶部“账号设置／退出登录”按钮，其选择器需在后续运行时按新菜单交互适配。本次定向用例已使用实际菜单操作。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1。
- 触发：自动；Vue 3 前端修改。
- 应用规则：MUST FCS-007、011、013、019、021–027、030；GUIDANCE FCS-014。局部展开状态使用组件浅层引用，未新增全局状态或依赖。
- 校验结果：类型检查、构建、定向浏览器测试及 diff 空白检查通过。项目未配置格式化、lint、Stylelint 脚本，未执行；数据库测试和全量浏览器测试未执行，原因见验证边界。
- 冲突：无。
- 存量规范债务：本次未审查未触及代码；旧浏览器选择器兼容性见上文。
- PENDING：FCS-005（SFC 块顺序）、010（第三方标签形式）、015（样式属性排序）等仍未生效；沿用现有组件习惯，不需要澄清。
