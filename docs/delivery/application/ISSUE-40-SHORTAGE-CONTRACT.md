# #40 待补库存接口交接（2026-10-28）

本轮已按 PRD R12/R16/R17/R18/R44、Spec AT-19/AT-21 实现并通过独立真实浏览器/HTTP/PostgreSQL 验收。供 #47 只读使用，不修改运营概览或报表。

- `GET /api/point-orders` 保持原字段，新增每单 `shortageReceipt: boolean`；`status` 新增 `awaiting_stock`（已收款待补库存，无本单预留、买方尚未到账）。原有 `unpaid/reserved/transferred/refunded` 含义不变。
- `POST /api/point-orders/confirm` 原载荷 `{requestId,orderId,receiptReference}` 不变。仍校验直属关系、启用、当前售价下限和唯一凭证；库存不足时成功登记 `awaiting_stock`、`shortageReceipt=true`，数量售价和金额锁定。不产生预留流水或买方余额。库存充足仍原子登记并整单预留。
- 新增 `POST /api/point-orders/reserve`，只接收 `{requestId,orderId}`。仅当前有效直属卖方对有效直属买方的 `awaiting_stock` 订单操作；逐单事务检查整单可用库存，足则 `reserved` 并记录唯一预留流水，仍不足返回409且继续等待。不重新收款、不重定价、不追加付款。
- 后续复用 `transfer` 完整划拨，每单独立请求与结果。补库预留后 `shortageReceipt` 仍为 true，服务端退款始终拒绝此履约分支；其他普通预留退款规则保持。
- 新操作复用全局幂等请求表、卖方权限与库存事务锁；同 requestId/actor/operation/payload 重放返回原结果，其他请求不能重复产生流水。停用暂停预留和划拨，不自动退款或释放。
- schema 仅在当前显式初始化路径新增字段及约束，不在启动时写现有库；未运行用户库初始化、reset、升级或部署。旧库升级须按仓库边界另行验证，不以本票新库验收代替。

最终实际结果见 ISSUE-40-COMPLETION.md 本轮追加记录。
