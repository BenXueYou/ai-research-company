# 平台导航工单只读实施准备

记录日期：2026-10-28。本文基于当前工作区静态阅读；已有未提交修改可能使其与提交版本不同。#39、#44、#45 均等待 #34；本报告不是实施或验收记录。设计、工单拆分与依赖图沿用已批准版本。#47 还依赖 #37、#40、#41、#45、#46。

依据包括根 AGENTS.md、CONTEXT.md、工程脚手架与身份决策、控制台迁移规格及设计、工单快照和以下代码。实施前重新核对 #34 合入后的路由、页面和最新代码，不以本文替代规格。

## 现状与接口契约

| 工单及入口 | 当前请求和数据来源 | 授权、范围和副作用 | 迁移核查 |
| --- | --- | --- | --- |
| #39 平台客户及邮件视图：`application/web/reports/UsageReports.vue`、`application/web/App.vue`、`application/server/commerce/reporting.ts` | 挂载时 GET `/api/reports`；平台响应包括 accounts、ledger、sales、transactions、customers、emails 及用量等。客户 `id` 为 profile；邮件 `id` 为 batch，另有 `profileId` 和 `recipientId`。 | 平台客户查询目前读取全部 `company_profiles`，邮件读取全部 `email_batches JOIN email_recipients`，并非按所选组织由服务端过滤。分销响应不含 customers/emails；终端只返回本组织 accounts 和 ledger。 | 保持选择值与各标识来源；选择组织如在客户端筛选，应按响应中的 `organizationId` 关联，不得将 profile、batch、recipient ID 互换。全表与授权组织树是否恒等尚待实证；不要借迁移改服务端范围。 |
| #44 平台财务报表与导出：同上，以及 `/api/reports/own-ledger.csv` | 报表同一 GET；下载链接发 GET CSV，服务端 `exportOwnLedger()` 再调用 `overview`。 | 平台账户、流水、销售及交易按当前会话组织递归树；分销账户覆盖树，ledger/sales/transactions 仅自己；用量和邮件用量按树。CSV 实际只包含平台采购流水和当前平台卖方销售；分销为自己查询流水和自己销售。 | 保持现有计算、列与过滤。CSV 虽过滤输出，内部仍加载完整平台报表，包括客户与邮件；这是现状成本和暴露面，不能称作全链流水导出。 |
| #45 上游监控：`application/web/upstream/UpstreamMonitor.vue`、`application/server/upstream/upstream-monitor.ts`、`controller.ts` | GET `/api/upstream-monitor` 读取快照、最近 20 条事件，并调用 client `usage()`、`limits()`；POST `/api/upstream-monitor/refresh` 显式调用 `account()`，成功保存快照及事件，再读取 overview；失败写分类事件并抛错，前端重新加载旧快照。 | 服务端检查 platform 角色及组织 kind/active。HTTP client 的 `usage()` 读 Redis `mGet`，不调用供应商或 reserve；usage 失败标记 `usageUnavailable`。无 client 为未配置；null snapshot 为无快照。认证会更新 sessions.last_seen_at，故 GET 并非严格零数据库写入。 | 普通进入/重载不得触发 account；刷新才触发。`account()` 可能获取 token，且 40302 有一次重试，不能把一次点击等同于一次外部 HTTP；记录 token、account、reserve 分别次数，保持限流和重试。 |

平台 totals 的现有口径为当前平台 seller 的 `point_transfers.gross_profit` 合计减去 `platform_expenses` 全表金额，不应命名为净利润。费用去重在登记约束及关联流程中处理，报表不是再做 distinct。平台 CSV 的采购字段为 reference、event、cashOutflow、balanceAfter、expenseDelta，销售字段为 orderId、salesAmount、salesCost、grossProfit；通用列头为 `type,reference,event,amount,balance_or_cost,frozen_or_gross,created_at`，控制器添加 BOM。

采购 ledger 的 `recorded_upstream_credits` 是记录增量累计，不是腾道当前余额；平台销售库存、内部企业账户与上游快照分别展示、不得互换。补足、失败及超额用途采购生成内部点数为 0；销售用途按系数快照生成。保持现有费用关联、登记和去重规则。

## 选择到提交与隔离验证设计

实施时建立彼此不同的 UUID：平台 P、直属分销 D1/D2、终端 T1/T2、账号 A、客户档案 C1/C2、邮件批次 B、收件人 R、订单 O、费用 E、详情或联系人查询 Q、产品页 X。为 T1/T2 放置不同名称、邮件主题及正文；让每种关联 ID 不同，并增加多层、停用及树外组织。分别记录迁移前后 UI 所选值、请求参数实际值与来源、响应及最终业务结果；不得以字段名推断或用 `fileId || id` 改变取值。

