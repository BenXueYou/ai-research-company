# Issue #40 公共集成交接

2026-10-28；基线 `f009895e16571113301e261a87a45051a52d21ac`，开始时工作区干净。已通过 GitHub REST 实时读取 #40 正文（含容器退出补充验收）及 comments 端点。

## 公共集成要求与当前结果

本票未编辑任何共享集成文件。公共会话已在当前工作区完成以下路由/缓存接入；本票最终 Vite 专项配置只使用 Vue 插件并隔离 outDir，没有路由替换、mock 或集成预览变换。真实浏览器已使用实际集成代码验证以下入口。GitHub comments 端点实际响应为 `[]`。

- `application/web/router/index.ts`：将 `/platform/ledger` 的真实组件从 `PointOrders` 改为 `pages/commerce/PlatformPointOrdersPage.vue`（本票新增），请求 prop 保持现有 `request`。不新增 URL、query 参数或业务请求。
- `application/web/App.vue`：KeepAlive include 中将本平台路由的 `PointOrders` 替换为 `PlatformPointOrdersPage`。保留现有会话 generation 销毁边界，禁止 fullPath key。缓存用于保留结果未知的原 path、body、requestId、选择和表单；返回不自动 load 或重发。刷新不恢复内存上下文。
- `application/web/layout/CompatWorkspace.vue`：当前 PointOrders 只在 distributor 挂载，平台无旧重复挂载；保留分销组件及其行为。`compat-orders` 当前仍有分销调用方，不删除。
- 公共 formLeave 现有 API 足够：平台包装页注册 `submitting/unknown/dirty/clean`、`retainUnknown: true` 及 discard；只放弃未提交字段，结果未知离开保留上下文。同组件 query 更新也交给现有公共机制。
- 现有 Vite/Nest 已允许 `/platform/ledger`，本票不要求增加路径。待集成后需验证真实页面直达刷新、导航/前进后退、会话清理和无双重请求。

生产同源直达/刷新、导航/前进后退、角色切换缓存清理、返回不重发已通过本票专项真实后端场景。Vite 开发服务器 History、同组件 query 更新、刷新未确认表单和其他三角色强制改密仍未执行，交由公共/后续验收；本票不以这些未验证流程宣称全覆盖。

## 上一轮不能以页面迁移补齐的业务缺口（历史）

实时 #40 要求“库存不足已收款待补、补库后整单预留、该分支拒绝退款”。当前 `server/commerce/orders.ts` confirm 库存不足抛 409；`orders-schema.ts` 仅支持 unpaid/reserved/transferred/refunded，无待补状态或预留接口。本任务禁止改后端业务规则，因此此项是已有业务实现缺口，整票不能宣称完整验收。继续验证既有不足拒绝的实际账务不变结果，不伪造为待补履约通过。

## 契约基线

建单 buyerId 取下拉 children[].id；重定价/收款/划拨/退款 orderId 取所选 orders[].id，不能用 buyerId。数量/单价/凭证/退款依据取各自原输入原值；requestId 仍按 `${path}:${JSON.stringify(body)}` Map 生成并保留，成功响应后删除。无业务写入由激活、返回、缓存或查询参数变化触发。

## 公共会话最终复核

2026-10-28：上述共享路由、限定缓存、兼容挂载移除和History要求已实际集成。公共浏览器13项、补充离开机制2项、真实身份/重置12项及策略3项通过；各票真实业务验收仍以本票证据和边界为准。完整共享文件、参数来源、实际命令与未验证范围见 [并行集成汇总](PARALLEL-PLATFORM-INTEGRATION-2026-10-28.md)。保留分销/终端兼容模块，不宣称全局退出。#40库存待补分支仍是整票业务缺口。

## 本轮业务缺口补齐

上述缺口已在用户本轮授权下按现行已批准规则实现并经真实平台/分销浏览器、HTTP/PostgreSQL 验收。新增 `awaiting_stock`、持久的 `shortageReceipt` 来源标记和 `/api/point-orders/reserve`；接口详情见 [稳定契约](ISSUE-40-SHORTAGE-CONTRACT.md)，实际结果见 [本轮交付记录](ISSUE-40-COMPLETION.md)。保留以上历史，不再以“上一轮禁止改规则”阻止本轮落实已批准规则。没有修改本票以外的报表、运营概览、公共装配或路由。
