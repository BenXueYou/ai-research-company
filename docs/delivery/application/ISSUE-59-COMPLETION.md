# Issue #59 终端点数用量

## 原型风格调整（2026-10-28）

按用户要求对齐现有控制台的蓝紫强调色、浅灰背景和白色圆角卡片，仅触及 TerminalUsagePage 的模板与 scoped CSS：余额/冻结分卡、流水独立卡片、表头与行分隔、数字右对齐、等宽引用、来源标签、错误和空状态。保留来源/事件原值及全部金额精度，不改 script、API、字段映射、权限或生命周期。去除与面包屑重复的页面标题，保留业务分组标题。

自动应用前端规范 v0.0.1（FCS-007/011/013/014/030）及 vue、frontend-design 技能。`npm run typecheck`、独立 tsc/vite 构建、`git diff --check` 通过；原 #59 真实 Chromium/Nest/PostgreSQL/Vite 专项通过（1 passed，23.8 秒），继续验证五条流水、会话/企业隔离、失败缺失、导航及无副作用。额外检查 390px 无整页横向溢出，并人工查看 `.scratch/issue59/usage-desktop.png` / `usage-mobile.png`：窄屏摘要纵排、表格局部横向滚动。截图只含专用测试夹具，无真实业务或凭据。已有 bundle 大小提示保留。无 lint/格式化工具可执行；其他模块样式及正式环境未验证。未改共享样式与其他业务组件。

## 基线与契约（实施前核对）

2026-10-28 通过 GitHub REST API 读取实时 #59（Open），核对批准的控制台迁移 Spec、工程脚手架与应用说明。共享目录存在其他任务未提交修改，未创建 worktree、reset、stash、提交、推送或部署。

原 `CompatWorkspace` 对所有非平台角色挂载 `UsageReports`，终端 `/terminal/usage` 为 EmptyRoute + compat-usage 定位；`App` 保持兼容实例。终端组件没有跨组件事件、写入、草稿或未确认提交。分销仍依赖 UsageReports，保留该调用方。

| 链路 | 迁移前 | 迁移后约束 |
| --- | --- | --- |
| 读取 | `request('reports')` → GET /api/reports，无 body/query | 相同，经 web/api/terminalUsage 适配 |
| 企业范围 | 服务端 `request.identity.organization_id`，不接受客户端组织参数 | 相同，不增加组织选择 |
| 余额/冻结 | internal_point_accounts.balance/query_frozen | 原数值、单位点；缺失明确提示 |
| 详情流水引用 | query_point_ledger.id/query_id → id/referenceId | 原值显示，不替换为档案或候选 ID |
| 联系人流水引用 | company_contact_point_ledger.id/query_id | 相同，不替换为 profile_id |
| 产品流水引用 | product_search_ledger.id/page_id | 相同，不替换为候选 ID |
| 来源/事件/金额 | detail/contact/product；freeze/settle/release；amount/balanceAfter/frozenAfter | 原枚举及金额直接显示，不重新计算或改写退款口径 |
| 权限 | 同企业 admin/sales 共享读取；CSV 403；平台/分销有各自报表权限 | 保持接口权限，终端路由仅 admin/sales |
| 副作用 | 报表纯读取，无供应商调用 | 相同，不新增销售预留、可用余额或导出 |

新页仅按真实路由挂载，移除终端兼容 UsageReports、target 与 App 兼容路径判断。页面离开销毁、返回/刷新重新 GET；同组件 query 变更无参数语义、不重发。会话 generation 销毁路由树，旧请求经 store 隔离并由页面卸载标记拦截，不恢复旧数据。读取失败先清旧快照，缺余额不显示零。无写入，故提交幂等不适用；重复读取需验证业务表不变。

## 验证

基准提交 `eee101b`，共享工作区包含其他票改动；本票新增 `web/pages/reports/TerminalUsagePage.vue`、`web/api/terminalUsage.ts`、专项测试、配置与隔离运行脚本，仅在 router/App/CompatWorkspace 做终端用量的最小接入。未修改报表后端、数据库结构、#52 档案库或 #58 成员业务组件。

在 `application/` 实际执行：

```powershell
npm run typecheck
node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/issue59/compiled
node node_modules/vite/bin/vite.js build --outDir .scratch/issue59/web
node scripts/verify-issue59.mjs
git diff --check
```

类型检查、独立服务端编译、独立前端构建通过；Vite 有既有 bundle 大小提示。专项使用真实 Chromium / Nest / PostgreSQL 17.6 / Vite，脚本创建随机独立 Docker 容器及动态 PostgreSQL 端口，测试再创建随机 `issue59_<uuid>_test` 数据库；仅删除自己创建的库和容器。Nest 静态入口 3459，Vite 3460，开发代理后端 3461；产物和结果均在 `.scratch/issue59/`，没有写入共享 dist/test-results，也未连接共用测试库或供应商。