1. 平台切换组织，检查该组织客户及邮件与关联 ID，不串其他企业；同时单独记录当前全表数据与递归授权树不一致时的实际行为。不能把客户端过滤描述为服务端授权。
2. 分销检查报表响应及 CSV 均无其他企业客户、邮件正文或夹具关键词；终端检查其自身数据可见且其他组织不可见。空数据、停用组织和树外组织均覆盖。
3. 分别使用其他企业的 profile、联系人、batch/recipient 做更新、删除、预览和发送拒绝测试；对跨级买方订单及不允许的密码重置做拒绝测试。断言实际 HTTP 结果、数据库业务记录不变及外部发送次数为零。状态码按现有实现与规格核实，不预设。
4. 验证平台销售、费用、采购及 CSV 的具体数值与来源，包括费用关联/重复登记拒绝；分销仅自身流水和销售。业务迁移前后比较同一夹具和结果。

`company-profiles`、`email-send.ts`、`orders.ts`、`identity/password-resets.ts` 中各自的角色、组织、直属关系及 active 判断是验证起点，不能只凭页面隐藏推断权限。当前 `orders-schema.ts` 只有 `unpaid/reserved/transferred/refunded`，而 CONTEXT 中提及“已收款待补库存”；概览待办的映射须在实施时核对代码与批准规格，不能自行发明状态或改规则。

## #45 与 #47 验证细节

使用受控 client/fetch 和隔离 Redis：分别测已配置、有/无快照、无 client、usage 失败；进入及重复 GET 断言 account/token/reserve 外部调用为零，并核对 `mGet` 与会话 last_seen 写入。刷新成功核对快照、事件与计数；失败核对分类事件、错误和旧快照保留；模拟 token 获取、40302 重试及限流，分别统计每种外部调用。验证非平台、非 active 组织拒绝。浏览器测试也需核对进入 0 次、点击刷新触发预期调用，使用 fake，禁止正式供应商。

#47 在全部既定依赖完成后确定数据来源。复用 reports 会加载全部客户、邮件及明细；procurement 加载采购、费用、价格和账务；point-orders 加载直属卖方订单，不能称为轻量查询。采购及订单 GET 使用事务和锁；认证 GET 更新会话。`GET /api/email-quota` 与 `GET /api/email-batches` 调用 `pauseExpired`，可能更新邮件及额度，不能假定无副作用。实施时测实际请求次数、权限、写入及数据范围，避免为概览无意触发刷新或外部调用。

## 测试入口及资源隔离

下列仅为实施后的候选命令，均以 `application` 为工作目录，需先按当前仓库配置编译并准备浏览器静态资源、专用测试数据库与受控依赖；本次没有运行。编译和构建会写输出目录，不得与其他会话共享。

- `node --env-file-if-exists=.env.test --test dist/tests/upstream-monitor.test.js`：真实 HTTP、专用数据库及受控 HTTP fetch，覆盖监控刷新和拒绝。
- `node --env-file-if-exists=.env.test node_modules/@playwright/test/cli.js test --config config/playwright/playwright.t29.config.ts`：监控浏览器测试；配置引用 `dist/tests/browser/upstream-monitor.spec.js`、端口 3198。
- `node --env-file-if-exists=.env.test --test dist/server/reporting.test.js`：T28 创建随机 `t28_*` PostgreSQL 测试库、迁移并最终强制删除该新库，使用端口 3188，浏览器静态目录 `.scratch/t28-web`；实施前确认该目录的构建步骤。现有测试覆盖部分角色、利润及 CSV，但需补真实客户/邮件正文与不同 ID 的隔离断言。
- 依据修改路径选择 `tests/browser/organization-state.spec.ts`、`company-profiles.spec.ts`、`email-send.spec.ts`、`company-attachments.spec.ts`、`tests/point-transfers.test.ts` 和 `procurement.test.ts` 等相关入口。Playwright t16 使用 `.scratch/t16-dist/tests`，t22 使用 `dist/tests/browser`；确认配置、资源和端口后执行。

`tests/helpers.ts` 的 `testDatabase()` 要求数据库名以 `_test` 结尾，并迁移及 truncate 多表 cascade；并行执行必须使用各自独立数据库、端口和构建输出，否则串行。当前 `test:integration` 仅列出六个文件，`test:e2e` 会构建，不能视为已覆盖上述专项。不要对共享数据库运行这些测试。

## 合并与并行安排

#34 完成并核对实际路由后，#45 可与报表工作并行，由一位负责人独占监控页面和对应测试。#39 与 #44 均涉及共享 `UsageReports.vue`、路由注册及相关测试，建议串行；若并行，先指定共享组件和路由的唯一集成负责人，其他工作限定独立新增文件。#51、#59 后续也涉及该共享组件。隔离测试资源不可行时测试串行。以上不改变已批准依赖图。

## 尚未验证

本次仅静态核查；未运行构建、类型检查、业务测试、浏览器测试或供应商联调，也未验证真实数据范围、请求次数、拒绝路径、数值或 #34 后路由。客户/邮件全表与授权树的关系、订单待办术语差异、T28 静态资源构建步骤均待实施阶段核实。#39、#44、#45 仍被 #34 阻塞，均未实施。
