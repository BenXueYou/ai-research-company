# Issue #43 平台邮件资源与企业日额度设置

日期：2026-10-28。基线 `04b85d8`，承接 [迁移前契约](ISSUE-43-PRECHECK.md)。#35 离开机制已在当前工作区接入，本票使用其 `useFormLeave`；本地实现及受控适配器验收完成，正式供应商未联调。

## 实现与协作边界

- 平台设置首页链接到 `/platform/settings/umail`、`/platform/settings/email-quota`。两页可直达、刷新、返回，服务端只为这两个明确路径补充 SPA 入口；侧栏保持平台设置选中，账号设置可返回来源子页。
- 原邮件表单作为各自路由页继续使用，移除兼容容器及设置首页的重复实例。`App.vue` 仅增量增加两个页面缓存名称；成功提交标记为已保存，未保存修改可继续编辑或确认放弃；提交中禁止路由离开。刷新前注册的 `beforeunload` 阻止无提示离开。
- POST 网络/解析失败时保留原企业、资源、额度、请求标识和错误，进入结果未确认状态。确认离开后返回仍锁住提交，不自动重配或重置，也不把供应商调用重试混入路由返回。刷新后只加载列表，不自动提交；未增加跨页面持久草稿。
- 移除资源页 T32 实施状态文案，只展示企业资源及费用信息。
- 公共文件已在修改前重读，保留 #35、#37、#40、#42、#44 等并发未提交改动。`PlatformSettingsPage.vue` 仅替换邮件导入/挂载为链接，不改计价、换算、采购和报表业务。服务端业务服务、schema、额度规则未变。没有提交、部署或重启业务服务。

## 实际链路证据

浏览器驱动真实 Nest HTTP、Cookie/CSRF 和 PostgreSQL，只有供应商资源核验使用现有装配注入的受控适配器。POST 响应丢失场景使用 `route.fetch()` 先完成真实请求和事务，再中止返回给浏览器的响应。

| 选择与输入 | 最终参数及来源 | 服务端与结果 |
| --- | --- | --- |
| 企业甲43，资源 `resource-alpha-43` | `organizationId=02ad0210-3844-441a-8694-05a30a87875d` 来自 `umail/resources` 选项原值；资源来自输入；`requestId=687b4dba-3b61-4904-9d28-d3b51d3f7417` 由组件生成 | 适配器接收同一组织/资源；资源表保存 `available`。直接 HTTP 重放相同请求返回原结果，适配器仍为一次。 |
| 企业乙43，额度 `2345`，随后 `3456` | `organizationId=78c320bd-e79e-4281-aba4-d1eb164f04db` 仍取列表选择项；`dailyLimit` 仍由 Number 转整数，POST `email-quota/configure` | 乙最终日额度 3456；审计恰为 2345、3456 两条。3456 响应丢失后导航往返没有第三次提交。甲未配置额度，企业管理员/业务员 GET `email-quota` 均为默认 2000。 |
| 企业乙43，资源 `resource-beta-43` | 与组织 UUID、甲资源不同；资源值原样 POST `umail/resources` 并送至适配器 | 返回丢失后页面保留乙和原资源且按钮禁用；往返页面调用数不变。最终甲/乙分别保存 alpha/beta。 |
| 甲资源被分配给乙 | 乙 UUID 与 `resource-alpha-43`，新请求标识 | 核验后唯一性约束返回 409，未覆盖甲；这是独立的拒绝尝试，计入一次适配器调用。 |

整个浏览器专项供应商核验共 3 次：甲首次、乙尝试复用甲资源被拒、乙 beta 成功。重放、导航、取消编辑、丢响应返回、非平台和无效目标不增加调用。停用企业资源设置 400；分销组织额度目标 404；额度 0 为 400；分销/企业管理员/业务员对平台资源 GET/POST 及额度 POST 均为 403，两条平台子路由均受角色门禁。账号组织、企业 UUID、资源字符串与额度数字均为不同值，没有字段替换或新兜底。

本票设置页验收结束 `email_daily_usage` 行数为 0，配置动作没有生成用量或预占；已用/预占、共享额度、渠道授权和跨日语义另以现有专项验证。完整请求与最终 DB 快照由测试生成于 `application/.scratch/issue43-evidence.json`，无密码、Cookie 或凭据。

## 验证命令和结果

