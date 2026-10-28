# Issue #39 平台业务数据只读查看

日期：2026-10-28（Asia/Shanghai）。基线提交 `f009895`，基于包含大量并行任务未提交修改的当前工作区完成；不将其他会话成果计入本票修改。

## 范围与实际修改

已读取 [GitHub #39 正文及同正文中的补充验收](https://github.com/BenXueYou/ai-research-company/issues/39)、工程脚手架、应用 README、当前 Spec v1.2、一期 Spec 权限边界及 T28 交付记录。验收采用现行已批准本地规格。GitHub 评论 API 本次返回限流，未取得独立评论；原票正文中的应用根组件与兼容容器退出补充已读取。

- `application/web/pages/reports/PlatformBusinessData.vue` 已是独立真实路由页，本轮只增加 `role="status"` 的“业务数据加载中…”反馈，解决首载等待缺乏明确状态的问题；未改请求、字段、筛选、默认值或权限。
- 新增 `application/server/commerce/issue39-business-data.test.ts`，沿用已存在于业务域附近的专项测试方式，与 `business-data.test.ts`、`reporting.ts` 相邻。测试通过真实 Nest、HTTP、Chromium 与 PostgreSQL 验收。未改 reporting 服务或增加统计。
- 仅新增本票交付记录、`ISSUE-39-EVIDENCE.json`；未改公共汇总、公共入口、路由、布局或 Vite 配置。构建和运行产物均在自己的 `.scratch/issue39/`，该目录自己的 `.gitignore` 忽略临时产物。
- 无部署、用户服务重启、提交、推送或远端关票；不创建 worktree，不重置、stash 或覆盖并行任务修改。

## 接入与生命周期核对

真实路由为 `/platform/organizations/business-data`，路由元信息仅允许 `platform`；下级管理页提供“业务数据查看”入口，业务页提供返回下级管理。`App.vue` 将现有会话 `request` 传给 RouterView 页面。页面没有提交事件、跨组件业务事件或表单草稿。

`CompatWorkspace.vue` 不挂载 `PlatformBusinessData`；其 `UsageReports` 仅在 `session.role !== 'platform'` 时挂载，继续服务分销和终端。因此本票没有旧兼容挂载、独享 target 或滚动逻辑需要删除，不承担全局兼容容器退出。业务页实例不在 KeepAlive 名单中，返回时重新读取一次报表；下级管理页本身也合法读取报表供账户摘要使用，不能把该请求误算成业务数据页面的重复挂载。

组织筛选保存在页面本地，不加入 URL 或 Pinia。切换组织不产生请求；同组件 query 更新不重新读取；离开销毁实例，返回/刷新恢复“全部授权组织”并重读，不承诺保存筛选。页面无写入、幂等提交或结果未知状态，无需接入表单离开保护。会话切换清理原页面，401 后立即回到登录并清除旧业务内容；临时凭据仅显示强制改密。

## 修改前后契约对照

| 链路 | 修改前与修改后均保持的事实 | 验证 |
| --- | --- | --- |
| 首载、手动刷新、返回重挂载 | `props.request('reports')`，实际 `GET /api/reports`，无请求体、不提交选中组织 | 实际浏览器请求记录全部为不含 query 的 GET；返回一次读取，同页 query 不重读 |
| 授权范围 | 服务端从 `identity.organization_id` 递归组织树，不接受客户端组织 ID 扩权 | 平台→一级分销→二级分销→企业甲，平台直属企业乙、空企业均可见；独立授权根的企业及数据不可见 |
| 筛选 | `organizationId` 默认空串；选项值直接来自 `organizations[].id`；客户和邮件均用自身 `organizationId` 严格比较 | 甲与乙分别显示一个客户和两名收件人；空组织显示两种明确空状态，不串企业 |
| 档案 | `customer.id` 是本地档案 ID，`detail.id`/`detail.fileId` 原样展示，未替换或新增兜底 | 所有这些值刻意不同；JSON detail 中上游标识、联系人快照与原夹具一致 |
| 邮件 | `email.id` 是批次 ID，列表 key 是 `recipientId`，同时保留 `profileId`、`organizationId`；主体/内容为既有收件人快照 | 每批两收件人；组织、档案、批次、收件人、联系人 UUID 五者全部不同；断言批次、档案、收件人和组织关联一致 |
| 停用与删除 | 全链只读报表保留授权树内停用组织及软删除档案；不改状态枚举或查询范围 | 乙为停用企业，档案已删除，组织选项和档案分别显示现有标记 |
| 失败与缺失 | 读取失败清空旧 report 并显示错误，不伪装成空业务；无记录只显示空状态 | 503 后旧客户/邮件消失，错误可见，空状态不出现；重试恢复真实数据；延迟读取按钮禁用且加载提示可见 |

本次改动不引入任何业务提交。具体实际 UUID、读取响应和拒绝请求参数见同目录 `ISSUE-39-EVIDENCE.json`；其中均为本轮生成的测试夹具，无密码、Cookie、令牌、数据库连接串或供应商凭据。

## 实际验收

两种运行方式分别使用自己的随机 `issue39_<uuid>_test`，通过现有连接仅取得建库权限，迁移、夹具和查询都在新库执行，结束后只删除该随机库；未清空或迁移连接源数据库。Nest 端口 `3339`；Vite 端口 `5339`，不复用其他服务。供应商均传入可计数的受控拒绝适配器。

| 场景 | 结果 |
| --- | --- |
| Chromium 登录平台，从下级管理入口进入及深链直达；刷新、返回、浏览器前进后退、同组件 query 变化 | 通过；单个页面实例，组织筛选不请求，返回仅重读，不触发业务写入 |
| 授权组织树、两级分销下企业、直属企业、树外企业隔离、批次两个收件人及不同标识关联 | 通过；平台报表 6 个授权组织、2 个档案、4 条收件人记录，树外内容不返回 |
| 停用组织、已删除档案、空企业；请求延迟、503、手动重试 | 通过；区分空记录与失败，保留既有状态含义 |
| 四角色真实登录/退出、同浏览器切换；分销、管理员、业务员直接访问平台路径 | 通过；回到本角色页面、不挂载业务数据页、不显示旧平台客户内容；这些角色仍可合法读取自己的汇总报表 |
| 未登录与临时密码；平台会话在库中撤销后刷新 | 通过；未登录 HTTP 401、临时凭据 reports HTTP 403；强制改密页不挂载业务数据页；401 清除旧内容并回到登录 |
| 分销和终端直接请求 `reports?organizationId=<其他企业>`，报表及 CSV | 通过；组织 query 不扩大权限；响应无 customers/emails，分销 CSV 200 且无客户内容，终端 CSV 403；平台 CSV 同样不混入客户内容 |
| 平台直接更新/删除下级档案、执行下级邮件批次、跨级创建订单、跨级重置管理员 | 全部 HTTP 403；输入是有效夹具标识与结构，拒绝非由前端隐藏按钮替代 |
| 企业甲管理员更新/删除乙档案、读取乙邮件批次 | 全部 HTTP 404，不泄露或写入其他租户内容 |
| Nest 静态和 Vite 合法深链 GET/HEAD；未知路径、缺失资源、未知 API | 合法均 200，未知均 404 |
| 业务库前后快照 | 23 张业务表逐行 JSON 快照一致，含档案、草稿、预览、批次、收件人、余额、点数流水、订单、采购和密码重置请求；会话活动及拒绝审计是身份系统正常行为，不解释成业务写入 |
| 供应商调用 | 两种运行方式均为 0，未查询上游、发信或收费 |

## 命令与结果

以下在 `application/` 运行，构建输出不使用共享 `dist` 或 `test-results`：

```powershell
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/issue39/dist
node node_modules/vite/bin/vite.js build --outDir .scratch/issue39/web
node --env-file-if-exists=.env --test .scratch/issue39/dist/server/commerce/issue39-business-data.test.js
$env:ISSUE39_DEV='1'
node --env-file-if-exists=.env --test .scratch/issue39/dist/server/commerce/issue39-business-data.test.js
Remove-Item Env:ISSUE39_DEV
node --test .scratch/issue39/dist/server/commerce/business-data.test.js
```

前端类型检查、服务端编译、独立 Vite build、静态专项、Vite 专项与原 business-data SQL 授权测试均实际通过。Vite 报告现有大 chunk 提示，构建退出为 0。

首次尝试 `.env.test` 连接被拒绝、继承的占位 `TEST_DATABASE_URL` 认证失败；随后专项改为明确优先 `ISSUE39_DATABASE_URL`、再 `DATABASE_URL`、再 `TEST_DATABASE_URL`，仅用它创建随机新库。夹具编写期间修正 SQL 参数类型和非法无上级终端；浏览器等待修正为等待登录完成，并区分下级管理/本角色汇总的合法报表读取。这些失败不计入通过结果；最终上述专项均重新执行。

## 前端编码规范试点交付反馈

- 规则版本：`0.0.1`；触发：自动。已读取 `frontend-coding-standards/SKILL.md`、`rules.yaml` 与 `vue/SKILL.md`。
- 应用规则：本次新增模板符合 ACTIVE MUST FCS-007、011、013、030；无内联样式、未使用绑定或额外空行。其他脚本/依赖类规则没有对应改动；保持 Vue Composition API 与原局部 shallowRef 状态。
- 校验结果：vue-tsc、服务端 tsc、独立 Vite build、两种真实专项与既有业务数据测试均通过。
- 未执行：`npm test`、通用 integration/e2e 不覆盖本票专项且部分会写共享产物；已使用直接专项命令。项目未配置 lint/format 脚本，不新增扫描器或安装依赖。
- 冲突：无。存量规范债务：未触及区域不整改。PENDING：无本次实现依赖的未决规则。

## 未验证边界

未进行正式 SMTP/U-Mail/腾道供应商联调、生产部署、HTTPS/反向代理或生产数据库操作。本票不覆盖完整开户、真实下单履约、查询收费、邮件预览至实际投递、主动改密成功全流程或其他角色独立页面迁移；这里只验证相关读取、有效请求的拒绝及身份门禁。未验证大数据量分页/性能、并发组织树修改、浏览器关闭后的状态恢复或迟到报表响应跨会话专项竞态；没有据此扩展缓存、分页、字段或业务规则。
