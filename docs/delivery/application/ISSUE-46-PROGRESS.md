# Issue #46 核对页面迁移前核对记录（迁移前基线）

当前状态：本票已完成，以下保留迁移前基线；当前实现、执行结果和边界见 [交付记录](ISSUE-46-COMPLETION.md)。

日期：2026-10-28。开始时共享工作区已有 #44 及其他未提交改动；本记录不将它们计入本票。当前 `/platform/reconciliation` 已承载 `ReconciliationPage` 和 `DetailReconciliation`，此前的独立路由迁移及模拟浏览器验证见 `RECONCILIATION-ROUTE-MIGRATION.md`。

| 选择和条件 | 当前请求及来源 | 服务端目标和结果 |
| --- | --- | --- |
| 企业详情 `pending` 行 | `company-details/reconciliations`：行的 `queryId`，表单的 `outcome`、`billingReference`、`traceId`、`evidence`；非失败时 JSON 解析后传 `result`，非空时传 `upstreamPoints` | `company_detail_queries.id`；按结论结算或释放冻结，保存依据；重复相同结论按既有服务端逻辑处理 |
| 联系人页 `pending` 行 | 同字段，路径 `company-contacts/reconciliations`；标识仍来自该行 `queryId` | `company_contact_queries.id`；按既有联系人核对规则结算或释放 |
| 产品名单页 `pending` 行 | 同字段，路径 `product-searches/reconciliations`；行 `queryId` 是名单页标识，不是产品搜索父记录标识 | `product_search_pages.id`；结果的页码和大小须与原确认页一致 |
| 三类 `failed` 行 | 对应领域 `late-results`；行 `queryId`，表单账单、trace、依据、解析后的结果，非空上游扣点；不传 `outcome` | 对应失败查询或名单页留存迟到结果，不重启扣点；既有服务端规则处理重复或冲突 |

页面加载并发读取三类核对列表；选择行时账单和 trace 用原行的值或空串，结果初值取原行结果或空串，迟到结果清空结果输入；默认结论 `settled`。提交成功清除选择并刷新列表，失败保留表单。仅 `pending` 行提供核对操作，仅 `failed` 行提供迟到结果操作。平台身份及组织状态由服务端验证，非平台角色不得仅凭前端隐藏作为授权。

## 尚待完成

- Issue #35 是本票声明的阻塞依赖；当前公共 `confirmLeave` 仅处理账号设置，尚无可供核对表单接入的公共表单离开机制。需要依赖完成后接入并验证菜单、历史导航、放弃及提交未确认状态，避免自行复制与并行任务冲突的公共实现。
- 此记录为代码基线而非迁移后验收；尚未执行本票真实浏览器、独立 PostgreSQL 和 HTTP 测试，也未验证三类标识不同的完整链路、直接越权拒绝、账务流水、重复、迟到及正式供应商联调。历史 T13 和模拟浏览器结果不能代替本票验收。
- 既有核对页未对已提交但网络结果未知的请求提供明确的单独页面状态；应与依赖的结果未确认机制一起核对，不能因路由切换自动重发或改变服务端结算规则。