环境：Windows、Node 24.15.0、Chromium、PostgreSQL 17.6 Alpine。自建本票容器 `codex-issue43-20261028`，仅回环端口 55463；浏览器服务 3343，U-Mail 专项服务 3344。

| 命令（application 目录） | 结果与范围 |
| --- | --- |
| `node scripts/issue43-test-db.mjs` | 为首次运行建立本票独立容器/库与忽略的环境文件；不使用开发库及其他会话测试库。重复运行应复用已生成环境文件，不重复创建同名容器。 |
| `npm run typecheck` | 最终通过。早期遇到并发 `DetailReconciliation.vue` 的 row 可能 undefined，后续该任务修复后通过，本票未改其文件。 |
| `npm run build` | 中间版本通过；该命令写默认 dist，随后本票最终产物统一使用下两条独立输出命令。 |
| `node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/issue43-dist` | 最终通过，包含新增浏览器测试。 |
| `node node_modules/vite/bin/vite.js build --outDir .scratch/issue43-web` | 最终通过；Vite 原有大 bundle 警告，未改变分包。 |
| `node --env-file=.scratch/issue43-test.env node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue43.config.ts` | 最终 1/1 通过。专库 `acquisition_issue43_20261028_test`；直达/刷新/返回、选项已有状态、请求体、落库、拒绝、未保存取消/放弃、提交中门禁、beforeunload 事件、两个丢响应往返、四角色登录与退出及临时账号强制改密。截图/trace 关闭。 |
| `node --env-file=.scratch/issue43-umail.env --test .scratch/issue43-dist/tests/umail.test.js` | 6/6 通过。专库 `acquisition_issue43_umail_test`，仅在本票编译副本中将 3094 改为 3344，原测试源未变；企业资源幂等、跨企业隔离、平台不能维护团队渠道、业务员只读、SMTP/U-Mail 唯一默认选择。 |
| `node --env-file=.scratch/issue43-sending.env --test .scratch/issue43-dist/tests/email-send.test.js` | 1/1 通过。专库 `acquisition_issue43_sending_test`；T22–T25 共享额度、原子预占、受理转已用、未提交释放、不明保留、重复/乱序证据、跨日暂停/重确认及迟到回执。 |
| `npm test` | policy 3/3 通过；仅身份纯逻辑辅助检查，不能替代邮件验收。 |
| `git diff --check -- <本票受影响文件>` | 通过。 |

早期专项夹具曾将同一测试库先后用于 email-send 与 umail，触发已有初始化逻辑 `accounts_username_key` 冲突；没有修改业务初始化逻辑。改为每套件独立库后回归通过。新增测试首次发现额度按钮显式 `disabled=false` 覆盖表单状态，修正为 `busy || resultUnknown` 后通过。真实浏览器取消 reload 会等待被取消的导航，因此刷新保护改为验证可取消 `beforeunload` 事件被阻止；无修改状态的实际页面刷新也验证通过。

## 未验证范围

- 正式 U-Mail 资源隔离、DNS、真实任务/投递、回复实收及供应商实际限额；这些属于 T32，不将受控适配器结果当作正式联调。
- 浏览器原生刷新/关闭提示外观与各浏览器的人工取消体验，本票验证事件保护与普通实际刷新；四角色全业务合并验收、生产 HTTPS、生产数据库迁移和负载测试未执行。
- 当前接口没有供平台查询所选企业当前日额度的查询能力，保留原表单默认 2000，不把输入默认值宣称为该企业当前额度。结果不明时需平台核实，未新增对账/恢复接口或服务器幂等规则。
- `test:integration` 全量、`test:e2e` 全量、部署测试未执行：范围不相关且会写共享输出/默认测试库。本票相关服务及浏览器场景已用隔离目标验证。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动；另使用 Vue Composition API 技能。
- 应用规则：MUST FCS-007/011/013/019/021–027/030；GUIDANCE FCS-014/028/032，保持现有依赖和局部状态。FCS-029 没有新增依赖。
- 校验结果：类型检查、独立编译/构建、相关浏览器测试和 diff 空白检查通过；无已配置 lint/format 脚本可运行。全量测试及部署测试未执行，原因见上。
- 冲突：无。存量规范债务：未修改区域的既有单行多属性/导入保留。PENDING 命名、模板顺序等规则未提升执行；无阻塞澄清。
