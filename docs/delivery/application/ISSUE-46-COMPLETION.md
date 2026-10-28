# Issue #46 查询异常核对与迟到结果页面交付

日期：2026-10-28（Asia/Shanghai）。本票代码与本地验收完成；未操作远端票据状态。

## 基线与实现

- 依据当前 `AGENTS.md`、`docs/engineering-scaffold.md`、控制台角色导航与页面迁移 Spec、T13 业务规则及 GitHub Issue #46。
- 迁移前字段来源与提交条件已先记录在 [基线](ISSUE-46-PROGRESS.md)。开始时 #44、#35、#37 等任务已有未提交修改，本票在共享工作区上增量实现，没有将这些修改计入本票。
- `/platform/reconciliation` 继续由 `pages/upstream/ReconciliationPage.vue` 承载三类人工核对与迟到结果。单模块使用的 `DetailReconciliation.vue` 从 companies 目录移至 `pages/upstream/components`，同步唯一导入。平台角色路由与兼容容器无须新增变更。
- 接入当前 `router/formLeave.ts` 的 `useFormLeave`：输入变化才视为未提交；取消导航保留 URL、历史位置、选择和输入；确认放弃后清除选择；提交中阻止离开和重复提交。选择其他记录也需确认放弃已修改表单。
- 提交已发出而网络失败或收到 5xx 时保留原查询、请求上下文和表单，提示结果未确认，禁止再次提交。允许经确认后离开缓存页面；返回不自动重查或提交。用户主动刷新列表，发现原查询的对应处理留痕后关闭表单，提示核对已有处理记录。列表尚未取得对应留痕时继续保留未知状态。列表中的依据、操作人和处理时间由原接口字段展示。
- 保持默认 `settled`、原行账单/trace 的空串兜底、原结果初值、迟到结果清空结果输入、失败不传 `result`、上游扣点仅非空时发送、三领域路径选择和 `queryId` 来源。未修改服务端业务计算、数据库 schema、请求适配或供应商参数。
- 依赖 #35 的公共实现已存在于当前工作区并在本票场景中使用；远端依赖票是否关闭不能代替实际代码判断。交付依赖共享工作区中的 `formLeave.ts` 与 App 的 provider 同步落地。

## 选择、请求与落库证据

[完整执行快照](ISSUE-46-EVIDENCE.json) 保存本轮实际选择、POST 请求、组织/操作人标识、档案及联系人标识、费用关联和最终余额，不包含密码、Cookie 或密钥。以下为本轮三个成功样本；第二标识仅用于证明不会被错误代入 queryId。

| 类型 | 所选行 queryId | 刻意不同的关联/上游标识 | 实际请求目标 |
| --- | --- | --- | --- |
| detail | `c37615a3-aa1b-4d34-b1b0-70a1b498a1f7` | `69ee0c9a-d735-45e8-8517-d0c46bbf77d5` | `company-details/reconciliations` → `queryId=c37615a3-aa1b-4d34-b1b0-70a1b498a1f7` |
| contact | `7f7205ec-ce3c-4296-b957-78de1ce314ff` | `7e109e84-798f-41de-8645-05a4a84f3704` | `company-contacts/reconciliations` → `queryId=7f7205ec-ce3c-4296-b957-78de1ce314ff` |
| product | `71363a11-6489-4e79-ad84-fccf38aa5a0b` | `upstream-item-distinct` | `product-searches/reconciliations` → `queryId=71363a11-6489-4e79-ad84-fccf38aa5a0b` |

- 企业详情：`queryId` 始终来自所选查询行，既不取候选 ID，也不取结果的 `id` 或 `fileId`。结果 JSON 原样发送，服务端仍取 `result.id` 写入档案的 `detail_id`。样本同时含不同的 `id`、`fileId` 与候选、查询和内部档案 ID。
- 联系人：行 `queryId` 对应 `company_contact_queries.id`，不取 `profile_id` 或 `mailsouId`。原页码、页大小和 SALE 职位标签保持；供应商联系人 `mailsouId` 落入 `mailsou_id`，返回企业名不同仍保持 `ownership_status=pending`。
- 产品名单：行 `queryId` 对应 `product_search_pages.id`，不取结果条目的上游 `id`；保留 `TUR`、2026-01-01～2026-06-30、page=1、size=20 的原页条件。结果名单名称落入 `product_search_candidates.source_name`。
- `billingReference`、`traceId`、`evidence`、`outcome`、可选 `upstreamPoints` 与 JSON `result` 均取表单。失败结论不发送 `result`；迟到结果不发送 `outcome`。测试逐字段比对浏览器 POST 与表单预期，再查真实落库状态与点数。
- 三类成功样本的实际上游扣点 `1.2500`、系数 `1.0000`、原确认上限 `1.0000`，均仅扣 `1.0000`。零结果及失败均不扣点并释放冻结；失败上游点数为 `0.1000`，保留平台损耗规则。

## 实际执行

