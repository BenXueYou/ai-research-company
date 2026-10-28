# 对账业务页路由迁移记录

日期：2026-10-28。基准提交 `9b61453`；开始前工作区已有 Router / Pinia、页面目录整理及其他票的未提交改动，本次在其上增量修改。

## 范围与实例

- `App.vue` 中原兼容业务区移至 `layout/CompatWorkspace.vue`；保留原角色条件、组件顺序、参数绑定、`profileRefresh` 与兼容区 `v-show` 实例复用。
- 根据最新页面文案约束，移除兼容区原有的内部迁移提示；页面只显示用户可识别的菜单标题。
- `/platform/reconciliation` 由空路由改为 `pages/upstream/ReconciliationPage.vue`，集中承载原 `DetailReconciliation` 和 `UpstreamMonitor`。两组件从兼容容器移除，避免重复挂载和请求。`/platform/reconciliation/upstream` 保留既有独立页。
- 仅缓存 `ReconciliationPage` 实例。切到上游子页再返回时保留未提交的核对字段；退出或会话代次变化时销毁。页面挂载仍读取三类查询列表和上游最近快照；更新上游状态仍须用户点击。

## 契约对照

| 链路 | 迁移前来源与最终值 | 迁移后核对 |
| --- | --- | --- |
| 查询列表 | 页面挂载分别 GET `company-details/reconciliations`、`company-contacts/reconciliations`、`product-searches/reconciliations`，无请求体 | 独立页直达后三类各读取一次；上游子页往返不重复读取 |
| 人工核对 | 所选行 `queryId` → POST 对应领域的 `reconciliations` 请求体 `queryId`；表单值进入 `billingReference`、`traceId`、`evidence`、`result`、`upstreamPoints`、`outcome` | 浏览器夹具中 `id=detail-row-id`、`fileId=detail-file-id`、`queryId=detail-query-id`；提交仍为 `queryId=detail-query-id`，其余字段与表单一致 |
| 拒绝与重试 | 服务端拒绝时保留表单供用户处理，成功后清选择并刷新 | 模拟 403 后展示错误且表单保留；第二次提交体与第一次完全相同，成功后显示完成提示 |
| 上游快照 | GET `upstream-monitor` 无业务参数；刷新只由按钮 POST `upstream-monitor/refresh`、请求体 `{}` | 独立页显示上游监控；本次未点击刷新，未发起供应商调用 |

## 验证与边界

- `npm run typecheck`：通过。
- `npm run build`：通过；Vite 仍提示主块超过 500 kB。
- `node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.reconciliation-route.config.ts`：1/1 通过，使用静态生产前端与模拟 HTTP 响应，覆盖直达、表单保留、列表读取次数、不同标识字段、403、成功提交、兼容页往返和非授权角色路由回退。
- `git diff --check`：通过。

本次浏览器场景的 403 为模拟响应，未验证真实数据库写入、服务端租户权限、结算与释放冻结、迟到结果、三类查询的全部业务结果及正式供应商调用。未迁移兼容模块的所有业务提交链路也未逐项复测；旧交付记录不能替代其后续独立页验收。

前端编码规范试点交付反馈
- 规则版本：0.0.1
- 触发：自动
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021–027、029、030；GUIDANCE FCS-014、028、032；VERIFY 无额外已配置命令
- 校验结果：
  - `npm run typecheck`：通过 — Vue / TypeScript 类型边界。
  - `npm run build`：通过 — 生产构建。
  - 上述 Playwright 场景：通过 — 本次对账路由与提交参数。
  - 格式化、lint：未执行 — 项目未提供相应脚本或配置。
  - 真实数据库与供应商场景：未执行 — 当前批次使用模拟 HTTP，未创建专用测试库或供应商环境。
- 冲突：无。
- 存量规范债务：未触及区域未整改。
- PENDING：FCS-001–006 等命名与标签规则尚未决，未作为实施依据。
