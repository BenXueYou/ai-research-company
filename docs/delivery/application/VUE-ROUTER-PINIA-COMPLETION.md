# Vue Router / Pinia 公共基础迁移交付

日期：2026-10-28。基准提交 `9b61453`。实施前工作区已有 #34、#35、#36、#45 等未提交修改及未跟踪文件；原样保留。迁移前请求来源见 [基线记录](VUE-ROUTER-PINIA-BASELINE.md)。本次只交付公共路由与会话基础，不把兼容菜单声明为平台、分销或终端业务拆页完成。

## 实施范围

- 固定 `vue-router@4.6.4` 和 `pinia@3.0.4`，更新 npm 包清单及锁文件。安装时工作区包清单已有别的任务新增的 Nest CLI 和 `packageManager`，npm 同步锁文件时也补入这些既有声明；本次没有改动它们的版本。
- `web/router/index.ts` 用 `createWebHistory()` 注册现有菜单、账号、帮助、上游监控和未知路径；路由元数据存标题、角色和兼容滚动目标。角色门禁等待同一 Pinia store 完成会话读取。`main.ts` 先安装 Pinia、再安装 Router，首次路由就绪后挂载。`App.vue` 使用 `RouterLink`、`RouterView`、`router.push/replace` 与 `useRoute()`，不再监听 `popstate` 或手写 History。
- `web/stores/session.ts` 合并并发读取，区分未登录与读取失败并提供重试。保留原 fetch 方法、Cookie、CSRF 及响应错误文本。退出、成功改密、业务 401 和账号切换递增会话代次，清除共享会话与兼容业务实例，旧响应不得回写新会话。未加入持久化、缓存或自动重试库。
- 账号设置沿用原密码字段及校验，路由组件以 `onBeforeRouteLeave` / `onBeforeRouteUpdate` 确认离开；`beforeunload` 仍处理刷新和关闭。兼容工作区在同角色页面、帮助和账号设置之间保持原实例，避免订单、开户及查询的待确认状态被路由切换销毁。密码页不缓存。上游独立页通过 RouterView 展示，兼容上游监控组件不同时挂载；其入口使用 RouterLink。
- Vite 与 Nest 现有的合法前端路径回退清单已包含 `/platform/reconciliation/upstream`，本次没有拓宽未知路径或 API 的回退范围。

## 契约与实际验证

测试使用本次新建、可丢弃的 Docker PostgreSQL 容器与名称以 `_test` 结尾的新库，未访问或清空手工开发库；生产入口采用当前 `dist/web`。当前项目测试助手会初始化并清空目标测试库，因此每次业务回归使用全新库。受控上游客户端测试使用同一专用容器内另一新库。测试配置和源码为 `application/config/playwright/playwright.router*.config.ts`、`application/tests/browser/router-navigation.spec.ts`、`application/issue45-tests/router-upstream.spec.ts`。

| 场景 | 迁移前来源 → 迁移后观察 | 结果 |
| --- | --- | --- |
| 直属开户 | 表单 `name/kind/countryCode/phone/email` 与组件 `requestId` → 两次丢响应请求体完全相同 | 只建立一个组织；成功凭据与输入在兼容往返时保留；无自动重放 |
| 管理员重置 | 所选 `child.accountId` → POST `accountId` | 账号 ID 与组织 ID、父组织 ID 不同；请求恰好一次且目标为账号 ID |
| 停用直属组织 | 所选 `child.id` 与 `!child.active` → POST `organizationId/active` | 恰好一次，数据库目标组织停用；非账号 ID |
| 本人改密 | 当前密码和两次新密码来自表单，服务端从会话决定本人 | 旧密码、相同密码、长度、空格、非 ASCII 拒绝；成功后多设备会话失效；丢响应禁重复提交 |
| 四角色与路由 | 会话角色决定菜单及默认页；已有合法深链保留 | 平台、分销、管理员、业务员登录与切换，未知角色路径回退，帮助/设置返回、刷新、后退取消和前进通过；非授权 API 403 |
| 会话读取与失效 | GET `auth/session`；业务请求 401 | 读取失败显示重试而不伪装退出，重试后恢复；业务 401 清旧视图；换账号后旧上游响应不显示 |
| 上游监控 | GET 快照无业务参数；显式 POST 刷新体 `{}` | 独立页直达/刷新、快照、失败、权限和受控供应商调用次数专项通过；页面访问不自动调用供应商 |

执行结果：

- `npm run typecheck`：通过。
- `npm run build`：通过；Vite 提示主块超过 500 kB，属于现有工作区整体打包边界。
- `node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/router-dist` 与 `node node_modules/typescript/bin/tsc -p issue45-tests/tsconfig.router.json`：通过。
- `node --env-file=.env.router-test node_modules/@playwright/test/cli.js test --config config/playwright/playwright.router.config.ts`：3/3 通过。执行中曾发现账号切换后设置页阻止登录默认跳转，已修复；另有测试库重复初始化失败，使用全新库按测试助手约束复测通过。
- `node --env-file=.env.router-test node_modules/@playwright/test/cli.js test --config config/playwright/playwright.router-upstream.config.ts`：1/1 通过。
- Vite 开发入口 HTTP 检查：五类合法深链 GET 200，上游深链 HEAD 200；未知 API、缺失静态文件、未知路径均 404。Nest 生产入口在浏览器场景中验证深链 GET 与 HEAD、未知路径及 API/资源 404。
- `git diff --check`：通过。

## 尚未验证及后续批次

兼容业务容器仍集中承载未拆分的业务；平台其余独立业务子页、分销和终端页面拆分及所有相关业务流的逐项验收仍需按规格分批实施。未验证真实供应商、Redis、正式反向代理部署、所有采购/费用/订单/邮件/收费链路在切页后的业务结果与调用次数，也未逐一为这些业务表单增加离开提示。当前验证只覆盖上表列明的请求与拒绝路径，不将构建或无关测试视为这些流程通过。

前端编码规范试点交付反馈
- 规则版本：0.0.1
- 触发：自动
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021–027、029、030；GUIDANCE FCS-014、028、032；VERIFY 无额外已配置命令
- 校验结果：
  - `npm run typecheck`：通过 — 前后端类型边界。
  - `npm run build`：通过 — 生产构建。
  - 上述两组 Playwright：通过 — 3 个导航/身份场景及 1 个上游专项场景。
  - 格式化、lint：未执行 — 项目未提供相应脚本或配置。
  - 其他业务专项测试：未执行 — 超出本次公共基础改造的已验证流程。
- 冲突：无。
- 存量规范债务：未触及区域未整改。
- PENDING：命名、标签顺序等试点规则尚未决，未作为实施依据。
