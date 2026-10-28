# #50 分销点数订单独立页面交付（2026-10-28）

## 基线与范围

基准 HEAD `2bf193c186d40c939494d317d40eafb459d9dd0e`。实施前读取 AGENTS、工程脚手架、应用 README、控制台迁移 Spec、PRD R12～R18/R43/R44、技术设计订单事务、第一阶段 Spec AT-19～21、#40 最新完成记录与 SHORTAGE-CONTRACT、订单 controller/service/schema、平台包装页、共享 PointOrders、会话和离开机制，以及现有真实订单测试。实时 GitHub REST 读取 #50、#40 全文及兼容容器退出补充，两票 Open，comments 均 `[]`；未将远端 Open 当作未实现。#40 的待补库存后端已实现，本票直接复用，没有第二套状态机或后端业务修改。

本批共享工作区并行实施 #48/#50/#51，未建 worktree、reset、stash、部署、重启用户服务、提交、推送或修改远端工单。本票仅新增分销订单包装页、独立测试/配置/runner/记录，修改共享 PointOrders 的显式模式，以及 App/router/Compat 的本票最小接入。公共文件逐次读最新内容并保留 #48/#51 接入；组织页、报表页和其未提交内容不属于本票成果。公共规格汇总和其他票交付文件未改。

## 路由、分层与兼容退出

- `/distribution/orders` 真实渲染 `web/pages/commerce/DistributionPointOrdersPage.vue`，复用同业务域的 PointOrders；该组件仍由平台包装页调用，因此未改入全局 components，也未复制业务表单或请求实现。
- 新增默认关闭的 `distributionLifecycle`，以 `platformLifecycle || distributionLifecycle` 选择已有生命周期保护；平台传参、未传模式的原默认行为保持。买方/订单/凭证/requestId 的构造未改。
- 分销包装页接入公共 `useFormLeave`，保留旧容器原有的只读系数通知。缓存只包含命名的分销订单页，仍由会话 generation 销毁，无 fullPath 全量缓存。
- 删除分销旧 PointOrders 挂载、import、`compat-orders` target；App 不再把订单路径作为兼容路径。不存在该模块独有的跨组件事件、滚动处理或手写 History 导航。Nest/Vite 的现行白名单原已包含该路径，无须改入口。
- 仍有终端团队 SMTP/U-Mail 配置和系数通知依赖兼容容器，保留 CompatWorkspace、workspaceVisited/isCompatPath 和共享滚动能力，不宣称全局退出。

未提交输入离开可取消继续或确认放弃，放弃清空草稿/选择；提交中阻止导航；未知结果保留原 path/body/requestId，确认切页后返回不自动提交或刷新，用户主动核对/原请求重试。主动刷新只读；成功写响应后列表读取失败沿用“已完成”提示。激活、query/hash 变化没有自动加载或业务动作；本页无业务路由参数，query/hash 不用于恢复订单选择。同页 URL 改变仍经过公共离开检查。刷新重新加载页面，不承诺内存草稿跨刷新恢复。

## 迁移前后契约

| 操作 | 原来源与迁移后保持的请求 | 服务端及验证结果 |
| --- | --- | --- |
| 直属选择建单 | `GET point-orders.children[].id → buyerId`，输入原字符串 quantity/unitPrice | 会话组织决定 seller；账号、卖方、买方、同级、跨级与订单 UUID 均不同；分销初始选择快照和全部实际载荷见 JSON |
| 调整数量售价 | 所选 `orders[].id → orderId`，编辑原字符串 | 浏览器分销 4点×3 调到5点×3，提交 quantity `'5'` / unitPrice `'3.0000'`；收款后再调整409 |
| 收款 | 所选订单 id，凭证输入原值 → receiptReference | 分销 `DISTRIBUTION-SHORTAGE`，5点×3=15元；仅3点库存时登记 awaiting_stock，零预留、买方零到账 |
| 补库预留 | 所选订单 id → reserve.orderId，无第二次收款 | 父级真实交易补2点，成本2.2升至21.32；原5点/3元锁价，整单预留，缺库存来源保留、退款409 |
| 完整划拨 | 卡片 `order.id → transfer.orderId` | 分销减5点/释放5点预留，直属终端加5点；销售成本106.6、销售额15、毛利-91.6；丢响应原载荷重试只一笔 |
| 合规退款 | 所选订单 id，退款依据原输入 → refundEvidence | 普通2点×55=110元；输入 `DISTRIBUTION-REFUND-EVIDENCE`，整单释放2点；原ID重放201，新ID重复409，买方余额不变 |
| 库存竞争 | 每单独立 orderId/requestId，不合并款项 | 两张3点已收款待补单，真实补库后只有3点：并发整单预留201/409；胜单同请求3次划拨均201，仅1笔到账3点，另一单继续待补 |
| 幂等 | 原 Map key `${path}:${JSON.stringify(body)}`，原 `crypto.randomUUID()` 来源 | 原 path/body/requestId 保留；收款、划拨丢响应重试字段完全相同；成功响应删除原key；无自动业务重试 |

数量/售价精度、最低售价、收款唯一性、停用、权限、退款来源和库存事务锁均由 #40 原服务负责。无 id/fileId 兜底；该链路本来不存在 fileId，不造字段。前端最终请求、服务端 requestRecords、订单/预留/采购/划拨/退款流水及余额按实际 UUID 对照见 [脱敏证据](ISSUE-50-EVIDENCE.json)；只有测试身份与测试凭证，无密码、cookie、密钥或数据库连接串。

## 实际验证