环境：Windows / Node.js 24.15.0 / PostgreSQL 17.6 Alpine / Playwright Chromium。专用容器 `codex-issue46-20261028`，数据库 `issue46_test`，回环数据库端口 `55466`；浏览器后端 `3466`，T13 HTTP 回归端口 `3467`。独立编译目录 `.scratch/issue46-dist` 与 `.scratch/issue46-web`，未占用其他会话的库、端口及构建输出。密钥随机生成于运行期，连接配置保存在被忽略的 `.env.issue46.test`。

在 `application/` 执行：

```powershell
npm run typecheck
node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/issue46-dist
node node_modules/vite/bin/vite.js build --outDir .scratch/issue46-web
node --env-file=.env.issue46.test node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue46.config.ts
```

全部通过。Playwright 1/1（最终版本 8.5 秒场景执行），构建保留既有主块超过 500 kB 提示。

| 实际场景 | 观察到的结果 |
| --- | --- |
| 生产同源入口直达、刷新、后退、前进、子页往返 | 页面与 URL 一致；未知 API 404；缓存返回无三类列表重读、无 POST |
| 有修改的子页链接、主菜单及浏览器后退 | 继续编辑保留 URL 和输入；确认放弃清选择，不自动提交 |
| 三类 settled / zero / failed | 均经真实浏览器表单、Nest HTTP、PostgreSQL 完成；对应状态、实际扣点、账单与每查询唯一释放流水正确 |
| 国家错误结果 | 真实服务端 400，原表单保留，再填正确结果可成功提交 |
| 三类重复核对 / 冲突核对 | 相同请求 200；不同依据或点数 409；无重复结算 |
| 三类失败后的迟到结果 | 浏览器登记成功；相同回执重复提交 200、冲突证据 409；每类仅一条迟到记录，余额及冻结不变 |
| 提交成功但响应丢失 | POST 转发真实后端成功后，测试故意丢失响应；提交中切页受阻；未知状态禁再次提交；确认离开后返回保留输入，主动刷新取得处理记录，整个往返未新增 POST |
| 三类失败损耗的费用关联 | 每类首笔 201、第二笔关联 409，数据库每类仅一笔费用 |
| 四角色切换 | 同一浏览器退出并登录平台、分销、管理员、业务员，默认页正确；非平台直达返回角色默认页，不挂载核对页；三类列表/核对/迟到接口直接请求均 403 |
| 临时凭据门禁及强制改密 | 直达仍显示强制改密，业务接口 403；完成本人改密后退出，使用新密码重新登录到终端默认页 |
| 外部调用 | 本轮核对、导航与刷新受控查询适配器调用数为 0 |

共 10 笔待处理查询：4 笔 settled、3 笔 zero、3 笔 failed。最终余额 `96.0000`、冻结 `0.0000`；每笔仅一次 release；三类迟到结果均未改变余额。

另复用既有 `tests/detail-reconciliation.test.ts` 的已编译副本，仅在独立输出中把端口 3103 换为 3467 后执行：

```powershell
(Get-Content .scratch/issue46-dist/tests/detail-reconciliation.test.js -Raw).Replace('3103','3467') | Set-Content -Encoding utf8 .scratch/issue46-dist/tests/issue46-t13.test.js
node --env-file=.env.issue46.test --test .scratch/issue46-dist/tests/issue46-t13.test.js
```

1/1 通过，覆盖受控详情调用的原公司名和 TUR 参数、封顶与损耗、退款、三类人工核对和迟到结果、并发失败后回执、费用关联去重、补充值不改变销售库存成本。测试顺序执行，不与浏览器共用库并发运行。

## 验证边界

- 未执行正式腾道账号及真实供应商账单联调、生产部署、HTTPS 反向代理、跨实例故障恢复、海量列表性能或全库全套测试。
- 此次验证以同源生产前端和真实后端为入口，未额外执行 Vite 开发服务器场景；此次未新增 URL 或改动 History 路由规则。
- 不增加跨刷新草稿或自动重试。关闭/刷新浏览器会提示未提交或未知状态；完整刷新后需通过既有核对列表回看服务端记录。未知请求仍无对应留痕时继续保留状态，不能擅自判失败或重新收费。
- 响应丢失故障注入用于核对 POST；迟到结果的正常、重复和冲突路径均经真实 HTTP/数据库验证，未另行对每类迟到 POST 注入断网。

前端编码规范试点交付反馈
- 规则版本：0.0.1。
- 触发：自动；同时应用 Vue Composition API 技能。
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021–027、029、030；GUIDANCE FCS-014、028、032。沿用页面局部状态，不增加全局业务 store 或依赖。
- 校验结果：`npm run typecheck` 通过；独立 TypeScript 编译、Vite 构建通过；上述真实浏览器及 T13 HTTP 回归通过；相关 diff 空白检查通过。首次类型检查的 row 可空错误已修正，后续检查通过。
- 格式化、lint：未执行，项目未提供相关脚本或配置。`npm test`、默认 integration/e2e、deployment：未执行，其覆盖不替代本票专项验证，且默认端口/数据库/构建目录会影响并行会话。
- 冲突：无。
- 存量规范债务：未触及代码未扩大整改。
- PENDING：FCS-001–006 等目录命名与标签规则未作为实施依据，不依赖其决策。
