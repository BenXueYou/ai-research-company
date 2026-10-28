# Issue #47 平台运营概览交付记录

日期：2026-10-28。仓库基准 HEAD `f009895e16571113301e261a87a45051a52d21ac`，在已有大量未提交成果的共享目录增量实现，未创建 worktree、未 reset/stash、未提交推送、未部署或重启用户服务。通过 GitHub REST 实际读取 #47 正文及补充验收（评论为空）；规格依据《10-控制台角色导航与页面迁移Spec》运营概览及 Testing Decisions。依赖以本地实现和真实证据为准，不以远端 Open 判断未实现。

当前结论：本票本地实现及验收完成。已通过 wait_threads 确认 #40 本轮 completed，并读取其最终交付、稳定接口契约和实际账务证据；完整专项在此最终业务代码上重跑通过。远端工单未修改。

## 实现与范围

- `application/web/pages/overview/PlatformOverviewPage.vue` 为真实 `/platform/overview` 路由页；`web/api/platformOverview.ts` 仅适配原 GET 接口。库存、历史上游快照、订单及三类查询待办分区读取和显示错误，不因一项失败抹去其他成功数据，不自动重试。
- 平台内部点库存、查询冻结、销售预留与上游点数分别标注单位；快照保留上游有效期原值及获取时间，不将历史余额表述为实时余额。未配置仍可看到已有快照；无快照、库存缺失、加载中与读取失败都有明确状态。
- 订单按原状态逐项统计：`awaiting_stock` 已收款待补库存、`reserved` 已收款并预留、`unpaid` 待收款；已划拨和退款不进入待履约。未知状态明确要求进入订单页面核实，不伪装无待办。停用买方仍属于原订单待办，不按当前能否操作过滤。三类查询只计 `pending`，与原核对页可执行人工核对的条件一致；其他状态不混入。
- 四个快捷入口为 `/platform/organizations?view=new`、`/platform/ledger`、`/platform/ledger/procurement`、`/platform/reconciliation`。摘要同时提供真实上游监控入口。没有业务表单、业务写入入口或隐式上游更新。
- Router 保留现有平台角色门禁、菜单元数据与面包屑；App 的 `isCompatPath` 排除概览。概览以前只有 EmptyRoute，无对应旧业务组件或锚点；移除兼容路径后平台默认页不再挂载无关兼容工作区。分销及终端仍使用 CompatWorkspace，不宣称全局退出。
- 只读页离开销毁，返回重新 GET；不加入 KeepAlive，无草稿、requestId 或未知提交上下文需要保留。query/hash 不参与业务取值，不产生新提交；卸载后的异步结果忽略，会话 store 继续检查 generation。没有更改订单服务/schema/controller、PointOrders、其他票测试或交付文件。

## 契约与加载范围核对

| 内容 | 来源与最终请求 | 原语义、加载范围与副作用 |
| --- | --- | --- |
| 平台库存和订单 | `GET /api/point-orders`，无 body、无客户端组织 ID | 服务端从当前会话账号取得 seller；库存原 `balance/frozen/reserved` 字符串，不换算，不引入可用余额新算法。返回该卖方所有订单及 children/pricing，概览仅展示摘要；GET 对账号加锁核验会话，读取库存/订单，无预留、划拨或业务流水写入。 |
| 上游历史快照 | `GET /api/upstream-monitor`，无 body | 读取已有 snapshot、近20条事件、共享用量和 limits；usage 是共享计数读取，不调用 account 或预留供应商调用次数。概览只展示 configured/snapshot，不新增更新请求。 |
| 企业详情/联系人/产品名单待核对 | `GET /api/company-details/reconciliations`、`company-contacts/reconciliations`、`product-searches/reconciliations` | 原接口读取全量非 quoted 核对历史及关联证据；前端只统计 state=pending，无 POST、无收费查询、无核对或迟到结果提交。分别失败分别提示，不将失败类别计作0。 |
| 快捷入口 | 原 RouterLink 的 path/query | 开户只传 `view=new`，不预选组织、账号或类型；其他入口不传业务标识。目标页面继续自行按原流程取值；概览不会代替目标表单提交。 |

加载限制：复用接口会读取完整订单及核对历史（含概览不显示的详情），当前没有分页摘要接口；本票没有新增聚合后端或更改既有 API。大历史量性能未压测，不将本票验收当作容量结论。

## 实际验证

独立输出路径均为 `application/.scratch/issue47/`。测试使用新建随机 Docker 容器、随机回环 PostgreSQL 端口与随机 `issue47_<uuid>_test` 库，进程内随机密钥；浏览器端口3247、Vite3248、开发后端3249，不占用户服务端口。专用库与本轮容器在 finally 删除；秘密未输出，trace/截图关闭。脱敏证据见 [ISSUE-47-EVIDENCE.json](ISSUE-47-EVIDENCE.json)。

实际命令（在 application 执行）：

