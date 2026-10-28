# #34 公共控制台布局交付记录

日期：2026-10-28（Asia/Shanghai）。关联 [#34](https://github.com/BenXueYou/ai-research-company/issues/34)，设计基线：[新版交互方案](../../console-interaction-proposal-2026-10-28.md)。本记录交付公共布局增量；#34 的全量业务页面迁移、兼容容器退出仍按各票完成，不能据此关闭整票。

## 基线与改动边界

基准提交 `04b85d8a4b72d05572004850cdd5d6c7f92812e3`，实际基线为任务开始时已有大量未提交修改的工作区。修改前 `web/` 副本、状态和前端产物分别保存在 `application/.scratch/issue34-baseline/`、其中的 `status.txt`、`application/.scratch/issue34-baseline-web/`。这些本地验证材料不含环境文件。未恢复、覆盖或提交其他任务的成果；执行中下级账户及报告相关任务仍在更新文件，相关新增业务不计入本次交付。

- 新增两份专项浏览器测试及 `config/playwright/playwright.issue34-layout.config.ts`；根 `.gitignore` 仅添加这两份测试的精确例外，避免既有 browser 通配忽略令验收代码遗漏。
- 新增 `web/layout/ConsoleFrame.vue`、`ConsoleBreadcrumb.vue`、`breadcrumb.ts` 与 `web/styles/console.css`。使用现有 Element Plus Container/Aside/Header/Main；业务实例继续由原 App、RouterView、KeepAlive、CompatWorkspace 管理，切换侧栏使用 `v-show`。
- `ConsoleHeader.vue` 仅给左侧品牌包裹导航插槽。脚本、右上角账号菜单模板和样式与任务开始副本逐段比较完全一致；`App.vue` 的 logout、changePassword、openSettings、closeSettings 函数完全一致。证据见 JSON 的 accountPreservation。
- 菜单从已授权路由的元数据派生，父分组仅展开收缩，当前叶子或详情所属列表唯一选中；帮助入口保留。顶部收放按钮不导航，窄屏为带遮罩、焦点循环与 Escape/焦点返回的侧栏。
- 面包屑使用路由元数据，组织详情名称复用该业务已加载的 selectedChild.name，不增加请求。不存在有效入口的分组为普通文字；可点击项通过 RouterLink 进入原路由和离开保护。
- 外层占视口，菜单及业务区分别滚动；Router 的 scrollBehavior 在业务容器恢复各历史条目的位置。兼容页 target 只在业务容器定位，App 中重复的 scrollIntoView 已移除。
- 移除兼容容器、平台下级管理、配置、邮件资源/日额度、对账、平台报告/业务数据及帮助页的页面大标题；保留卡片、分组、对象名称、费用、密码与业务风险说明。账号设置仅保留强制改密的大标题，改密表单及风险说明保留。尚未接入的独立业务文件不作批量整理。
- 两侧共享不透明滑块色：浅色 #a6afd6 / hover、focus #8794c0；深色 #8492bd / #a6afd6，透明轨道、细宽圆角、强制色彩模式交给系统。

## 选择到提交契约

真实前端分别加载修改前产物与当前产物，连接本次独立库 `acquisition_issue34_20261028_test`（回环 55463，在已运行测试 PostgreSQL 中新建）。测试通过 testDatabase 初始化并清空的只有这个本次专用库，未使用开发库或其他任务库。HTTP 使用 Nest 真实应用，未替换业务服务。

完整不同标识值和请求见 [前后证据 JSON](./ISSUE-34-LAYOUT-EVIDENCE.json)。两次各自生成 UUID，因此比较字段来源和本次夹具对应值，不比较两次随机 UUID 的字面相等。

| 链路 | 修改前与修改后的来源、最终请求 | 业务结果与拒绝 |
| --- | --- | --- |
| 组织启停 | 列表 child.id → query.id 定位 selectedChild → `{organizationId: child.id, active: !child.active}`；child.id ≠ child.accountId ≠ 当前会话账号 ID | 真实停用、恢复及查询落库；把 accountId 当 organizationId 请求返回 403 |
| 管理员重置 | 同一 selectedChild.accountId → `{accountId, requestId: crypto.randomUUID()}`；没有以组织 ID 替换账号 ID | 真实生成当次凭据并展示成功，关闭凭据沿用原处理；以 child.id 充当 accountId 返回 403 |
| 邮件日额度 | 下拉 options.organizationId → selected.organizationId；dailyLimit 字符串经原 Number 转换 → `{organizationId: selected.organizationId, dailyLimit: 2345}` | HTTP 成功且数据库 daily_limit=2345；0 返回 400；sales 请求配置返回 403，前端深链重定向 |
| 本人改密 | 会话确定目标；三个密码字段仍分别取 currentPassword/newPassword/confirmPassword，客户端不提交账号/组织 ID | 修改前后均实际改密、退出，旧密码登录 401、新密码登录 200 |
| 退出 | 保留原离开准备、organization-before-logout、busy 和空 body；CSRF 仍取 Cookie | 模拟响应专项验证取消不请求、失败保留输入、重试一次、忙碌禁用、成功清会话，POST body={} |

无数据库迁移、收费查询、邮件发送或订单重放变更。真实业务验证未调用正式供应商，组织重置的邮件适配沿用测试环境默认配置。

## 验证

命令均在 `application/` 执行，依赖沿用本地已安装版本，无新增包或工程配置。

| 命令 / 检查 | 结果 | 实际覆盖 |
| --- | --- | --- |
| npm run typecheck | 通过 | Vue/前端及服务端 TypeScript；执行成功 |
| npm run build | 通过 | 类型检查、Nest 与 Vite 构建；Vite 保留 >500KB chunk 提示 |
| node node_modules/typescript/bin/tsc -p tsconfig.server.json | 通过 | 编译真实后端和浏览器测试 |
| node --env-file=.scratch/issue34-test.env node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue34-layout.config.ts | 通过，16 项 | Chromium 专项含现有账号菜单、真实 HTTP/数据库及布局用例 |
| 设置 ISSUE34_BASELINE=1 后同上命令加 issue34-contract | 通过，1 项 | 加载修改前产物，重复组织状态、重置、额度允许/拒绝及本人改密 |
| 头部和事件处理逐段对照 | 通过 | ConsoleHeader 脚本/右上角子树/样式、App 退出/改密/设置/返回函数 |
| 视觉检查 | 通过 | 实际 Chromium 截图，桌面 1440、窄屏 320；本地 .scratch/issue34-desktop.png、issue34-mobile-*.png |
| lint / formatter / stylelint | 未执行 | package.json 与相关配置没有对应命令；不临时安装、不改工程配置 |
| npm test / test:integration / test:e2e 全套及部署测试 | 未执行 | 默认集并非本改动专项，采用专用真实链路和浏览器集；未部署 |

浏览器专项实际断言：双区滚动互不影响、header 顶部不动、无第三个整页纵向滚动条；相同状态下两侧滑块颜色一致及 hover 一致；收放不丢输入与 main.scrollTop；父分组不改 URL；唯一叶子高亮；组织详情对象名称与返回；取消面包屑导航保留输入和位置；配置提交中阻止离开，丢响应后保留上下文，返回不重发；各角色窄屏焦点循环、Escape 与焦点返回；账号区键盘、外部点击、长账号、320/375 宽度及改密/退出限制；四角色已授权入口的深链、刷新、面包屑与高亮。

执行过程曾有测试夹具/断言及布局错误，修复后复跑。构建期间其他任务临时产生 `server/reporting.test.ts` 未使用导入错误，未修改该文件，待其更新后最终构建已成功。初次账号测试与构建产物更新相撞出现一次 index.html 暂缺，串行构建后复跑通过。中间失败未计为通过。

## 尚未验证与保留疑点

- 真实业务覆盖为上述组织、额度、本人改密链路；收费企业/联系人/产品查询、附件、邮件发送、订单库存/流水、采购及正式 SMTP/U-Mail/腾道联调本次未重跑，不能用布局测试代替其验收。
- Firefox/WebKit、操作系统强制色彩及读屏软件尚未实际运行；相关 CSS 与键盘语义已落实，实际验证使用 Chromium。未执行生产部署、服务重启或数据库升级。
- 平台概览及部分分销、终端路由仍依赖原兼容容器；现有采购没有本批独立路由，本批没有新增模拟采购入口或迁移业务实例。兼容容器全部退出和这些页面的独立交付不属于本次布局完成结论。
- 已发现原有表单放弃疑点：组织开户编辑后经同组件查询参数切换到列表，afterEach 执行 discard 前 state() 已随新 view 判断为 clean，原输入可能仍留在缓存实例。当前任务保持原 formLeave 与提交规则，未顺手修复；专项对取消导航断言输入保留，对历史滚动使用显式清空表单以避免离开保护取消导航。这一疑点不标记为已解决。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1。
- 触发：自动（Vue 3 前端修改）；同时使用 vue 技能的 Composition API / script setup / TypeScript 约定。
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021～027、029、030；GUIDANCE FCS-014、028、032。依赖未变、全局会话仍为 Pinia，新增框架 UI 状态为局部状态。仅约束触及区域。
- 校验结果：类型检查、构建、专项浏览器、真实业务对照及头部保留检查通过；lint/格式化无现有命令未执行，全套无关测试及部署测试未执行，原因如上表。
- 冲突：无；未修改 ESLint/Prettier/Stylelint 或依赖配置。
- 存量规范债务：未改动账号子树与未触及业务区域保留既有格式，避免扩大 diff；未作全库格式治理。
- PENDING：FCS-001～006、008～010、012、015～018、020、031、033～035 未提升为强制规则；本次无依赖其裁决的实现选择，无需澄清。


## 票据同步

已向 [#34 发布本次实施与验证说明](https://github.com/BenXueYou/ai-research-company/issues/34#issuecomment-6466159005)，保留原票内容与 open 状态，未勾选全量迁移验收。同步明确本地记录尚未提交，未提供不存在的远端文件链接。
