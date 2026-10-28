# ISSUE-45 上游监控迁移交付记录

2026-10-28。基线为包含 #34、#35 等其他任务的未提交工作区；本票仅修改 `web/upstream/UpstreamMonitor.vue`，新增 `UpstreamMonitorPage.vue`、`issue45-tests/` 和专项 Playwright 配置。公共路由由 #35 负责。`/platform/reconciliation/upstream` 已纳入 Nest 与 Vite History 清单并在平台会话下单独挂载；兼容监控区新增链接通往独立页，独立页不显示该链接。未提交或修改 Issue。

## 契约对照

| 行为 | 迁移前后相同的来源和结果 |
| --- | --- |
| 首次加载、重入及浏览器刷新 | 监控组件挂载时 GET `/api/upstream-monitor`，无请求参数；身份、组织由会话确定。返回历史快照、最近事件、调用计数及限额，不主动调用供应商 account/token/reserve。GET 的会话 last_seen 更新和生产 Redis 计数读取仍存在。 |
| 显式点击更新 | POST `/api/upstream-monitor/refresh`，请求体 `{}`，没有目标标识字段；原客户端执行 account，成功持久化快照及成功事件，失败写分类事件并重新读取旧快照。token 获取与 40302 最多一次重试保持原样。 |
| 数据区分 | 上游余额、有效期、抓取时间和事件来自上游快照；调用次数来自 client usage，与内部点数余额和流水不混用。组织 ID、账号 ID 在夹具中各不相同；请求无选择标识。 |

## 实际验证

测试使用新建专用库 `issue45_bb0c7c3e103a_test`（HTTP）及 `issue45_39b8a1dfe2fa_test`（浏览器），真实 PostgreSQL、Nest 后端、Chromium 和受控供应商客户端；HTTP 端口 3206，浏览器服务 3205，未配置服务 3207。没有清空手工开发库。以下命令均在 `application/` 运行，重跑时须为每个套件分别设置全新、独立、库名以 `_test` 结尾的 `TEST_DATABASE_URL`，测试助手会清空该库；不要共用开发库或并行测试库。

- `node node_modules/typescript/bin/tsc -p issue45-tests/tsconfig.json`：通过，独立编译至 `.scratch/issue45-dist`。
- `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`：通过。
- `node node_modules/vite/bin/vite.js build --outDir issue45-test-web`：通过，有大于 500 kB 的构建包提示。使用独立非隐藏目录，因为 Express `sendFile` 对 `.scratch` 隐藏目录返回 404；该失败属于测试输出位置，不是 History 路由故障。
- `node --env-file=.scratch/issue45.env --test .scratch/issue45-dist/issue45-tests/upstream.test.js`：通过。非平台 GET/POST 均 403；无快照读取零外部调用；显式刷新 token 1、account 1、reserve 2；后续 40304 失败 account 1、reserve 1，保留 123.50 快照及 points_exhausted 事件，内部账户 77.0000 与查询流水不变。
- `node --env-file=.scratch/issue45.env node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue45.config.ts`：通过。真实 `page.goto` 深链、浏览器 reload、菜单离开并通过监控链接返回及菜单高亮；无快照、87.25 历史余额、有效期和获取时间、usage 失败、数据库表暂时改名造成真实读取失败、未配置及按钮禁用均验证。进入、重载、往返的 token/account/reserve 均为零。显式更新模拟 40302 后成功：token 2、account 2、reserve 4；后续 40102 失败：account 1、reserve 1，展示频率受限并保留 123.50 和 trace，成功及失败事件落库，查询流水数为零；两次按钮请求体均为 `{}`。非平台 GET/POST 均 403；停用平台组织会话 GET/POST 均 401，均未新增供应商调用。未配置页面在另一真实服务上读取既有快照并禁用更新，直接 POST 返回 503。

`.scratch/issue45.env` 仅为本次运行时生成的数据库连接文件，运行后已删除；上述命令要求使用者自行准备该文件或以安全方式设置 `TEST_DATABASE_URL`。专项源码在未被忽略的 `issue45-tests/`，不会依赖临时生成测试。先前隐藏目录导致的深链 404 已排除，非当前阻塞。

## 边界

受控内存共享状态模拟 usage/reserve；没有实连 Redis 或正式腾道账户，未验证生产部署、代理及真实供应商联调。读取失败通过专用测试库内临时改名快照表触发，finally 中恢复；未配置的直接 POST 返回 503，UI 禁止点击。其他角色的全部导航及其他票业务不属于本票验收。构建和类型检查不代替上述业务场景。

前端编码规范试点：规则版本 0.0.1，自动触发；相关 ACTIVE MUST 为 FCS-007、011、013、019、021–027、030，GUIDANCE 为 FCS-014、032；依赖管理规则不适用。类型检查和相关专项测试通过；未发现项目专用 lint/格式脚本，未执行无关测试；无已知配置冲突，未触及存量债务。PENDING 的命名、标签顺序等规则未提升为强制，也不影响本次实现。