```powershell
npm run typecheck
npx tsc -p tsconfig.server.json --outDir .scratch/issue47/compiled --incremental false
npx vite build --outDir .scratch/issue47/web
node scripts/verify-issue47.mjs
```

- 类型检查、独立服务端编译和前端构建通过；Vite 有既有 bundle >500kB 提示，没有因此修改构建策略。
- 最终专项浏览器 `1 passed (21.6s)`（前一轮21.3秒也通过）：真实 Nest/HTTP/PostgreSQL/Chromium，另启动真实 Vite 使用仓库 History 插件和 API 代理验证开发入口。正常业务响应未 mock；故障用 route 注入503、删响应 inventory 及延迟真实读取，分别验证加载、失败和数据缺失。
- 平台登录默认概览、直达刷新、四个快捷入口真实目标、菜单 aria-current、前进后退、上游监控入口、手动刷新均通过；Nest和Vite深链刷新通过，未知 API 不返回 HTML，缺失 JS 返回404。
- 夹具区分平台账号/组织、分销组织、终端组织、管理员/业务员账号，以及 searchId/candidateId/源source_id、profileId/详情detail_id/queryId。概览 GET 不传这些标识；订单建单买方使用独立 distributor 组织 ID，收款 orderId 使用真实建单响应 orderId，不能替换成账号/组织 ID。
- 用真实 HTTP `POST point-orders {requestId,buyerId,quantity:'2000',unitPrice:'3'}` 创建大于可用库存订单，再以 `{requestId,orderId,receiptReference:'issue47-shortage-receipt'}` 足额收款；响应201/awaiting_stock，数据库 `shortage_receipt=true`。同收款 requestId/payload 重放返回原结果。随后概览显示待补1、预留1、待收款1；既有已划拨、已退款各1不计入这些类别。此 POST 仅用于建立受控测试数据，概览没有发出业务 POST。
- 详情、联系人、产品名单分别设置 pending/settled/zero/failed/quoted；概览每类恰为1次待核对，quoted及已结束状态不计入。内部库存1234.5000、冻结12、预留30；上游87.25及2026-10-01快照不会混淆。
- 导航/返回/刷新期间记录业务POST为0、供应商 search/detail/contacts/importerNames/account 调用为0；库存、订单、幂等请求表、预留流水、划拨、退款、三类查询点数流水、上游快照和事件的前后快照完全一致。身份认证正常更新会话 last_seen，不将其误称为数据库完全无写入。
- 四角色正常登录及切换、不同角色默认页、平台深链越权返回正确默认页通过；三类核对与上游接口分销/admin/sales均403。分销可读自身 point-orders 是既有授权，admin/sales读订单403。四角色 must_change 直达与API均阻止；平台实际改密后退出，旧会话401。临时账号夹具同时设置72小时有效期。
- 首次环境读取 `.env` 中的占位凭据失败（未写库），改为全新专用容器；夹具漏填终端level/profile关联、旧退出按钮选择器、未等登录完成及临时有效期未设等测试失败已修正。只将最终实际成功场景记录为通过。

## 依赖与未验证边界

已读取 #37/#41/#45/#46 本地页面与交付证据；本票快捷入口均实际到达这些已交付页面。#40 最终会话 completed（无错误），已读 [最终交付](ISSUE-40-COMPLETION.md)、[稳定契约](ISSUE-40-SHORTAGE-CONTRACT.md)和[真实业务证据](ISSUE-40-SHORTAGE-EVIDENCE.json)：平台/分销待补、整单预留/划拨、永久缺库存来源退款限制、并发/幂等已验收。接入最终枚举后本票完整专项重跑通过，因此本票所列本地技术依赖已解除；未据此关闭任何远端工单。

未重新验收其他票的开户提交、采购费用、人工核对结算、完整补库履约/退款/并发规则或正式邮件/供应商联调；本票只验证其快捷入口与只读结果，#40 分支业务以其专项证据为准。没有正式扣费或发信。生产HTTPS、反代、旧库升级、容量压测、全应用兼容退出和其他角色全部业务迁移未验证，不属于本票完成范围。

未执行共享 `npm run build`，避免写入 dist；已用相同已安装 TypeScript/Vite 工具独立输出。未执行 `npm test`/基础集成脚本，其固定目标不覆盖概览；本票用专用真实专项。没有现有 lint/formatter 脚本，未另装依赖或编写规则扫描器。触及文件 `git diff --check` 通过。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动；同时使用 Vue skill。
- 应用规则：ACTIVE MUST FCS-007/011/013/019/021–027/030；GUIDANCE FCS-014/032（页面局部状态，不新增全局状态）；依赖未变，无新增插件包。
- 校验结果：typecheck、独立tsc/Vite、真实专项浏览器、diff空白检查通过；常规测试、共享构建、lint/formatter未执行的范围与原因见上。
- 冲突：无。存量规范债务：共享路由/App未触及区域的原格式保留，不扩大整理。
- PENDING：命名、标签顺序、缩进等规则未决，沿用仓库惯例，不提升为执行要求，无需澄清。
