# 登录目录整理

## 基线与范围

以 2026-10-28 当前工作区为基线；已有大量其他任务的未提交改动，本次仅整理 App.vue 中的登录表单、输入状态和提交逻辑至用户新建的 web/pages/login。会话 store、HTTP 适配器、路由、改密、退出及全局样式保持现有职责。迁移前副本保存在本地忽略目录 application/.scratch/login-migration。

## 契约对照

| 环节 | 迁移前后保持的来源与行为 |
| --- | --- |
| 账号 | 输入框原值 email，不裁剪、不改大小写；super_admin 使用 text，其他输入使用 email 类型 |
| 密码 | loginPassword 原值传入 auth.login(email, password)，最终 POST /api/auth/login 的 body 为 { email, password } |
| 账号标识 | 登录不提交账号 ID 或组织 ID；登录名与响应 id、email、loginName 含义保持独立 |
| 会话 | 继续使用 useSessionStore.login：登录成功后清理旧会话、重新读取 auth/session |
| 跳转 | 非强制改密账号使用 defaultPath(session.role)，跳转期间保留 navigatingAfterLogin 对离开保护的豁免；强制改密不跳转 |
| 提交与反馈 | 共用 App.run 的 busy、错误/通知清理、异常反馈；无论成功失败都清空密码，账号输入沿用原生命周期 |
| 界面与权限 | 保留文案、原生 required、自动填充、禁用状态、会话读取失败重试及未登录门禁 |

## 验证

- `npm run build`：通过，包含 Vue 类型检查、Nest 编译及 Vite 构建；有现有的前端包体积提示。
- `npm run typecheck`：通过，前后端类型检查均通过。
- `node node_modules/typescript/bin/tsc -p tsconfig.server.json`：通过，生成既有浏览器测试的编译产物。
- `node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue34-layout.config.ts account-header`：7/7 通过，覆盖四角色账号设置和返回、键盘与窄屏、强制改密退出、未保存离开拦截、退出失败与忙碌禁用。初次使用 `account-header.spec.js` 过滤时未匹配测试；编译产物有源映射，改用文件名主体后正常执行。
- `node .scratch/login-migration/verify.mjs`：迁移前后各 7 场景，共 14/14 通过。脚本通过 Vite 的临时 load 插件读取原 App.vue 构建基线，保持实际工作区文件不被覆盖；Express 提供静态页面，Playwright 拦截 API。验证脚本、原代码及逐场景结果保存在本地 `.scratch/login-migration/`。验证脚本初次运行出现执行目录、隐藏目录静态文件与请求观测时序问题，修正验证脚本后完成复验，无需改变产品代码。

| 场景 | 迁移前后实际观察 |
| --- | --- |
| 平台账号 | super_admin 原值发送，输入类型 text，成功跳转 /platform/overview |
| 分销账号 | Distinct.Local+tag@EXAMPLE.COM 原值发送，大小写和别名不变化，成功跳转 /distribution/organizations |
| 企业管理员、业务员 | 分别发送 admin@example.com、sales@example.com，成功跳转 /terminal/search |
| 临时账号 | temporary@example.com 登录后停留原路径 /help，显示强制改密，不渲染业务侧栏 |
| 凭据错误 401 | wrong@example.com 原值发送，显示错误、保留账号、清空密码、恢复提交 |
| 网络失败 | network@example.com 原值发送，显示错误、保留账号、清空密码、恢复提交 |

上述所有场景先验证空表单不提交，再验证提交中账号/密码/按钮禁用。请求 body 逐字段断言为输入框原值 `{ email, password }`，密码统一使用专用虚构夹具，响应中的 `id=distinct-account-id`、`email=different-response@example.com`、`loginName=different-login-name` 与输入账号不同，不参与最终登录参数映射；迁移前后均通过。脚本同时按全文比对确认 session store 未变。原有全局样式继续作用于相同 DOM 结构和 class。

边界：以上浏览器验证采用受控 API 响应，未连接或清空任何数据库；真实后端认证、Cookie/CSRF、数据库权限与临时密码有效期、完整改密提交及生产部署未复验。`npm test`、`test:members`、`test:t20`、专项业务浏览器和部署测试未执行，与本次登录目录整理无关；真实集成和完整端到端测试未执行。项目未配置 ESLint、Prettier 或 Stylelint 检查入口。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1。
- 触发：自动，同时采用 vue 技能。
- 应用规则：MUST FCS-007、011、013、019、021～027、030；GUIDANCE FCS-014、032；本次未修改依赖，FCS-028、029 不涉及。规则文件无 ACTIVE VERIFY 条目，按技能要求识别和执行上述既有类型检查、构建及浏览器检查。
- 校验结果：已执行、通过与未执行范围见上文；触及区域按 ACTIVE 规则人工核对。
- 冲突：无。
- 存量规范债务：App.vue 未触及区域存在单行多属性标签、导入/解构及连续空行，未扩大本次改动处理。
- PENDING：FCS-001～006、009～010、012、016～018、020 涉及目录、文件命名和书写风格，未提升为强制规则；按现有页面组件命名、template/script 顺序及缩进惯例处理，无需澄清。其余 PENDING 项与本次改动无关。