首次专项在强制改密夹具缺失 temporary_expires_at 时失败，补齐有效期；第二次对所有非 GET 当作写入的断言遇到兼容找企业页面的既有 `POST /api/company-profiles/list`，已按实际只读语义单列记录。补充停用企业场景时原断言预期 403，实测身份守卫返回 401，已按既有契约修正测试，未修改业务规则。一次全项目类型检查受并行 #58 测试中暂态 `Identity.organizationId` 错误影响，所属会话修正为 `organization_id` 后重跑类型检查通过。最终完整专项通过（1 passed，20.2 秒）；实际库名、不同引用值、数据库逐行预期及调用证据见 `ISSUE-59-EVIDENCE.json`。`.gitignore` 仅增加本票测试源例外，确保专项源文件可交付，保留原其他改动。

### 实际场景与业务结果

- 管理员与业务员经真实登录后读取本企业相同报表。组织 ID、账号 ID、搜索 ID、候选 ID、详情查询 ID、档案 ID、联系人查询 ID、产品页 ID 均不同；JSON 留存实际非秘密夹具值。
- 企业 A 余额 96.0000、查询冻结 8.0000；详情 freeze 10 后 settle 4，余额 100→96、冻结 10→0；联系人 freeze 8 仍待核对；产品 freeze 6 后 release 6，冻结 14→8、余额保持 96。逐条比对五条真实数据库流水的 source/id/referenceId/event/amount/balanceAfter/frozenAfter，并在浏览器逐单元格断言；不把 query_id 替换为 profile_id 或 candidate_id。
- 企业 B 余额 296.0000、冻结 8.0000，有完全不同的查询引用；账号切换后仅显示 B 的引用与余额。会话切换时延迟 A 的真实后端响应，返回后不恢复 A 的数据。
- 客户端伪造 `?organizationId=<B>` 的请求仍返回 A 范围，不泄露 B。既有接口忽略该参数，没有被改成新的错误契约。停用企业 GET 401（现有身份守卫拒绝会话）；未登录 GET 401；强制改密 GET 403。终端 CSV 403，无导出按钮、销售预留或新指标。平台和分销仍有各自报表读取权限，因此不能声称这两个角色的通用 GET /reports 403；其 `/terminal/usage` 导航被角色守卫重定向至各自默认页。
- 生产静态入口与 Vite 的 `/terminal/usage` 直达、刷新均成功；主菜单高亮及面包屑正确。账号设置离开销毁用量页，后退重新读取一次，前进/后退可用；主动刷新仅重新读取。强制改密提交后旧会话 GET 401，四角色登录和切换有效。
- 真实 PostgreSQL 表暂时改名使报表读取失败：清除旧余额和流水，显示错误；表恢复后刷新正常。删除本企业余额记录：明确“暂无账户余额数据”，没有显示零；恢复后正常。
- 用量页面不提交业务请求；十张账务、查询及订单表在导航、重复读取和角色切换后逐表快照一致；供应商调用 0，业务写入请求 0。角色切换默认找企业页面可能触发既有档案列表只读 POST，单列为 `otherPageReadPosts`，不归入用量读取。没有写入链路，提交幂等不适用；重复读取验证无副作用。

## 集成边界与未验证范围

最终验收读取到并行 #52 `CompanyProfilesPage` 与 #58 `MemberManagement` 的最新公共路由接入，保留其改动；本票不负责这两个模块验收。App 的终端用量兼容路径排除与两票共存。分销开户、订单、UsageReports，以及终端找企业/产品、发信设置与邮件记录仍使用兼容容器，因此保留 CompatWorkspace、workspaceVisited 与 isCompatPath，未宣称全局退出。

本票以真实账务夹具验证报表读取，不执行新的收费查询/联系人/产品供应商结算、订单划拨或退款操作；这些服务的真实供应商及生产环境联调不在本票范围且未执行。本票没有部署、重启现有服务、提交、推送或关闭工单。独立验收服务已随测试关闭。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动（Vue 3 页面迁移），同时应用 vue 技能的 Composition API/script setup TypeScript。
- 应用规则：ACTIVE MUST FCS-007/011/013/019/021～027/030；GUIDANCE FCS-014/032。未修改依赖，028/029 无新增适用项。
- 校验结果：`npm run typecheck` 通过（项目脚本不支持单页缩小，检查前后端）；独立 tsc/vite 构建通过；#59 真实浏览器专项通过；`git diff --check` 通过。未发现已配置的 ESLint/Prettier/Stylelint 脚本或配置，未执行对应命令。`npm test` 仅 policy、基础 integration 和其他专项与本票读取迁移无关，未执行。未执行原 `npm run build`，它会写共享 dist，已用相同本地编译器输出至独立路径。
- 冲突：无。共享 router/App 的存量区域只做必要小改，不展开格式迁移。
- 存量规范债务：共享组件既有紧凑模板及格式未扩大整改。
- PENDING：命名、SFC 块顺序、缩进、属性顺序等保持项目现行惯例，不提升为强制规则；无影响当前任务的未决澄清。