本地 Windows、现有 Node/npm、Playwright Chromium、真实 PostgreSQL；复用 createApplication/migrate、真实身份/组织/订单/采购服务及受控供应商适配器。不 mock 业务 API；仅真实写成功后主动丢弃/暂缓响应，验证未知结果和迟到响应。随机 `issue50_<uuid>_test` 库通过本地 `.env` 管理连接创建，未读取或清空用户业务库；finally 验证严格库名后只删除该次测试库。HTTP 3250、Vite 5250、编译/静态/结果均在 `.scratch/issue50/`，不写共享 dist/test-results，不打印秘密，不正式扣费或发信。

在 `application/` 执行：

```powershell
npm run typecheck
node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/issue50/compiled --incremental false
node node_modules/vite/bin/vite.js build --config config/playwright/vite.issue50.config.ts
node --env-file=.env scripts/verify-issue50.mjs
```

类型检查、独立编译与 Vite 构建通过，保留既有大包提示。专项完整浏览器通过，最终结果与账务统计见下。测试复制 #40 长流程作为本票平台回归基线，并追加分销专项，不修改 #40 测试源。

最终执行：`1 passed (38.0s)`，场景本体34.8秒；Node24.15.0/npm11.12.1。最终随机库 `issue50_7b10fd6c28a24bef9b39b5072a8e3954_test` 已由 finally 关闭连接并删除，测试 Nest/Vite 均已关闭。最终11单（8已划拨、2已退款、1继续待补），10条预留流水、8条划拨、2条退款；成功幂等记录 create11/reprice2/confirm11/reserve4/transfer8/refund2。平台最终5点、预留0；甲分销0点、预留0、平均成本50；乙分销16点、成本2.2；直属终端实际到账8点（5+3），原3点待补单继续等待。分销库存竞争实测201/409，胜单同请求并发重放3次均201且唯一划拨；供应商查询/详情/联系人均0次。全部实际标识和金额见证据 JSON。

实际覆盖：

- 平台与分销 Nest 生产构建入口直达/刷新；分销 Vite 开发入口直达/刷新；只有一个订单实例、无 compat-orders。
- 平台/分销草稿继续编辑和放弃；平台浏览器前进取消/确认、分销前进后退；缓存返回无新增订单 GET/建单；分销收款未知离开返回原凭证、原ID重试，无自动请求。
- 平台建单/调价/收款/划拨/退款完整回归，缺库存收款、采购涨价后锁价履约、库存竞争与丢响应预留/划拨幂等；提交中导航被阻止。
- 分销浏览器建单、调价、缺库存收款丢响应、重试、补库整单预留、完整划拨丢响应和重试、普通整单退款；HTTP 补充分销并发库存和重复划拨/退款，余额与流水唯一断言。
- 平台/分销停用待补买方，预留/划拨暂停；已预留买方停用保留完整预留、按钮禁用与HTTP409；恢复继续履约。分销卖方停用撤销会话，恢复重登后继续原单。
- 分销同级、跨级买方403；平台不能处理分销单，分销不能处理平台单；分销客户档案读取403；终端两角色订单读写403，分销深链拒绝；平台订单深链对其他三角色拒绝。
- 四角色登录与首次强制改密；临时凭据时直达分销订单仍显示改密并拒绝业务API。退出/重登平台无分销表单残留；分销撤销会话后401销毁草稿，先前成功GET迟到不能恢复旧实例，重登草稿为空。
- 供应商 list/detail/contacts 调用计数均0，订单不调用正式外部服务。

测试排查记录：追加强制改密夹具首次只设置 must_change，未设置临时有效期，登录按原规则拒绝；补充专用夹具 `temporary_expires_at=now+1h` 后完整重跑通过。最后补充只读通知后的复验曾在 Vite 阶段遇到其他会话正在编辑的 PlatformReportPage.vue 临时缺少闭合标签，未修改或覆盖该文件；其保存完成后类型检查、隔离构建和全流程重跑。无产品业务修复。最初首轮不含强制改密扩展，已通过；最终以全部扩展后的再次执行为准。

最终重复运行还暴露原平台测试计数的时序问题：刷新后标题已显示，但首次订单 GET 尚未完成，监听过早将其计作缓存返回请求。计数基线改为等待真实买方选项加载后再建立，不改变应用加载/缓存行为。

## 未验证与边界

未验证正式供应商、生产环境、既有业务库升级/回滚、关闭窗口/刷新时浏览器原生 beforeunload 对话、未知结果跨整页刷新恢复；本实现不提供跨刷新恢复。没有独立执行同组件 query/hash 变化的浏览器专项（页面无业务路由参数；按上述策略处理），无关组织/报表业务由各票验证。

没有运行共享 `npm run build`（会写共享 dist）、常规 npm test/test:integration（不覆盖此次页面）；采用同一编译工具的隔离输出和本票真实业务专项。无现有 lint/formatter 脚本，不安装依赖或新增格式配置。常规三项 HTTP 测试未单独运行，本票长流程已直接 HTTP 核对相关允许/拒绝与账务行为。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动；同时应用 Vue skill。
- 应用规则：ACTIVE MUST FCS-007/011/013/019/021～027/030，GUIDANCE FCS-014/032；状态继续由页面持有，依赖无变更，028/029无新增适用面。只修改本任务触及区域。
- 校验结果：typecheck、独立 tsc/Vite、本票真实浏览器/HTTP/PostgreSQL及本票路径 diff --check通过；无 lint/formatter；共享构建和常规无关测试未执行，原因见上。
- 冲突：无；存量规范债务：共享组件未触及区域沿用现状，不做格式整理。
- PENDING：命名、块顺序、缩进等未提升执行，无必须依赖的未决规则。
