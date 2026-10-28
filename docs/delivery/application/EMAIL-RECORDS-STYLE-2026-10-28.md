# 邮件记录页面原型风格优化（2026-10-28）

## 范围与基线

- 页面：`application/web/pages/email/EmailRecordsPage.vue`，路由 `/terminal/emails` 与 `?batchId=` 详情。
- 工作区已有大量其他未提交变更，本次以修改前的当前页面为基线，备份于 `application/.scratch/email-style/EmailRecordsPage.before.vue`，未回退其他任务代码。
- 参考：`原型设计/原型V2.html` 的 mailView、浅色工作台白色面板、浅灰表头、蓝紫强调及状态标签。
- 将双列批次卡片改为一个带列头的列表面板；渠道、数量、额度日期、回复地址、四类结果及操作分别排版。当前批次使用浅蓝背景和左侧强调线。
- 收件人详情分开呈现邮箱、状态、主题、渠道反馈及正文，修复暂停状态的重复选择器覆盖；响应式布局覆盖桌面、平板及手机。

## 业务契约

本次只修改 template 和 scoped CSS。比较修改前备份与最终文件，script setup 完全一致；`web/api/emailRecords.ts` 未修改。

| 链路 | 前后字段与来源 |
| --- | --- |
| 详情 | `batchId` 仍取路由 query，列表链接仍取 `batch.id`；API `email-batches/detail` 收到 `{ batchId }` |
| 企业档案 | `id` 仍取 `selectedBatch.profileId`，未改用批次或收件人 ID |
| 核对 / 执行 | `recipientId` 仍取当前 `recipient.id`；操作条件和禁用条件保持 |
| 重发 | 仍显式确认重复发送风险，提交 `{ recipientId, confirmPossibleDuplicate: true }` |
| 跨日确认 | 仍先读取今日额度，再显式确认；提交 `{ recipientId: recipient.id, confirmUnsubscribeNotice: true, confirmQuota: true }` |
| 未知结果 | 保留原批次及请求上下文，主动核实只读取，刷新和返回不自动发送 |

回归夹具区分组织、账号、档案、批次、联系人和收件人 UUID。前后页面脚本一致；最终实际请求与业务结果见 `application/.scratch/email-style/evidence.json`，包含核对/重发/跨日操作、发送参数及点数表不变证据。

## 实际验证

- `npm run typecheck`：通过（Vue 前端和服务端 TypeScript）。
- `node node_modules/vite/bin/vite.js build --outDir .scratch/email-style/build`：通过；仍有产物大于 500 kB 的构建提示。
- `node .scratch/email-style/verify.mjs`：通过。临时独立 PostgreSQL 容器运行，结束后清理，仅使用新建专用测试库；发送逻辑测试 1/1、Issue56 浏览器集成测试 1/1。
- 集成场景：本企业共享记录、证据送达和失败状态、未知响应及重复操作保护、人工重发、跨日确认与执行、跨租户拒绝、角色门禁、会话晚到隔离、Nest/Vite 深链和点数数据不变。
- `node .scratch/email-style/visual-updated.mjs`：通过。1440、900、390、320px 四种宽度，无横向溢出，桌面和手机截图已人工查看。截图与 `visual-updated.json` 位于同目录。
- 页面 script setup 与修改前备份对比：完全一致。
- 未验证：正式 SMTP/U-Mail 供应商、真实邮件投递、生产部署；视觉截图使用受控页面夹具，集成回归使用受控发送与证据适配器。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1
- 触发：自动
- 应用规则：ACTIVE MUST FCS-007（空行）、FCS-011（多属性换行）、FCS-013（内联样式限制）；GUIDANCE FCS-014（class 命名）。业务脚本和依赖不变。
- 校验结果：上述类型检查、前端构建、相关集成测试及响应式视觉检查均通过。
- 未执行校验：仓库未提供格式化/lint 脚本；`npm test` 仅 policy 测试，与本次展示调整无关；全量集成测试及其他业务专项未执行，已运行邮件记录相关目标。
- 冲突：无。
- 存量规范债务：未触及业务脚本中的紧凑属性与对象格式保留，本次不扩展为格式化重构。
- PENDING：FCS-005/006/009/010/012/015 涉及模板和 CSS 排版但尚未启用，沿用仓库写法，不影响本次实施，无需澄清。

## 空状态缺陷修复与优化（用户截图复核）

### 原因与修复

用户截图是无记录分支，不是有记录列表。上一轮视觉夹具只覆盖有记录状态，遗漏空状态。`web/styles/index.ts` 按需加载了其他 Element Plus 组件样式，却缺少 Empty 样式，导致默认 SVG 的尺寸和填充变量丢失，出现大块黑图。

`node .scratch/email-style/empty-repro.mjs` 在修复前复现失败：空面板高 1301px，SVG 约 1134×1234px。补齐 Empty CSS 后，同一命令通过，图标 72×72px、面板 360px 高。页面另使用蓝紫色邮件线条图标，增加用途说明及 `/terminal/profiles` 的“前往企业档案”入口，保持原空状态显示条件。未改业务脚本或请求参数。

### 补充验证

- 新增持久回归 `tests/browser/email-records-empty.spec.ts`，通过完整 App/Vite/Router 加载页面，受控 API 返回空记录，覆盖 1440/390/320px、图标尺寸、居中、容器尺寸、无横向溢出、刷新、错误状态和无 POST 写请求。
- 命令：`node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.email-records-layout.config.ts`。
- 完整控制台截图：`.scratch/email-style/empty-console-1440.png`、`empty-console-390.png`、`empty-console-320.png`，桌面与手机截图已人工查看。
- `npm run typecheck`：通过；前端独立构建通过。
- `npm run build`：通过，更新正常运行所用 `dist/web`，保留既有 chunk 体积提示。
- 首轮新增完整 App 测试失败源于夹具角色写成 `terminal_admin` 和拦截规则误匹配 `/web/api/` 源码；修正为真实角色 `admin`，仅匹配以 `/api/` 开头的请求后通过，不涉及产品权限变更。
- 未重跑真实邮件供应商或生产投递、其他使用 Empty 的业务流程；本轮仅页面展示及 CSS 导入，邮件业务脚本未改。

### 本轮前端编码规范试点交付反馈

- 版本：0.0.1；触发：自动。
- ACTIVE：MUST FCS-007、011、013、019、030，GUIDANCE FCS-014；遵守触及区排版与无未使用导入，未改依赖。
- 校验：类型检查、构建、空状态复现修复检查及完整 App 三种屏宽回归均通过。
- 未执行：没有格式化/lint 脚本；policy、其他数据库和业务专项测试与本轮样式变更不相关，未重复运行。
- 冲突：无；存量债务：未触及业务代码保持；PENDING：模板及样式排版项继续沿用仓库约定，无需澄清。
